/**
 * HuggingFace Inference Endpoints Provider
 *
 * Implements the LLMProvider interface for HuggingFace's Inference Endpoints.
 * This is an alternative to RunPod for cloud GPU inference.
 *
 * NOTE: This is a placeholder implementation. Full implementation pending.
 */

import type { LLMMessage, LLMOptions, LLMResponse, LLMProvider } from './runpod.js';

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

// ============================================================================
// Provider Implementation
// ============================================================================

export class HuggingFaceProvider implements LLMProvider {
  name = 'huggingface';

  private apiKey: string;
  private endpointUrl: string;
  private timeout: number;

  constructor(config: HuggingFaceConfig) {
    this.apiKey = config.apiKey;
    this.endpointUrl = config.endpointUrl;
    this.timeout = config.timeout || 120000;

    if (!this.apiKey) {
      console.warn('[huggingface] No API key configured - provider will fail on requests');
    }
    if (!this.endpointUrl) {
      console.warn('[huggingface] No endpoint URL configured - provider will fail on requests');
    }
  }

  async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    // Build request payload (Text Generation Inference format)
    const systemMessage = messages.find(m => m.role === 'system');

    let prompt = '';
    if (systemMessage) {
      prompt += `<|system|>\n${systemMessage.content}\n`;
    }
    for (const msg of messages) {
      if (msg.role === 'user') {
        prompt += `<|user|>\n${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|assistant|>\n${msg.content}\n`;
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

      // Extract generated text
      let generatedText: string | undefined;
      if (Array.isArray(rawData) && rawData[0] && typeof rawData[0] === 'object') {
        generatedText = (rawData[0] as Record<string, unknown>).generated_text as string | undefined;
      } else if (rawData && typeof rawData === 'object') {
        generatedText = (rawData as Record<string, unknown>).generated_text as string | undefined;
      }

      if (!generatedText) {
        throw new Error('No generated text in HuggingFace response');
      }

      return {
        content: generatedText,
        model: 'huggingface-endpoint',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generateJSON<T = any>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    // Add JSON instruction to system prompt
    const jsonMessages = [...messages];
    const systemIdx = jsonMessages.findIndex(m => m.role === 'system');

    if (systemIdx >= 0) {
      jsonMessages[systemIdx] = {
        ...jsonMessages[systemIdx],
        content: jsonMessages[systemIdx].content + '\n\nRespond with valid JSON only.',
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
      throw new Error(`Failed to parse JSON response: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createHuggingFaceProvider(config: HuggingFaceConfig): HuggingFaceProvider {
  return new HuggingFaceProvider(config);
}
