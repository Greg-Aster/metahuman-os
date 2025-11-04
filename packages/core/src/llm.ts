/**
 * LLM Adapter - Unified interface for multiple AI providers
 * Supports: Ollama (local), OpenAI, Anthropic, and custom providers
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  generateJSON<T = any>(messages: LLMMessage[], options?: LLMOptions): Promise<T>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  format?: 'text' | 'json';
}

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths';

/**
 * Ollama Provider - Local LLM via Ollama
 */
export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private endpoint: string;
  private defaultModel: string;
  private activeAdapter: string | null = null;
  private static adapterLogged = false; // Track if we've already logged the adapter

  constructor(endpoint = 'http://localhost:11434') {
    this.endpoint = endpoint;

    // Read single config file for ALL LLM settings
    try {
      const configPath = path.join(ROOT, 'etc', 'agent.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Base model (required)
      this.defaultModel = config.model || 'phi3:mini';

      // Adapter (optional) - only use if explicitly enabled
      if (config.useAdapter && config.adapterModel) {
        this.activeAdapter = config.adapterModel;
        if (!OllamaProvider.adapterLogged) {
          console.log(`[llm] Using adapter: ${this.activeAdapter}`);
          OllamaProvider.adapterLogged = true;
        }
      } else {
        this.activeAdapter = null;
        if (!OllamaProvider.adapterLogged) {
          console.log(`[llm] Using base model: ${this.defaultModel}`);
          OllamaProvider.adapterLogged = true;
        }
      }
    } catch (error) {
      console.error('Error reading agent config, falling back to defaults:', error);
      this.defaultModel = 'phi3:mini';
      this.activeAdapter = null;
    }
  }

  async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const url = `${this.endpoint}/api/chat`;
    // Use active adapter if available, otherwise fall back to default model
    const model = this.activeAdapter || options.model || this.defaultModel;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            num_predict: options.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.message.content,
        model: data.model,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
      };
    } catch (error) {
      throw new Error(`Ollama generation failed: ${(error as Error).message}`);
    }
  }

  async generateJSON<T = any>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    const url = `${this.endpoint}/api/chat`;
    // Use active adapter if available, otherwise fall back to default model
    const model = this.activeAdapter || options.model || this.defaultModel;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          format: 'json',
          stream: false,
          options: {
            temperature: options.temperature || 0.3, // Lower temp for structured output
            num_predict: options.maxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.message.content;

      // Parse JSON response
      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(`Ollama JSON generation failed: ${(error as Error).message}`);
    }
  }
}

/**
 * Mock Provider - For testing without LLM
 */
export class MockProvider implements LLMProvider {
  name = 'mock';

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: 'Mock response',
      model: 'mock',
    };
  }

  async generateJSON<T = any>(): Promise<T> {
    return { tags: [], entities: [] } as T;
  }
}

/**
 * OpenAI Provider - For future integration
 */
export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel = 'gpt-4') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens,
          response_format: options.format === 'json' ? { type: 'json_object' } : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        content: data.choices[0].message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
      };
    } catch (error) {
      throw new Error(`OpenAI generation failed: ${(error as Error).message}`);
    }
  }

  async generateJSON<T = any>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    const response = await this.generate(messages, { ...options, format: 'json' });
    return JSON.parse(response.content) as T;
  }
}

/**
 * LLM Manager - Selects and manages providers
 */
export class LLMManager {
  private providers: Map<string, LLMProvider> = new Map();
  private defaultProvider: string = 'ollama';

  constructor() {
    // Register default providers
    this.registerProvider('ollama', new OllamaProvider());
    this.registerProvider('mock', new MockProvider());
  }

  registerProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not registered`);
    }
    this.defaultProvider = name;
  }

  getProvider(name?: string): LLMProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Provider '${providerName}' not found`);
    }

    return provider;
  }

  async generate(messages: LLMMessage[], provider?: string, options?: LLMOptions): Promise<LLMResponse> {
    return this.getProvider(provider).generate(messages, options);
  }

  async generateJSON<T = any>(messages: LLMMessage[], provider?: string, options?: LLMOptions): Promise<T> {
    return this.getProvider(provider).generateJSON<T>(messages, options);
  }
}

// Singleton instance
export const llm = new LLMManager();
