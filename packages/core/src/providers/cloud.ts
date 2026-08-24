/**
 * Provider Bridge
 *
 * Canonical entry point for cloud inference providers.
 */

import { RunPodServerlessProvider } from './runpod.js';
import { HuggingFaceProvider } from './huggingface.js';
import type {
  ProviderConfig,
  ProviderMessage,
  ProviderOptions,
  ProviderProgressEvent,
  ProviderResponse,
  ProviderType,
} from './types.js';

export type CloudProviderName = Extract<ProviderType, 'runpod_serverless' | 'huggingface'>;
export type CloudProviderConfig = Pick<ProviderConfig, 'runpod' | 'huggingface'>;

/**
 * Call one configured cloud provider.
 */
export async function callCloudProvider(
  providerName: CloudProviderName,
  messages: ProviderMessage[],
  options: ProviderOptions,
  config: CloudProviderConfig,
  onProgress?: (event: ProviderProgressEvent) => void
): Promise<ProviderResponse> {

  switch (providerName) {
    case 'runpod_serverless':
      return callRunPodProvider(messages, options, config, onProgress);

    case 'huggingface':
      return callHuggingFaceProvider(messages, options, config);

    default:
      throw new Error(`Unknown cloud provider: ${providerName}`);
  }
}

/**
 * RunPod provider call.
 */
async function callRunPodProvider(
  messages: ProviderMessage[],
  options: ProviderOptions,
  config: CloudProviderConfig,
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

  return provider.generate(messages, options, onProgress);
}

/**
 * HuggingFace provider call
 */
async function callHuggingFaceProvider(
  messages: ProviderMessage[],
  options: ProviderOptions,
  config: CloudProviderConfig
): Promise<ProviderResponse> {

  const hfConfig = config.huggingface;

  if (!hfConfig?.apiKey || !hfConfig?.endpointUrl) {
    throw new Error('HuggingFace not configured');
  }

  const provider = new HuggingFaceProvider({
    apiKey: hfConfig.apiKey,
    endpointUrl: hfConfig.endpointUrl,
  });

  return provider.generate(messages, options);
}

/**
 * Check whether a cloud provider has complete configuration.
 */
export function isCloudProviderAvailable(
  providerName: CloudProviderName,
  config: CloudProviderConfig
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
