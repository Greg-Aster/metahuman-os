/**
 * Embeddings Module
 *
 * Unified embedding system routed through the Model Router.
 * Uses llama.cpp via local-model-service as the default backend.
 *
 * Architecture:
 * - Model Router resolves 'embedder' role from user profile's models.json
 * - Default provider is 'local-models' (llama.cpp on CPU)
 * - Can run in parallel with GPU backends (vLLM, Ollama)
 * - Works on both desktop and mobile (React Native)
 *
 * Configuration comes from user profiles:
 * - profiles/{username}/etc/models.json → embedder model config
 * - llm-backend.json → localModels.endpoint for service location
 *
 * NOTE: This module does NOT use global etc/embeddings.json.
 * All configuration must come from user profile or be passed explicitly.
 */

import { embedWithLocalService, isLocalModelServiceRunning, loadLocalModel } from './providers/local-models.js'
import { callEmbeddings, isEmbeddingServiceAvailable as checkEmbeddingAvailable } from './model-router.js'
import { getUserContext } from './context.js'
import { loadBackendConfig } from './llm-backend.js'
import { getLoggedInUsers } from './sessions.js'

export type EmbeddingProvider = 'local-models'

/**
 * Embedding configuration type (for API compatibility)
 */
export interface EmbeddingConfig {
  enabled: boolean;
  model: string;
  provider: EmbeddingProvider;
  preloadAtStartup: boolean;
  cpuOnly: boolean;
}

/**
 * Load embedding configuration from llm-backend.json
 * Provides compatibility with embeddings-control API
 */
export function loadEmbeddingConfig(): EmbeddingConfig {
  const backendConfig = loadBackendConfig();
  const localModels = backendConfig.localModels as Record<string, unknown> | undefined;

  return {
    enabled: (localModels?.enabled as boolean) ?? true,
    model: DEFAULTS.model,
    provider: 'local-models',
    preloadAtStartup: (localModels?.preloadEmbeddings as boolean) ?? true,
    cpuOnly: (localModels?.cpuOnly as boolean) ?? true,
  };
}

/**
 * Save embedding configuration (stub - config comes from llm-backend.json)
 * This is a no-op since config is managed via llm-backend
 */
export function saveEmbeddingConfig(_config: Partial<EmbeddingConfig>): void {
  console.log('[embeddings] saveEmbeddingConfig: Config is managed via llm-backend.json');
  // Config is managed via llm-backend.json, not a separate embeddings.json
  // This function exists for API compatibility
}

/**
 * Error thrown when embedding service is unavailable
 */
export class EmbeddingServiceError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'EmbeddingServiceError';
  }
}

/**
 * Default embedding settings (used when no user context and no explicit options)
 */
const DEFAULTS = {
  model: 'qwen3-embedding-0.6b',
  endpoint: 'http://127.0.0.1:4324',
  maxTextLength: 32000,  // qwen3-embedding supports 32K context
} as const;

/**
 * Check if embedding service is available
 * Re-exported from model-router for convenience
 */
export async function isEmbeddingServiceAvailable(userId?: string): Promise<boolean> {
  return checkEmbeddingAvailable(userId);
}

/**
 * Preload the embedding model to keep it in memory
 *
 * @param userId - Optional user ID to get model config from profile
 */
export async function preloadEmbeddingModel(_userId?: string): Promise<void> {
  const backendConfig = loadBackendConfig();
  const endpoint = backendConfig.localModels?.endpoint || DEFAULTS.endpoint;

  // TODO: If _userId provided, could look up their profile model config
  // For now use default since preload is typically called at startup
  const model = DEFAULTS.model;

  try {
    const isRunning = await isLocalModelServiceRunning(endpoint);
    if (!isRunning) {
      console.log('[embeddings] Local model service not running at', endpoint);
      console.log('[embeddings] Start it with: ./bin/start-local-models');
      return;
    }

    console.log(`[embeddings] Preloading model "${model}" via llama.cpp...`);

    // Request model load
    await loadLocalModel('embeddings', model, endpoint);

    // Warm up with a test embedding
    await embedWithLocalService('warmup', { model, endpoint });
    console.log(`[embeddings] ✓ Model "${model}" preloaded and ready`);
  } catch (error) {
    console.error('[embeddings] Failed to preload model:', error);
  }
}

/**
 * Generate embedding vector for text
 *
 * Routes through the Model Router when user context is available.
 * Falls back to direct local-model-service calls for system operations.
 *
 * @param text - Text to generate embedding for
 * @param opts - Options including userId for profile-based model resolution
 * @throws EmbeddingServiceError if embedding service is unavailable
 */
export async function embedText(
  text: string,
  opts: { model?: string; userId?: string } = {}
): Promise<number[]> {
  // Ensure text is a string
  const originalText = typeof text === 'string' ? text : JSON.stringify(text);

  // Truncate if too long
  const maxTextLength = DEFAULTS.maxTextLength;
  let truncatedText = originalText;
  if (originalText.length > maxTextLength) {
    console.warn(`[embeddings] Text too long (${originalText.length} chars), truncating to ${maxTextLength}`);
    truncatedText = originalText.substring(0, maxTextLength) + '... [truncated]';
  }

  // Try to get user context for profile-based model resolution
  const ctx = getUserContext();
  let username = ctx?.username || opts.userId;

  // If no user context, try to get from logged-in users
  if (!username) {
    const loggedInUsers = getLoggedInUsers();
    if (loggedInUsers.length > 0) {
      username = loggedInUsers[0].username;
    }
  }

  // Route through Model Router if we have user context
  if (username) {
    try {
      const response = await callEmbeddings({
        text: truncatedText,
        userId: username,
      });
      return response.embeddings;
    } catch (error) {
      console.error('[embeddings] Model router error:', error);
      // Fall through to direct service call as last resort
    }
  }

  // Direct service call (no user context or router failed)
  // This is a fallback for system operations without user context
  const model = opts.model || DEFAULTS.model;
  const backendConfig = loadBackendConfig();
  const endpoint = backendConfig.localModels?.endpoint || DEFAULTS.endpoint;

  try {
    const isRunning = await isLocalModelServiceRunning(endpoint);
    if (!isRunning) {
      throw new EmbeddingServiceError(
        `Embedding service not running at ${endpoint}. Start with: ./bin/start-local-models`,
      );
    }

    return await embedWithLocalService(truncatedText, { model, endpoint });
  } catch (error) {
    if (error instanceof EmbeddingServiceError) {
      throw error;
    }
    throw new EmbeddingServiceError(
      `Embedding service error: ${(error as Error).message}. Ensure local-model-service is running.`,
      error as Error
    );
  }
}

/**
 * Calculate cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }

  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

/**
 * Get embedding dimensions for a model
 */
export function getEmbeddingDimensions(model?: string): number {
  const modelName = model || DEFAULTS.model;

  // Known dimensions by model (local-models uses hyphen format)
  const dimensions: Record<string, number> = {
    'qwen3-embedding-0.6b': 1024,   // Qwen3 Embedding 0.6B - MTEB #1 per param
    'qwen3-embedding-4b': 1024,     // Qwen3 Embedding 4B
    'qwen3-embedding-8b': 1024,     // Qwen3 Embedding 8B - MTEB #1 overall
    'nomic-embed-text-v1.5': 768,
    'nomic-embed-text-v2-moe': 768,
    'mxbai-embed-large-v1': 1024,
    'all-minilm-l6-v2': 384,
  };

  return dimensions[modelName] || 1024;
}
