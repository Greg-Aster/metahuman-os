/**
 * Provider Bridge (Core)
 *
 * Unified entry point for ALL LLM providers.
 * - Local providers (ollama, vllm, mock) are handled here
 * - Cloud providers (runpod, huggingface) are delegated to @metahuman/server
 *
 * model-router.ts calls this ONE function - it knows nothing about specific providers.
 *
 * BACKEND-AWARE: Automatically routes to Ollama or vLLM based on etc/llm-backend.json
 * AUTO-START: Automatically starts the configured backend if not running
 */

import { ollama, isRunning as isOllamaRunning } from '../ollama.js';
import { vllm, isVLLMRunning } from '../vllm.js';
import { loadBackendConfig } from '../llm-backend.js';
import { loadDeploymentConfig } from '../deployment.js';

// Track if we've already logged the active backend
let backendLoggedOnce = false;
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
 *
 * For local providers (ollama), automatically routes to the active backend
 * (Ollama or vLLM) based on etc/llm-backend.json configuration.
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

  // Local providers - check which backend is active
  switch (providerName) {
    case 'ollama': {
      // Route to active backend (Ollama or vLLM)
      const backendConfig = loadBackendConfig();
      if (backendConfig.activeBackend === 'vllm') {
        return callVLLMProvider(messages, options, backendConfig.vllm.endpoint, onProgress);
      }
      return callOllamaProvider(messages, options, onProgress);
    }

    case 'vllm': {
      // Explicit vLLM call
      const backendConfig = loadBackendConfig();
      return callVLLMProvider(messages, options, backendConfig.vllm.endpoint, onProgress);
    }

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

  // Log active backend once
  if (!backendLoggedOnce) {
    console.log(`[provider-bridge] Active backend: Ollama (${model})`);
    backendLoggedOnce = true;
  }

  // Check if Ollama is running
  const running = await isOllamaRunning();
  if (!running) {
    onProgress?.({
      phase: 'failed',
      message: 'Ollama is not running. Start it with: ollama serve',
    });
    throw new Error('Ollama is not running. Start it with: ollama serve');
  }

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
 * vLLM provider implementation
 * Uses the same OpenAI-compatible API that vLLM serves
 * Auto-starts vLLM if not running
 */
async function callVLLMProvider(
  messages: ProviderMessage[],
  options: ProviderOptions,
  endpoint: string,
  onProgress?: ProviderProgressCallback
): Promise<ProviderResponse> {
  const backendConfig = loadBackendConfig();
  // Always use the vLLM backend's configured model - vLLM only loads one model at startup
  // and doesn't understand Ollama model names (e.g., qwen3:14b vs Qwen/Qwen3-14B-AWQ)
  const model = backendConfig.vllm.model || options.model || 'default';

  // Log active backend once
  if (!backendLoggedOnce) {
    console.log(`[provider-bridge] Active backend: vLLM (${model})`);
    backendLoggedOnce = true;
  }

  // Check if vLLM is running, auto-start if not
  const running = await isVLLMRunning();
  if (!running) {
    onProgress?.({
      phase: 'loading',
      message: `Starting vLLM server...`,
    });

    console.log('[provider-bridge] vLLM not running, attempting to start...');

    // Try to start vLLM
    const startResult = await vllm.startServer({
      endpoint: backendConfig.vllm.endpoint,
      model: backendConfig.vllm.model,
      gpuMemoryUtilization: backendConfig.vllm.gpuMemoryUtilization,
      maxModelLen: backendConfig.vllm.maxModelLen,
      tensorParallelSize: backendConfig.vllm.tensorParallelSize,
      dtype: backendConfig.vllm.dtype,
      quantization: backendConfig.vllm.quantization,
      enforceEager: backendConfig.vllm.enforceEager,
      autoUtilization: backendConfig.vllm.autoUtilization,
      enableThinking: backendConfig.vllm.enableThinking,
    });

    if (!startResult.success) {
      onProgress?.({
        phase: 'failed',
        message: `Failed to start vLLM: ${startResult.error}`,
      });
      throw new Error(`vLLM failed to start: ${startResult.error}`);
    }

    console.log(`[provider-bridge] vLLM started (PID: ${startResult.pid})`);

    // Wait for vLLM to be ready (it takes time to load the model)
    onProgress?.({
      phase: 'loading',
      message: `Loading model ${model} (this may take a minute)...`,
    });

    const maxWaitMs = 120000; // 2 minutes
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const ready = await isVLLMRunning();
      if (ready) {
        console.log('[provider-bridge] vLLM is ready');
        break;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
      onProgress?.({
        phase: 'loading',
        message: `Loading model... (${Math.round((Date.now() - startTime) / 1000)}s)`,
      });
    }

    // Final check
    if (!(await isVLLMRunning())) {
      throw new Error('vLLM failed to become ready within timeout');
    }
  }

  onProgress?.({
    phase: 'loading',
    message: `Connecting to vLLM (${model})...`,
  });

  // Temporarily set endpoint on vllm client
  const originalEndpoint = (vllm as any).endpoint;
  (vllm as any).endpoint = endpoint;

  try {
    onProgress?.({
      phase: 'running',
      message: `Generating with ${model}...`,
    });

    const response = await vllm.chat(
      messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      {
        model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        topP: options.topP,
        enableThinking: backendConfig.vllm.enableThinking,
      }
    );

    onProgress?.({
      phase: 'completed',
      message: `${model} ready`,
    });

    return {
      content: response.content,
      model: response.model || model,
      provider: 'vllm',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens || 0,
        completionTokens: response.usage.completion_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
      } : undefined,
    };
  } finally {
    // Restore original endpoint
    (vllm as any).endpoint = originalEndpoint;
  }
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

    case 'vllm':
      return vllm.isRunning();

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
