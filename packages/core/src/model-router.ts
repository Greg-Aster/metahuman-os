/**
 * Model Router
 *
 * Unified interface for calling LLMs through role-based routing.
 * Handles provider dispatching, adapter loading, audit logging, and error handling.
 */

import { resolveModel, resolveModelForCognitiveMode, type ModelRole, type ResolvedModel } from './model-resolver.js';
import { audit } from './audit.js';
import { loadCognitiveMode } from './cognitive-mode.js';
import { getUserContext } from './context.js';
import { callProvider, type ProviderType, type ProviderProgressEvent } from './providers/bridge.js';
import { ollama } from './ollama.js';
import { embedWithLocalService, isLocalModelServiceRunning } from './providers/local-models.js';
import { loadBackendConfig } from './llm-backend.js';
import { parseThinkingBlocks } from './nodes/output/thinking-stripper.node.js';
import {
  providerMessagesContainImages,
  type ProviderMessageContent,
  type ProviderResponse,
} from './providers/types.js';

// Re-export ModelRole for convenience
export type { ModelRole } from './model-resolver.js';

export interface RouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: ProviderMessageContent;
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
    /**
     * Request Big Brother for this specific call (hybrid mode).
     * When bigBrotherMode.enabled=true and delegateAll=false,
     * only calls with useBigBrother=true will route to Big Brother.
     */
    useBigBrother?: boolean;
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
  /** Extracted thinking/reasoning from <think> blocks (null if none) */
  thinking?: string | null;
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

export function normalizeProviderReasoningResponse(
  providerResponse: Pick<ProviderResponse, 'content' | 'thinking'>
): { thinking: string | null; stripped: string } {
  const parsed = parseThinkingBlocks(providerResponse.content || '')
  const nativeThinking = providerResponse.thinking?.trim() || null
  const thinkingParts = [nativeThinking, parsed.thinking]
    .filter((value): value is string => Boolean(value))
  const thinking = thinkingParts.length > 0
    ? Array.from(new Set(thinkingParts)).join('\n\n')
    : null

  return {
    thinking,
    stripped: parsed.stripped || (thinking
      ? '[Response incomplete - thinking exceeded token limit]'
      : ''),
  }
}

function getContextualCognitiveMode(explicitMode: string | undefined): string | null {
  if (explicitMode !== undefined) {
    return explicitMode;
  }

  const ctx = getUserContext();
  if (!ctx) {
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
  // Fallback to callOptions.userId for node executors that pass context explicitly
  const ctx = getUserContext();
  const username = ctx?.username || callOptions.userId;

  // Resolve the model for this role (using user-specific models.json if available)
  const resolved = effectiveCognitiveMode
    ? resolveModelForCognitiveMode(effectiveCognitiveMode, callOptions.role, username)
    : resolveModel(callOptions.role, callOptions.overrides, username);

  // NOTE: Legacy persona injection removed (2025-11-26)
  // Persona is now explicitly injected via persona_loader and persona_formatter nodes
  // in the cognitive graphs. This makes persona flow visible and editable in the graph editor.
  // Response Synthesizer applies persona voice to final output only.
  let messages = callOptions.messages;
  const hasImages = providerMessagesContainImages(messages);

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
        contextWindow: mergedOptions.contextWindow,
        enableThinking: mergedOptions.enableThinking,
        maxImages: mergedOptions.maxImages,
        maxImageBytes: mergedOptions.maxImageBytes,
        allowedImageMimeTypes: mergedOptions.allowedImageMimeTypes,
        modelCapabilities: resolved.capabilities,
        endpointTier: typeof resolved.metadata?.endpointTier === 'string'
          ? resolved.metadata.endpointTier
          : undefined,
        useBigBrother: mergedOptions.useBigBrother,
      },
      bridgeProgress
    );

    // Normalize both legacy inline <think> blocks and provider-native reasoning
    // fields without leaking reasoning into user-visible response content.
    const { thinking, stripped } = normalizeProviderReasoningResponse(providerResponse);

    // Convert to RouterResponse
    response = {
      content: stripped, // Use stripped content (without <think> blocks)
      model: providerResponse.model,
      modelId: resolved.id,
      role: callOptions.role,
      provider: providerResponse.provider,
      tokens: providerResponse.usage ? {
        prompt: providerResponse.usage.promptTokens,
        completion: providerResponse.usage.completionTokens,
        total: providerResponse.usage.totalTokens,
      } : undefined,
      thinking, // Include extracted thinking/reasoning
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
        modelId: response.modelId,
        provider: providerResponse.provider,
        model: providerResponse.model,
        adapters: resolved.adapters,
        cognitiveMode: effectiveCognitiveMode,
        latencyMs: response.latencyMs,
        tokens: response.tokens,
        cached: response.cached || false,
        hadThinking: !!thinking,
        thinkingLength: thinking?.length || 0,
        imageInput: hasImages,
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
        imageInput: hasImages,
      },
    });

    throw error;
  }
}

/**
 * Call an LLM with streaming response
 * Note: Streaming support available via SSE in operator pipeline
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
export async function isModelAvailable(role: ModelRole, userId?: string): Promise<boolean> {
  try {
    // Get username from context for user-specific model config
    // Fallback to userId parameter for explicit context passing
    const ctx = getUserContext();
    const username = ctx?.username || userId;

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

// ============================================================================
// Embedding Support
// ============================================================================

export interface EmbeddingCallOptions {
  /** Text to embed */
  text: string;
  /** User ID for context tracking */
  userId?: string;
  /** Override model options */
  overrides?: Partial<ResolvedModel>;
}

export interface EmbeddingResponse {
  /** The embedding vector */
  embeddings: number[];
  /** Model used for embedding */
  model: string;
  /** Model ID from registry */
  modelId: string;
  /** Provider used */
  provider: string;
  /** Vector dimensions */
  dimensions: number;
  /** Latency in ms */
  latencyMs?: number;
}

/**
 * Generate embeddings using role-based routing
 *
 * Routes to the configured embedder model (local-models/llama.cpp by default).
 * The local-models backend runs on CPU and can operate in parallel with GPU backends.
 */
export async function callEmbeddings(options: EmbeddingCallOptions): Promise<EmbeddingResponse> {
  const startTime = Date.now();

  // Get username from context for user-specific model config
  const ctx = getUserContext();
  const username = ctx?.username || options.userId;

  // Resolve the embedder model
  const resolved = resolveModel('embedder', options.overrides, username);

  try {
    let embeddings: number[];
    let dimensions: number;

    if (resolved.provider === 'local-models') {
      // Get endpoint from llm-backend config
      const backendConfig = loadBackendConfig();
      const endpoint = backendConfig.localModels?.endpoint || 'http://127.0.0.1:4324';

      // Check if service is running
      const isRunning = await isLocalModelServiceRunning(endpoint);
      if (!isRunning) {
        throw new Error(`Local model service not running at ${endpoint}. Start with: ./bin/start-local-models`);
      }

      // Generate embeddings via llama.cpp service
      embeddings = await embedWithLocalService(options.text, {
        model: resolved.model,
        endpoint,
      });

      dimensions = typeof resolved.options?.dimensions === 'number'
        ? resolved.options.dimensions
        : embeddings.length;
    } else if (resolved.provider === 'ollama') {
      // Fallback to Ollama embeddings if configured
      const result = await ollama.embeddings(resolved.model, options.text);
      embeddings = result.embedding;
      dimensions = embeddings.length;
    } else {
      throw new Error(`Unsupported embedding provider: ${resolved.provider}`);
    }

    const latencyMs = Date.now() - startTime;

    // Audit the embedding call
    audit({
      level: 'info',
      category: 'system',
      event: 'embedding_call',
      actor: 'model_router',
      details: {
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        textLength: options.text.length,
        dimensions,
        latencyMs,
      },
    });

    return {
      embeddings,
      model: resolved.model,
      modelId: resolved.id,
      provider: resolved.provider,
      dimensions,
      latencyMs,
    };

  } catch (error) {
    const latencyMs = Date.now() - startTime;

    // Audit the error
    audit({
      level: 'error',
      category: 'system',
      event: 'embedding_call_error',
      actor: 'model_router',
      details: {
        modelId: resolved.id,
        provider: resolved.provider,
        model: resolved.model,
        error: (error as Error).message,
        latencyMs,
      },
    });

    throw error;
  }
}

/**
 * Check if the embedding service is available
 */
export async function isEmbeddingServiceAvailable(userId?: string): Promise<boolean> {
  try {
    const ctx = getUserContext();
    const username = ctx?.username || userId;

    const resolved = resolveModel('embedder', undefined, username);

    if (resolved.provider === 'local-models') {
      const backendConfig = loadBackendConfig();
      const endpoint = backendConfig.localModels?.endpoint || 'http://127.0.0.1:4324';
      return await isLocalModelServiceRunning(endpoint);
    }

    if (resolved.provider === 'ollama') {
      const models = await ollama.listModels();
      return models.some(m => m.name === resolved.model || m.name.startsWith(resolved.model + ':'));
    }

    return false;
  } catch {
    return false;
  }
}
