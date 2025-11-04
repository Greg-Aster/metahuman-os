/**
 * Ollama Integration - Direct access to Ollama API
 * Provides commands for model management, chat, and status
 */

export interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
  modified_at: string;
}

export interface OllamaVersion {
  version: string;
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaEmbeddingsResponse {
  model: string;
  embedding: number[];
}

/**
 * Ollama API Client
 */
export class OllamaClient {
  private endpoint: string;

  constructor(endpoint = 'http://localhost:11434') {
    this.endpoint = endpoint;
  }

  /**
   * Check if Ollama is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get Ollama version
   */
  async version(): Promise<OllamaVersion> {
    const response = await fetch(`${this.endpoint}/api/version`);
    if (!response.ok) {
      throw new Error(`Failed to get version: ${response.status}`);
    }
    return response.json();
  }

  /**
   * List installed models
   */
  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.endpoint}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json();
    return data.models || [];
  }

  /**
   * Pull a model from Ollama library
   */
  async pullModel(modelName: string, onProgress?: (progress: string) => void): Promise<void> {
    const response = await fetch(`${this.endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (onProgress && data.status) {
            onProgress(data.status);
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete model: ${response.status}`);
    }
  }

  /**
   * Show model info
   */
  async showModel(modelName: string): Promise<any> {
    const response = await fetch(`${this.endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to show model: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Chat with a model
   */
  async chat(
    model: string,
    messages: OllamaChatMessage[],
    options?: {
      temperature?: number
      stream?: boolean
      top_p?: number
      top_k?: number
      repeat_penalty?: number
      repeat_last_n?: number
      num_ctx?: number
      num_predict?: number
      mirostat?: number
      mirostat_eta?: number
      mirostat_tau?: number
    }
  ): Promise<OllamaChatResponse> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: options?.stream || false,
        options: Object.fromEntries(
          Object.entries({
            temperature: options?.temperature ?? 0.7,
            top_p: options?.top_p,
            top_k: options?.top_k,
            repeat_penalty: options?.repeat_penalty,
            repeat_last_n: options?.repeat_last_n,
            num_ctx: options?.num_ctx,
            num_predict: options?.num_predict,
            mirostat: options?.mirostat,
            mirostat_eta: options?.mirostat_eta,
            mirostat_tau: options?.mirostat_tau,
          }).filter(([, v]) => v !== undefined)
        ),
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Generate a completion
   */
  async generate(
    model: string,
    prompt: string,
    options?: { temperature?: number }
  ): Promise<OllamaGenerateResponse> {
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature || 0.7,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Generate request failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Generate embeddings for text
   */
  async embeddings(model: string, prompt: string): Promise<OllamaEmbeddingsResponse> {
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt }),
    });

    if (!response.ok) {
      throw new Error(`Embeddings request failed: ${response.status}`);
    }

    return response.json();
  }
}

// Singleton instance
export const ollama = new OllamaClient();
