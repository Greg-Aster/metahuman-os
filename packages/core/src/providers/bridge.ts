/**
 * Provider Bridge (Core)
 *
 * Unified entry point for ALL LLM providers.
 * - Local providers (ollama, mock) are handled here
 * - Cloud providers (runpod, huggingface) are delegated to @metahuman/server
 *
 * model-router.ts calls this ONE function - it knows nothing about specific providers.
 */

import { ollama } from '../ollama.js';
import { loadDeploymentConfig } from '../deployment.js';
import {
  type ProviderMessage,
  type ProviderOptions,
  type ProviderResponse,
  type ProviderProgressCallback,
  type ProviderConfig,
  type ProviderType,
  isCloudProvider,
} from './types.js';

// Re-export types for convenience
export * from './types.js';

/**
 * Call an LLM provider
 *
 * This is the ONLY function model-router needs to call.
 * Routes to local or cloud provider based on provider type.
 */
export async function callProvider(
  providerName: ProviderType,
  messages: ProviderMessage[],
  options: ProviderOptions,
  onProgress?: ProviderProgressCallback
): Promise<ProviderResponse> {
  // Get config
  const deploymentConfig = loadDeploymentConfig();
  const config: ProviderConfig = {
    ollama: {
      endpoint: deploymentConfig.local.ollamaEndpoint,
    },
    runpod: deploymentConfig.server?.runpod,
    huggingface: deploymentConfig.server?.huggingface,
  };

  // Route to appropriate handler
  if (isCloudProvider(providerName)) {
    return callCloudProvider(providerName, messages, options, config, onProgress);
  }

  // Local providers
  switch (providerName) {
    case 'ollama':
      return callOllamaProvider(messages, options, onProgress);

    case 'mock':
      return callMockProvider(messages, options);

    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

// Models that can coexist in VRAM with chat models (small utility models)
const COEXIST_MODELS = ['nomic-embed-text', 'all-minilm', 'mxbai-embed', 'snowflake-arctic-embed'];
const EXCLUSIVE_MODELS = ['qwen3-coder:30b', 'qwen3:30b', 'llama3:70b', 'mixtral', 'deepseek-coder:33b'];

function canCoexistWithChatModel(modelName: string): boolean {
  const lowerName = modelName.toLowerCase();
  return COEXIST_MODELS.some(m => lowerName.includes(m));
}

function requiresExclusiveGPU(modelName: string): boolean {
  const lowerName = modelName.toLowerCase();
  return EXCLUSIVE_MODELS.some(m => lowerName.includes(m)) ||
    lowerName.includes(':30b') || lowerName.includes(':33b') ||
    lowerName.includes(':70b') || lowerName.includes(':72b');
}

/**
 * Ollama provider implementation with GPU contention handling
 */
async function callOllamaProvider(
  messages: ProviderMessage[],
  options: ProviderOptions,
  onProgress?: ProviderProgressCallback
): Promise<ProviderResponse> {
  const model = options.model || 'qwen3:14b';

  // Check if model is already loaded or if we need to wait
  const isLoaded = await ollama.isModelLoaded(model);

  if (!isLoaded) {
    // Check what other models are currently loaded
    const runningModels = await ollama.getRunningModels().catch(() => ({ models: [] }));

    if (runningModels.models.length > 0) {
      const currentModel = runningModels.models[0]?.name || 'unknown';

      // Only wait if the currently loaded model requires exclusive GPU access
      const needsToWait = !canCoexistWithChatModel(currentModel) &&
        (requiresExclusiveGPU(currentModel) || requiresExclusiveGPU(model));

      if (needsToWait) {
        onProgress?.({
          phase: 'queued',
          message: `Waiting for GPU... (${currentModel} is loaded)`,
        });

        // Wait for model availability (up to 60 seconds)
        const waitResult = await ollama.waitForModelAvailability(model, {
          timeoutMs: 60000,
          pollIntervalMs: 2000,
          onWaiting: (loadedModel: string, elapsed: number) => {
            onProgress?.({
              phase: 'queued',
              message: `Waiting for GPU (${Math.round(elapsed / 1000)}s)... ${loadedModel} still loaded`,
              elapsedMs: elapsed,
            });
          },
        });

        if (!waitResult.ready) {
          throw new Error(
            `GPU busy: ${waitResult.currentModel || 'another model'} is using the GPU. ` +
            `Waited ${Math.round((waitResult.waitedMs || 0) / 1000)}s.`
          );
        }
      }
    }

    onProgress?.({
      phase: 'loading',
      message: `Loading ${model}...`,
    });
  }

  // Build Ollama options
  const ollamaOptions: Record<string, any> = {};
  if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
  if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
  if (options.repeatPenalty !== undefined) ollamaOptions.repeat_penalty = options.repeatPenalty;
  if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;

  onProgress?.({
    phase: 'running',
    message: `Generating with ${model}...`,
  });

  // Call Ollama with OOM error detection
  let response;
  try {
    response = await ollama.chat(model, messages, {
      ...ollamaOptions,
      format: options.format === 'json' ? 'json' : undefined,
      keep_alive: options.keepAlive,
    });
  } catch (error) {
    const errorMsg = (error as Error).message || '';
    const isOOMError = errorMsg.includes('EOF') || errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('CUDA out of memory') || errorMsg.includes('out of memory') ||
      errorMsg.includes('failed to load model') || errorMsg.includes('GGML_ASSERT');

    if (isOOMError) {
      onProgress?.({
        phase: 'failed',
        message: `Model ${model} failed to load - GPU memory may be full`,
      });
      throw new Error(`GPU memory exhausted: Unable to load ${model}. Please wait and try again.`);
    }
    throw error;
  }

  onProgress?.({
    phase: 'completed',
    message: `${model} ready`,
  });

  return {
    content: response.message?.content || '',
    model,
    provider: 'ollama',
    usage: response.prompt_eval_count || response.eval_count ? {
      promptTokens: response.prompt_eval_count || 0,
      completionTokens: response.eval_count || 0,
      totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0),
    } : undefined,
  };
}

/**
 * Mock provider for testing
 */
async function callMockProvider(
  messages: ProviderMessage[],
  options: ProviderOptions
): Promise<ProviderResponse> {
  const lastMessage = messages[messages.length - 1];
  return {
    content: `[MOCK] Echoing: ${lastMessage?.content || 'empty'}`,
    model: options.model || 'mock',
    provider: 'mock',
  };
}

/**
 * Cloud provider delegation
 *
 * Dynamically imports @metahuman/server and delegates to its bridge.
 * Server package handles all cloud-specific logic.
 */
async function callCloudProvider(
  providerName: ProviderType,
  messages: ProviderMessage[],
  options: ProviderOptions,
  config: ProviderConfig,
  onProgress?: ProviderProgressCallback
): Promise<ProviderResponse> {
  // Progress: connecting
  onProgress?.({
    phase: 'loading',
    message: `Connecting to cloud GPU (${options.model})...`,
  });

  // Dynamic import - only loads server package when cloud provider is used
  let serverModule: any;
  try {
    serverModule = await import('@metahuman/server');
  } catch {
    throw new Error(
      `Cloud provider "${providerName}" requires @metahuman/server package. ` +
      'Install it with: pnpm add @metahuman/server'
    );
  }

  // Convert progress callback
  const serverProgress = onProgress
    ? (event: { phase: string; message: string; elapsedMs?: number }) => {
        onProgress({
          phase: event.phase as ProviderResponse['provider'] extends string ? 'queued' | 'loading' | 'running' | 'completed' | 'failed' : never,
          message: event.message,
          elapsedMs: event.elapsedMs,
        });
      }
    : undefined;

  // Delegate to server's provider bridge
  const response = await serverModule.callServerProvider(
    providerName,
    messages,
    {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      format: options.format,
      endpointTier: options.endpointTier,
    },
    {
      provider: providerName,
      runpod: config.runpod,
      huggingface: config.huggingface,
    },
    serverProgress
  );

  // Progress: completed
  onProgress?.({
    phase: 'completed',
    message: `${options.model} ready (cloud)`,
  });

  return {
    content: response.content,
    model: response.model,
    provider: providerName,
    usage: response.usage,
  };
}

/**
 * Check if a provider is available
 */
export async function isProviderAvailable(providerName: ProviderType): Promise<boolean> {
  switch (providerName) {
    case 'ollama':
      return ollama.isRunning();

    case 'mock':
      return true;

    case 'runpod_serverless':
    case 'huggingface':
      // Check if server package is installed
      try {
        const serverModule = await import('@metahuman/server');
        const deploymentConfig = loadDeploymentConfig();
        return serverModule.isServerProviderAvailable(providerName, {
          provider: providerName,
          runpod: deploymentConfig.server?.runpod,
          huggingface: deploymentConfig.server?.huggingface,
        });
      } catch {
        return false;
      }

    default:
      return false;
  }
}
