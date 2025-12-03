/**
 * Model Router
 *
 * Unified interface for calling LLMs through role-based routing.
 * Handles provider dispatching, adapter loading, audit logging, and error handling.
 */

import { resolveModel, resolveModelForCognitiveMode, type ModelRole, type ResolvedModel, loadModelRegistry } from './model-resolver.js';
import { audit } from './audit.js';
import { ollama } from './ollama.js';
import { loadCognitiveMode } from './cognitive-mode.js';
import { getUserContext } from './context.js';

// Re-export ModelRole for convenience
export type { ModelRole } from './model-resolver.js';

export interface RouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RouterCallOptions {
  role: ModelRole;
  messages: RouterMessage[];
  cognitiveMode?: string;
  /** User ID for context tracking */
  userId?: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    repeatPenalty?: number;
    stream?: boolean;
    [key: string]: any;
  };
  overrides?: Partial<ResolvedModel>;
  /**
   * Callback for progress notifications (model loading, waiting, etc.)
   * Used to show status messages in the chat stream
   */
  onProgress?: (event: ModelProgressEvent) => void;
  /**
   * How long to keep the model loaded in VRAM after the request.
   * Use "0" to unload immediately (good for background agents).
   * Use "5m" for 5 minutes, etc. Default is Ollama's default (5 minutes).
   */
  keepAlive?: string | number;
}

export interface ModelProgressEvent {
  type: 'model_loading' | 'model_waiting' | 'model_ready' | 'model_switch';
  message: string;
  model?: string;
  currentModel?: string;
  elapsedMs?: number;
}

export interface RouterResponse {
  content: string;
  model: string;
  modelId: string;
  role: ModelRole;
  provider: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs?: number;
  cached?: boolean;
}

export interface RouterStreamChunk {
  content: string;
  done: boolean;
  model?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

function getContextualCognitiveMode(explicitMode: string | undefined): string | null {
  if (explicitMode !== undefined) {
    return explicitMode;
  }

  const ctx = getUserContext();
  if (!ctx || (ctx.role === 'anonymous' && !ctx.activeProfile)) {
    return null;
  }

  try {
    const modeConfig = loadCognitiveMode();
    return modeConfig.currentMode ?? null;
  } catch (error) {
    console.warn('[model-router] Failed to load cognitive mode from user context:', error);
    return null;
  }
}

// NOTE: buildPersonaContext() removed (2025-11-26)
// Persona injection now handled exclusively by persona_loader and persona_formatter graph nodes

/**
 * Call an LLM using role-based routing
 */
export async function callLLM(callOptions: RouterCallOptions): Promise<RouterResponse> {
  const startTime = Date.now();

  const effectiveCognitiveMode = getContextualCognitiveMode(callOptions.cognitiveMode);

  // Resolve the model for this role
  const resolved = effectiveCognitiveMode
    ? resolveModelForCognitiveMode(effectiveCognitiveMode, callOptions.role)
    : resolveModel(callOptions.role, callOptions.overrides);

  // NOTE: Legacy persona injection removed (2025-11-26)
  // Persona is now explicitly injected via persona_loader and persona_formatter nodes
  // in the cognitive graphs. This makes persona flow visible and editable in the graph editor.
  // Response Synthesizer applies persona voice to final output only.
  let messages = callOptions.messages;

  // Merge options: model defaults + call-specific options
  const mergedOptions = {
    ...resolved.options,
    ...callOptions.options,
  };

  // Dispatch to provider
  let response: RouterResponse;

  try {
    switch (resolved.provider) {
      case 'ollama':
        response = await callOllama(resolved, messages, mergedOptions, callOptions.onProgress, callOptions.keepAlive);
        break;

      case 'openai':
        throw new Error('OpenAI provider not yet implemented');

      case 'local':
        throw new Error('Local provider not yet implemented');

      default:
        throw new Error(`Unknown provider: ${resolved.provider}`);
    }

    // Add metadata to response
    response.modelId = resolved.id;
    response.role = callOptions.role;
    response.latencyMs = Date.now() - startTime;

    // Audit the LLM call
    audit({
      level: 'info',
      category: 'system',
      event: 'llm_call',
      actor: 'model_router',
      details: {
        role: callOptions.role,
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        adapters: resolved.adapters,
        cognitiveMode: effectiveCognitiveMode,
        latencyMs: response.latencyMs,
        tokens: response.tokens,
        cached: response.cached || false,
      },
    });

    return response;

  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Audit the error
    audit({
      level: 'error',
      category: 'system',
      event: 'llm_call_error',
      actor: 'model_router',
      details: {
        role: callOptions.role,
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        cognitiveMode: effectiveCognitiveMode,
        error: (error as Error).message,
        latencyMs,
      },
    });

    throw error;
  }
}

/**
 * Call an LLM with streaming response
 * TODO: Implement streaming support when Ollama client supports it
 */
export async function* callLLMStream(callOptions: RouterCallOptions): AsyncGenerator<RouterStreamChunk> {
  // Streaming not yet implemented - for now, just call regular LLM and yield the result
  const response = await callLLM(callOptions);
  yield {
    content: response.content,
    done: true,
    model: response.model,
    tokens: response.tokens,
  };
}

// Models that can coexist in VRAM with chat models (small utility models)
const COEXIST_MODELS = [
  'nomic-embed-text',
  'all-minilm',
  'mxbai-embed',
  'snowflake-arctic-embed',
];

// Models that require exclusive GPU access (too large to share VRAM)
const EXCLUSIVE_MODELS = [
  'qwen3-coder:30b',
  'qwen3:30b',
  'llama3:70b',
  'mixtral',
  'deepseek-coder:33b',
];

/**
 * Check if a model can coexist with chat models in VRAM
 */
function canCoexistWithChatModel(modelName: string): boolean {
  const lowerName = modelName.toLowerCase();
  return COEXIST_MODELS.some(m => lowerName.includes(m));
}

/**
 * Check if a model requires exclusive GPU access
 */
function requiresExclusiveGPU(modelName: string): boolean {
  const lowerName = modelName.toLowerCase();
  // Check explicit exclusive list OR any 30B+ model
  return EXCLUSIVE_MODELS.some(m => lowerName.includes(m)) ||
    lowerName.includes(':30b') ||
    lowerName.includes(':33b') ||
    lowerName.includes(':70b') ||
    lowerName.includes(':72b');
}

/**
 * Call Ollama provider with model availability checking
 */
async function callOllama(
  resolved: ResolvedModel,
  messages: RouterMessage[],
  options: Record<string, any>,
  onProgress?: (event: ModelProgressEvent) => void,
  keepAlive?: string | number
): Promise<RouterResponse> {
  // Check if model is already loaded or if we need to wait
  const isLoaded = await ollama.isModelLoaded(resolved.model);

  if (!isLoaded) {
    // Check what other models are currently loaded
    const runningModels = await ollama.getRunningModels().catch(() => ({ models: [] }));

    if (runningModels.models.length > 0) {
      const currentModel = runningModels.models[0]?.name || 'unknown';

      // Only wait if the currently loaded model requires exclusive GPU access
      // Small models like nomic-embed-text can coexist with chat models
      const needsToWait = !canCoexistWithChatModel(currentModel) &&
        (requiresExclusiveGPU(currentModel) || requiresExclusiveGPU(resolved.model));

      if (needsToWait) {
        // Notify user we're waiting for GPU
        onProgress?.({
          type: 'model_waiting',
          message: `Waiting for GPU... (${currentModel} is loaded)`,
          model: resolved.model,
          currentModel,
        });

        // Wait for model availability (up to 60 seconds for chat, allows background agents to finish)
        const waitResult = await ollama.waitForModelAvailability(resolved.model, {
          timeoutMs: 60000,
          pollIntervalMs: 2000,
          onWaiting: (model, elapsed) => {
            onProgress?.({
              type: 'model_waiting',
              message: `Waiting for GPU (${Math.round(elapsed / 1000)}s)... ${model} still loaded`,
              model: resolved.model,
              currentModel: model,
              elapsedMs: elapsed,
            });
          },
        });

        if (!waitResult.ready) {
          // Still blocked after timeout - throw helpful error
          throw new Error(
            `GPU busy: ${waitResult.currentModel || 'another model'} is using the GPU. ` +
            `Waited ${Math.round((waitResult.waitedMs || 0) / 1000)}s. ` +
            `Try again in a moment or restart Ollama.`
          );
        }
      }
    }

    // Now load our model
    onProgress?.({
      type: 'model_loading',
      message: `Loading ${resolved.model}...`,
      model: resolved.model,
    });
  }

  // Convert our message format to Ollama's format
  const ollamaMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Build Ollama options
  const ollamaOptions: Record<string, any> = {};
  if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
  if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
  if (options.repeatPenalty !== undefined) ollamaOptions.repeat_penalty = options.repeatPenalty;
  if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
  if (options.format !== undefined) ollamaOptions.format = options.format; // Support JSON mode
  if (keepAlive !== undefined) ollamaOptions.keep_alive = keepAlive; // Control VRAM retention

  // Call Ollama with OOM error detection
  let response;
  try {
    response = await ollama.chat(resolved.model, ollamaMessages, ollamaOptions);
  } catch (error) {
    const errorMsg = (error as Error).message || '';

    // Detect OOM-related errors (EOF, connection refused, CUDA out of memory)
    const isOOMError = errorMsg.includes('EOF') ||
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('CUDA out of memory') ||
      errorMsg.includes('out of memory') ||
      errorMsg.includes('failed to load model') ||
      errorMsg.includes('GGML_ASSERT') ||
      (errorMsg.includes('500') && errorMsg.includes('load'));

    if (isOOMError) {
      // Notify user about potential OOM
      onProgress?.({
        type: 'model_loading',
        message: `⚠️ Model ${resolved.model} failed to load - GPU memory may be full. Try refreshing or wait for other models to unload.`,
        model: resolved.model,
      });

      // Re-throw with clearer error message
      throw new Error(`GPU memory exhausted: Unable to load ${resolved.model}. Another model may be using the GPU. Please wait and try again, or restart the Ollama service.`);
    }

    // Re-throw other errors
    throw error;
  }

  // Notify model is ready
  onProgress?.({
    type: 'model_ready',
    message: `${resolved.model} ready`,
    model: resolved.model,
  });

  // Extract tokens if available
  let tokens: RouterResponse['tokens'] | undefined;
  if (response.prompt_eval_count !== undefined && response.eval_count !== undefined) {
    tokens = {
      prompt: response.prompt_eval_count,
      completion: response.eval_count,
      total: response.prompt_eval_count + response.eval_count,
    };
  }

  return {
    content: response.message?.content || '',
    model: resolved.model,
    modelId: resolved.id,
    role: 'persona', // Will be overwritten by caller
    provider: 'ollama',
    tokens,
  };
}

/**
 * Helper: Call LLM and return just the text content
 */
export async function callLLMText(callOptions: RouterCallOptions): Promise<string> {
  const response = await callLLM(callOptions);
  return response.content;
}

/**
 * Helper: Call LLM with a simple prompt (single user message)
 */
export async function callLLMPrompt(
  role: ModelRole,
  prompt: string,
  options?: RouterCallOptions['options']
): Promise<string> {
  const response = await callLLM({
    role,
    messages: [{ role: 'user', content: prompt }],
    options,
  });
  return response.content;
}

/**
 * Helper: Call LLM and return parsed JSON response
 * Uses Ollama's JSON mode to ensure structured output
 */
export async function callLLMJSON<T = any>(
  role: ModelRole,
  messages: RouterMessage[],
  options?: RouterCallOptions['options']
): Promise<T> {
  const response = await callLLM({
    role,
    messages,
    options: {
      ...options,
      format: 'json' // Enable Ollama JSON mode
    }
  });

  try {
    return JSON.parse(response.content) as T;
  } catch (error) {
    console.error('[callLLMJSON] Failed to parse JSON response:', response.content);
    throw new Error(`LLM returned invalid JSON: ${(error as Error).message}`);
  }
}

/**
 * Helper: Check if a model is available for a role
 */
export async function isModelAvailable(role: ModelRole): Promise<boolean> {
  try {
    const resolved = resolveModel(role);

    // For Ollama, check if the model is loaded
    if (resolved.provider === 'ollama') {
      const models = await ollama.listModels();
      return models.some(m => m.name === resolved.model || m.name.startsWith(resolved.model + ':'));
    }

    // For other providers, assume available if resolved
    return true;
  } catch {
    return false;
  }
}
