/**
 * Model Router
 *
 * Unified interface for calling LLMs through role-based routing.
 * Handles provider dispatching, adapter loading, audit logging, and error handling.
 */

import { resolveModel, resolveModelForCognitiveMode, type ModelRole, type ResolvedModel, loadModelRegistry } from './model-resolver.js';
import { audit } from './audit.js';
import { loadCognitiveMode } from './cognitive-mode.js';
import { getUserContext } from './context.js';
import { callProvider, type ProviderType, type ProviderProgressEvent } from './providers/bridge.js';
import { ollama } from './ollama.js';

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

  // Get username from context for user-specific model config (profiles/{username}/etc/models.json)
  const ctx = getUserContext();
  const username = ctx?.username;

  // Resolve the model for this role (using user-specific models.json if available)
  const resolved = effectiveCognitiveMode
    ? resolveModelForCognitiveMode(effectiveCognitiveMode, callOptions.role, username)
    : resolveModel(callOptions.role, callOptions.overrides, username);

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

  // Dispatch to provider via unified bridge
  let response: RouterResponse;

  try {
    // Convert progress callback
    const bridgeProgress = callOptions.onProgress
      ? (event: ProviderProgressEvent) => {
          const typeMap: Record<string, ModelProgressEvent['type']> = {
            'queued': 'model_waiting',
            'loading': 'model_loading',
            'running': 'model_loading',
            'completed': 'model_ready',
            'failed': 'model_loading',
          };
          callOptions.onProgress!({
            type: typeMap[event.phase] || 'model_loading',
            message: event.message,
            model: resolved.model,
            elapsedMs: event.elapsedMs,
          });
        }
      : undefined;

    // Call unified provider bridge
    const providerResponse = await callProvider(
      resolved.provider as ProviderType,
      messages,
      {
        model: resolved.model,
        temperature: mergedOptions.temperature,
        maxTokens: mergedOptions.maxTokens || mergedOptions.num_predict,
        topP: mergedOptions.topP || mergedOptions.top_p,
        repeatPenalty: mergedOptions.repeatPenalty || mergedOptions.repeat_penalty,
        format: mergedOptions.format,
        keepAlive: callOptions.keepAlive as string | undefined,
        endpointTier: resolved.metadata?.endpointTier,
      },
      bridgeProgress
    );

    // Convert to RouterResponse
    response = {
      content: providerResponse.content,
      model: providerResponse.model,
      modelId: resolved.id,
      role: callOptions.role,
      provider: providerResponse.provider,
      tokens: providerResponse.usage ? {
        prompt: providerResponse.usage.promptTokens,
        completion: providerResponse.usage.completionTokens,
        total: providerResponse.usage.totalTokens,
      } : undefined,
    };

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
    // Get username from context for user-specific model config
    const ctx = getUserContext();
    const username = ctx?.username;

    const resolved = resolveModel(role, undefined, username);

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
