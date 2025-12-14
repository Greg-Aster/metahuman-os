/**
 * Local Models Provider
 *
 * Provider bridge integration for the local-model-service.
 * Handles both embeddings and text generation via HTTP.
 */

import type { ProviderMessage, ProviderOptions, ProviderResponse, ProviderProgressCallback } from './types.js';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4324';

/**
 * Check if the local model service is running
 */
export async function isLocalModelServiceRunning(
  endpoint: string = DEFAULT_ENDPOINT
): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get the status of loaded models
 */
export async function getLocalModelStatus(
  endpoint: string = DEFAULT_ENDPOINT
): Promise<{
  embedder: { model: string | null; loaded: boolean };
  generator: { model: string | null; loaded: boolean };
} | null> {
  try {
    const response = await fetch(`${endpoint}/models/loaded`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Generate embeddings using the local model service
 */
export async function embedWithLocalService(
  text: string,
  options: {
    model?: string;
    endpoint?: string;
  } = {}
): Promise<number[]> {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;

  const response = await fetch(`${endpoint}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model: options.model
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Local model service error: ${errorText}`);
  }

  const result = await response.json();
  return result.embeddings[0];
}

/**
 * Generate text using the local model service
 */
export async function generateWithLocalService(
  messages: ProviderMessage[],
  options: ProviderOptions & { endpoint?: string } = {},
  onProgress?: ProviderProgressCallback
): Promise<ProviderResponse> {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;

  onProgress?.({
    phase: 'loading',
    message: 'Connecting to local model service...'
  });

  // Convert messages to prompt format
  const prompt = messages.map(m => {
    if (m.role === 'system') return `System: ${m.content}`;
    if (m.role === 'user') return `User: ${m.content}`;
    return `Assistant: ${m.content}`;
  }).join('\n\n') + '\n\nAssistant:';

  onProgress?.({
    phase: 'running',
    message: 'Generating response...'
  });

  const startTime = Date.now();

  const response = await fetch(`${endpoint}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    onProgress?.({
      phase: 'failed',
      message: `Generation failed: ${errorText}`
    });
    throw new Error(`Local model service error: ${errorText}`);
  }

  const result = await response.json();
  const elapsedMs = Date.now() - startTime;

  onProgress?.({
    phase: 'completed',
    message: 'Generation complete',
    elapsedMs
  });

  // Extract the assistant's response (after "Assistant:")
  let content = result.text;
  const assistantPrefix = 'Assistant:';
  const lastAssistantIdx = content.lastIndexOf(assistantPrefix);
  if (lastAssistantIdx !== -1) {
    content = content.substring(lastAssistantIdx + assistantPrefix.length).trim();
  }

  return {
    content,
    model: result.model,
    provider: 'local-models'
  };
}

/**
 * Download a model via the local model service
 */
export async function downloadLocalModel(
  type: 'embeddings' | 'llm',
  model: string,
  endpoint: string = DEFAULT_ENDPOINT
): Promise<{ status: string; model: string; type: string }> {
  const response = await fetch(`${endpoint}/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, model })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to start download: ${errorText}`);
  }

  return await response.json();
}

/**
 * Load a specific model
 */
export async function loadLocalModel(
  type: 'embeddings' | 'llm',
  model: string,
  endpoint: string = DEFAULT_ENDPOINT
): Promise<{ status: string; model: string; type: string }> {
  const response = await fetch(`${endpoint}/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, model })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to load model: ${errorText}`);
  }

  return await response.json();
}

/**
 * Unload a model to free memory
 */
export async function unloadLocalModel(
  type: 'embeddings' | 'llm',
  endpoint: string = DEFAULT_ENDPOINT
): Promise<{ status: string; type: string }> {
  const response = await fetch(`${endpoint}/models/unload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to unload model: ${errorText}`);
  }

  return await response.json();
}

/**
 * Get list of available models with download status
 */
export async function getAvailableLocalModels(
  endpoint: string = DEFAULT_ENDPOINT
): Promise<{
  embeddings: Array<{ id: string; config: any; downloaded: boolean }>;
  llm: Array<{ id: string; config: any; downloaded: boolean }>;
} | null> {
  try {
    const response = await fetch(`${endpoint}/models`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Get current local model service configuration
 */
export async function getLocalModelConfig(
  endpoint: string = DEFAULT_ENDPOINT
): Promise<any | null> {
  try {
    const response = await fetch(`${endpoint}/config`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Update local model service configuration
 */
export async function updateLocalModelConfig(
  config: Record<string, any>,
  endpoint: string = DEFAULT_ENDPOINT
): Promise<any> {
  const response = await fetch(`${endpoint}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to update config: ${errorText}`);
  }

  return await response.json();
}
