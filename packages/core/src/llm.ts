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
import { ROOT } from './path-builder.js';

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

    // Read model registry for ALL LLM settings
    try {
      const configPath = path.join(ROOT, 'etc', 'models.json');
      const registry = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Get fallback/default model from registry
      const fallbackModelId = registry.defaults?.fallback || 'default.fallback';
      const fallbackModel = registry.models?.[fallbackModelId];
      this.defaultModel = fallbackModel?.model || 'phi3:mini';

      // Adapter (optional) - only use if explicitly enabled in globalSettings
      if (registry.globalSettings?.useAdapter && registry.globalSettings?.activeAdapter) {
        const activeAdapter = registry.globalSettings.activeAdapter;
        this.activeAdapter = activeAdapter;
        if (!OllamaProvider.adapterLogged) {
          const adapterName = typeof activeAdapter === 'object' && activeAdapter.modelName
            ? activeAdapter.modelName
            : JSON.stringify(activeAdapter);
          console.log(`[llm] Using adapter: ${adapterName}`);
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
      console.error('Error reading model registry, falling back to defaults:', error);
      this.defaultModel = 'phi3:mini';
      this.activeAdapter = null;
    }
  }

  async generate(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const url = `${this.endpoint}/api/chat`;
    // Use active adapter if available, otherwise fall back to default model
    const model = this.activeAdapter || options.model || this.defaultModel;

    try {
      const body: any = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens,
        },
      };

      // BUGFIX: Support JSON format mode for structured output
      if (options.format === 'json') {
        body.format = 'json';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
 *
 * In local mode: Uses Ollama (default) and Mock providers
 * In server mode: Dynamically loads RunPod/HuggingFace providers from @metahuman/server
 */
export class LLMManager {
  private providers: Map<string, LLMProvider> = new Map();
  private defaultProvider: string = 'ollama';
  private serverProvidersLoaded: boolean = false;

  constructor() {
    // Register default local providers
    this.registerProvider('ollama', new OllamaProvider());
    this.registerProvider('mock', new MockProvider());

    // Note: Server providers are loaded lazily via loadServerProviders()
    // This is called automatically when getProvider() is called for a server provider
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

  /**
   * Dynamically load server providers from @metahuman/server package
   * This is called automatically when a server provider is requested
   *
   * @returns true if server providers were loaded, false if already loaded or failed
   */
  async loadServerProviders(): Promise<boolean> {
    if (this.serverProvidersLoaded) {
      return false;
    }

    try {
      // Dynamic import - won't fail build if @metahuman/server not installed
      const serverModule = await import('@metahuman/server');

      // Load deployment config to get provider settings
      const { loadDeploymentConfig } = await import('./deployment.js');
      const config = loadDeploymentConfig();

      // Register RunPod provider if configured
      if (config.server.runpod?.apiKey && config.server.runpod?.endpoints?.default) {
        const runpodProvider = new serverModule.RunPodServerlessProvider({
          apiKey: config.server.runpod.apiKey,
          endpointId: config.server.runpod.endpoints.default,
        });
        this.registerProvider('runpod_serverless', runpodProvider);
        console.log('[llm] Registered RunPod serverless provider');
      }

      // Register HuggingFace provider if configured
      if (config.server.huggingface?.apiKey && config.server.huggingface?.endpointUrl) {
        const hfProvider = new serverModule.HuggingFaceProvider({
          apiKey: config.server.huggingface.apiKey,
          endpointUrl: config.server.huggingface.endpointUrl,
        });
        this.registerProvider('huggingface', hfProvider);
        console.log('[llm] Registered HuggingFace provider');
      }

      this.serverProvidersLoaded = true;
      return true;

    } catch (error) {
      // @metahuman/server not installed or import failed
      // This is expected in local mode - not an error
      console.log('[llm] Server providers not available (local mode or @metahuman/server not installed)');
      this.serverProvidersLoaded = true; // Don't retry
      return false;
    }
  }

  /**
   * Check if a provider name is a server provider
   */
  private isServerProvider(name: string): boolean {
    return ['runpod_serverless', 'huggingface'].includes(name);
  }

  getProvider(name?: string): LLMProvider {
    const providerName = name || this.defaultProvider;

    // If requesting a server provider and not loaded yet, try to load
    if (this.isServerProvider(providerName) && !this.serverProvidersLoaded) {
      // Note: This is sync, but loadServerProviders is async
      // For sync access, providers must be pre-loaded
      // Use getProviderAsync for guaranteed server provider access
      console.warn(`[llm] Server provider '${providerName}' requested but not loaded. Use getProviderAsync() or call loadServerProviders() first.`);
    }

    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Provider '${providerName}' not found. Available: ${Array.from(this.providers.keys()).join(', ')}`);
    }

    return provider;
  }

  /**
   * Get provider with async server provider loading support
   */
  async getProviderAsync(name?: string): Promise<LLMProvider> {
    const providerName = name || this.defaultProvider;

    // Load server providers if requesting one and not loaded yet
    if (this.isServerProvider(providerName) && !this.serverProvidersLoaded) {
      await this.loadServerProviders();
    }

    return this.getProvider(providerName);
  }

  /**
   * Check if a provider is available
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * List all available providers
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  async generate(messages: LLMMessage[], provider?: string, options?: LLMOptions): Promise<LLMResponse> {
    const p = provider && this.isServerProvider(provider)
      ? await this.getProviderAsync(provider)
      : this.getProvider(provider);
    return p.generate(messages, options);
  }

  async generateJSON<T = any>(messages: LLMMessage[], provider?: string, options?: LLMOptions): Promise<T> {
    const p = provider && this.isServerProvider(provider)
      ? await this.getProviderAsync(provider)
      : this.getProvider(provider);
    return p.generateJSON<T>(messages, options);
  }
}

// Singleton instance
export const llm = new LLMManager();
