/**
 * Provider Bridge
 *
 * Single entry point for core to call server providers.
 * Core knows nothing about RunPod, HuggingFace, etc. - it just calls this.
 */

import { RunPodServerlessProvider, type RunPodProgressCallback } from './providers/runpod.js';
import { HuggingFaceProvider } from './providers/huggingface.js';

// Generic message format (matches core's RouterMessage)
export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  format?: 'text' | 'json';
}

export interface ProviderResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderProgressEvent {
  phase: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  elapsedMs?: number;
}

export interface ServerProviderConfig {
  provider: 'runpod_serverless' | 'huggingface';

  // RunPod config
  runpod?: {
    apiKey: string;
    endpoints: Record<string, string | undefined>;
    endpointTiers?: Record<string, any>;
  };

  // HuggingFace config
  huggingface?: {
    apiKey: string;
    endpointUrl: string;
  };
}

/**
 * Call a server-side LLM provider
 *
 * This is the ONLY function core needs to know about.
 * All provider-specific logic is encapsulated here.
 */
export async function callServerProvider(
  providerName: string,
  messages: ProviderMessage[],
  options: ProviderOptions & { endpointTier?: string },
  config: ServerProviderConfig,
  onProgress?: (event: ProviderProgressEvent) => void
): Promise<ProviderResponse> {

  switch (providerName) {
    case 'runpod_serverless':
      return callRunPodProvider(messages, options, config, onProgress);

    case 'huggingface':
      return callHuggingFaceProvider(messages, options, config);

    default:
      throw new Error(`Unknown server provider: ${providerName}`);
  }
}

/**
 * RunPod provider call - all RunPod logic stays HERE in server package
 */
async function callRunPodProvider(
  messages: ProviderMessage[],
  options: ProviderOptions & { endpointTier?: string },
  config: ServerProviderConfig,
  onProgress?: (event: ProviderProgressEvent) => void
): Promise<ProviderResponse> {

  const runpodConfig = config.runpod;

  if (!runpodConfig?.apiKey) {
    throw new Error('RunPod API key not configured');
  }

  // Resolve endpoint from tier
  const tier = options.endpointTier || 'default';
  const endpointId = runpodConfig.endpoints[tier] || runpodConfig.endpoints.default;

  if (!endpointId) {
    throw new Error(`RunPod endpoint not configured for tier "${tier}"`);
  }

  // Create provider
  const provider = new RunPodServerlessProvider({
    apiKey: runpodConfig.apiKey,
    endpointId,
    timeout: 120000,
    maxRetries: 2,
  });

  // Convert progress callback
  const runpodProgress: RunPodProgressCallback | undefined = onProgress
    ? (status) => {
        onProgress({
          phase: status.phase as ProviderProgressEvent['phase'],
          message: status.message,
          elapsedMs: status.elapsedMs,
        });
      }
    : undefined;

  // Call provider
  const response = await provider.generate(messages, options, runpodProgress);

  return {
    content: response.content,
    model: response.model,
    usage: response.usage,
  };
}

/**
 * HuggingFace provider call
 */
async function callHuggingFaceProvider(
  messages: ProviderMessage[],
  options: ProviderOptions,
  config: ServerProviderConfig
): Promise<ProviderResponse> {

  const hfConfig = config.huggingface;

  if (!hfConfig?.apiKey || !hfConfig?.endpointUrl) {
    throw new Error('HuggingFace not configured');
  }

  const provider = new HuggingFaceProvider({
    apiKey: hfConfig.apiKey,
    endpointUrl: hfConfig.endpointUrl,
  });

  const response = await provider.generate(messages, options);

  return {
    content: response.content,
    model: response.model,
    usage: response.usage,
  };
}

/**
 * Check if a server provider is available
 */
export function isServerProviderAvailable(
  providerName: string,
  config: ServerProviderConfig
): boolean {
  switch (providerName) {
    case 'runpod_serverless':
      return !!(config.runpod?.apiKey && config.runpod?.endpoints?.default);
    case 'huggingface':
      return !!(config.huggingface?.apiKey && config.huggingface?.endpointUrl);
    default:
      return false;
  }
}
