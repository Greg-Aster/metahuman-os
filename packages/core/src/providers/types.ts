/**
 * Provider Types
 *
 * Unified interface for ALL LLM providers (local and cloud).
 * Both core (Ollama) and server (RunPod, HuggingFace) implement this.
 */

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  repeatPenalty?: number;
  format?: 'text' | 'json';
  keepAlive?: string;
  // Cloud-specific
  endpointTier?: string;
}

export interface ProviderResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ProviderProgressEvent {
  phase: 'queued' | 'loading' | 'running' | 'completed' | 'failed';
  message: string;
  elapsedMs?: number;
}

export type ProviderProgressCallback = (event: ProviderProgressEvent) => void;

/**
 * Provider configuration passed to the bridge
 */
export interface ProviderConfig {
  // Local config
  ollama?: {
    endpoint: string;
  };
  // Cloud config (only used if server package is installed)
  runpod?: {
    apiKey: string;
    endpoints: Record<string, string | undefined>;
    endpointTiers?: Record<string, any>;
  };
  huggingface?: {
    apiKey: string;
    endpointUrl: string;
  };
}

/**
 * Provider type - determines where requests are routed
 *
 * Local providers: ollama, vllm, mock (handled by core bridge)
 * Cloud providers: runpod_serverless, huggingface (handled by @metahuman/server)
 */
export type ProviderType = 'ollama' | 'vllm' | 'mock' | 'runpod_serverless' | 'huggingface' | 'openai' | 'local';

/**
 * Check if a provider is a cloud provider (requires server package)
 */
export function isCloudProvider(provider: ProviderType): boolean {
  return provider === 'runpod_serverless' || provider === 'huggingface';
}

/**
 * Check if a provider is a local provider (handled by core)
 */
export function isLocalProvider(provider: ProviderType): boolean {
  return provider === 'ollama' || provider === 'vllm' || provider === 'mock';
}
