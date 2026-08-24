/**
 * HuggingFace Inference Endpoints Provider
 *
 * Implements the canonical Core provider contract for HuggingFace Inference Endpoints.
 * This is an alternative to RunPod for cloud GPU inference.
 */

import type {
  ProviderMessage,
  ProviderOptions,
  ProviderResponse,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface HuggingFaceConfig {
  /** HuggingFace API key */
  apiKey: string;
  /** Inference Endpoint URL */
  endpointUrl: string;
  /** Request timeout in ms (default: 120000) */
  timeout?: number;
}

function extractGeneratedText(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const generatedText = (candidate as Record<string, unknown>).generated_text;
  return typeof generatedText === 'string' && generatedText.length > 0 ? generatedText : undefined;
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class HuggingFaceProvider {
  readonly name = 'huggingface';

  private apiKey: string;
  private endpointUrl: string;
  private timeout: number;

  constructor(config: HuggingFaceConfig) {
    if (!config.apiKey?.trim()) throw new TypeError('HuggingFace API key is required');
    if (!config.endpointUrl?.trim()) throw new TypeError('HuggingFace endpoint URL is required');
    if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
      throw new TypeError('HuggingFace timeout must be a positive number');
    }

    this.apiKey = config.apiKey.trim();
    this.endpointUrl = config.endpointUrl.trim();
    this.timeout = config.timeout ?? 120000;
  }

  async generate(messages: ProviderMessage[], options: ProviderOptions = {}): Promise<ProviderResponse> {
    // Build request payload (Text Generation Inference format)
    const systemMessage = messages.find(m => m.role === 'system');

    let prompt = '';
    if (systemMessage) {
      prompt += `<|system|>\n${this.requireTextContent(systemMessage)}\n`;
    }
    for (const msg of messages) {
      if (msg.role === 'user') {
        prompt += `<|user|>\n${this.requireTextContent(msg)}\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|assistant|>\n${this.requireTextContent(msg)}\n`;
      }
    }
    prompt += '<|assistant|>\n';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: options.maxTokens ?? 512,
            temperature: options.temperature ?? 0.7,
            return_full_text: false,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HuggingFace request failed (${response.status}): ${errorText}`);
      }

      const rawData: unknown = await response.json();

      const generatedText = extractGeneratedText(rawData);

      if (!generatedText) {
        throw new Error('No generated text in HuggingFace response');
      }

      return {
        content: generatedText,
        model: 'huggingface-endpoint',
        provider: this.name,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generateJSON<T = unknown>(messages: ProviderMessage[], options: ProviderOptions = {}): Promise<T> {
    // Add JSON instruction to system prompt
    const jsonMessages = [...messages];
    const systemIdx = jsonMessages.findIndex(m => m.role === 'system');

    if (systemIdx >= 0) {
      jsonMessages[systemIdx] = {
        ...jsonMessages[systemIdx],
        content: this.requireTextContent(jsonMessages[systemIdx]) + '\n\nRespond with valid JSON only.',
      };
    } else {
      jsonMessages.unshift({
        role: 'system',
        content: 'Respond with valid JSON only.',
      });
    }

    const response = await this.generate(jsonMessages, options);

    try {
      return JSON.parse(response.content) as T;
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private requireTextContent(message: ProviderMessage): string {
    if (typeof message.content === 'string') return message.content;
    throw new Error('HuggingFace Inference Endpoints do not support image message content');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createHuggingFaceProvider(config: HuggingFaceConfig): HuggingFaceProvider {
  return new HuggingFaceProvider(config);
}
