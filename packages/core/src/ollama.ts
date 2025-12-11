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
      format?: string // BUGFIX: Support JSON mode to constrain output format
      keep_alive?: string | number // How long to keep model in VRAM (0 = unload immediately, "5m" = 5 minutes)
    }
  ): Promise<OllamaChatResponse> {
    // BUGFIX: Build request body with format at top level (not in options)
    const requestBody: any = {
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
    };

    // BUGFIX: Add format as top-level parameter (Ollama API requirement)
    if (options?.format) {
      requestBody.format = options.format;
    }

    // Add keep_alive if specified (controls how long model stays in VRAM)
    if (options?.keep_alive !== undefined) {
      requestBody.keep_alive = options.keep_alive;
    }

    // 2 minute timeout for LLM chat (large models can take time)
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      let errorMsg = `Chat request failed: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMsg += ` - ${errorData.error}`;
        }
        console.error('[Ollama] Chat error response:', errorData);
      } catch {
        // If error response isn't JSON, try text
        const errorText = await response.text().catch(() => '');
        if (errorText) {
          errorMsg += ` - ${errorText}`;
          console.error('[Ollama] Chat error text:', errorText);
        }
      }
      throw new Error(errorMsg);
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
    // 2 minute timeout for generation
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
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      throw new Error(`Generate request failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Generate embeddings for text
   * @param model - Ollama model name
   * @param prompt - Text to embed
   * @param options - Optional settings (num_gpu: 0 forces CPU-only inference)
   */
  async embeddings(
    model: string,
    prompt: string,
    options?: { num_gpu?: number }
  ): Promise<OllamaEmbeddingsResponse> {
    const body: Record<string, unknown> = { model, prompt };

    // num_gpu: 0 forces CPU inference (leaves GPU free for vLLM)
    if (options?.num_gpu !== undefined) {
      body.options = { num_gpu: options.num_gpu };
    }

    // 30 second timeout for embeddings
    const response = await fetch(`${this.endpoint}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(`Embeddings request failed: ${response.status}${bodyText ? ` - ${bodyText}` : ''}`);
    }

    return response.json();
  }

  /**
   * Get currently running/loaded models (equivalent to `ollama ps`)
   * Returns list of models currently loaded in memory with GPU usage info
   */
  async getRunningModels(): Promise<{
    models: Array<{
      name: string;
      model: string;
      size: number;
      sizeVram: number;
      digest: string;
      expiresAt: string;
    }>;
  }> {
    const response = await fetch(`${this.endpoint}/api/ps`);
    if (!response.ok) {
      throw new Error(`Failed to get running models: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Unload all models from GPU memory
   * Sends a generate request with keep_alive: 0 for each loaded model
   */
  async unloadAllModels(): Promise<{ unloaded: string[]; errors: string[] }> {
    const unloaded: string[] = [];
    const errors: string[] = [];

    try {
      const running = await this.getRunningModels();

      for (const model of running.models) {
        try {
          console.log(`[ollama] Unloading model: ${model.name}`);
          const response = await fetch(`${this.endpoint}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model.name,
              prompt: '',
              keep_alive: 0,
            }),
          });

          if (response.ok) {
            unloaded.push(model.name);
            console.log(`[ollama] Unloaded: ${model.name}`);
          } else {
            errors.push(`${model.name}: ${response.status}`);
          }
        } catch (err) {
          errors.push(`${model.name}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`Failed to get running models: ${(err as Error).message}`);
    }

    return { unloaded, errors };
  }

  /**
   * Stop the Ollama service
   * Falls back to pkill if systemctl requires sudo password
   */
  async stopService(): Promise<{ success: boolean; error?: string }> {
    const { execSync } = await import('node:child_process');

    // First, unload all models to free VRAM
    console.log('[ollama] Unloading models first...');
    try {
      await this.unloadAllModels();
    } catch {
      // Continue even if unload fails
    }

    // Try systemctl without sudo first (works on many systems)
    console.log('[ollama] Attempting to stop Ollama service...');
    try {
      execSync('systemctl stop ollama', { stdio: 'pipe', timeout: 5000 });
      await new Promise(r => setTimeout(r, 1000));
      console.log('[ollama] Service stopped via systemctl');
      return { success: true };
    } catch {
      // Try with sudo -n (no password prompt)
      try {
        execSync('sudo -n systemctl stop ollama', { stdio: 'pipe', timeout: 5000 });
        await new Promise(r => setTimeout(r, 1000));
        console.log('[ollama] Service stopped via sudo systemctl');
        return { success: true };
      } catch {
        console.log('[ollama] systemctl failed, using pkill fallback...');
      }
    }

    // Fallback: kill ollama processes directly
    try {
      // Try SIGTERM first for graceful shutdown
      try {
        execSync('pkill -f "ollama serve"', { stdio: 'pipe' });
      } catch { /* No process found */ }

      await new Promise(r => setTimeout(r, 1000));

      // Force kill if still running
      try {
        execSync('pkill -9 -f "ollama serve"', { stdio: 'pipe' });
      } catch { /* No process found */ }

      // Also kill any remaining ollama processes
      try {
        execSync('pkill -9 -f "^ollama"', { stdio: 'pipe' });
      } catch { /* No process found */ }

      await new Promise(r => setTimeout(r, 500));

      // Verify it's stopped
      const stillRunning = await this.isRunning();
      if (stillRunning) {
        return { success: false, error: 'Ollama still running after pkill' };
      }

      console.log('[ollama] Service stopped via pkill');
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[ollama] Failed to stop service:', error);
      return { success: false, error };
    }
  }

  /**
   * Start the Ollama service
   * Falls back to direct binary execution if systemctl requires password
   */
  async startService(): Promise<{ success: boolean; error?: string }> {
    const { execSync, spawn } = await import('node:child_process');

    // Try systemctl without sudo first (works on many systems)
    console.log('[ollama] Attempting to start Ollama service...');
    const trySystemctl = async (cmd: string): Promise<boolean> => {
      try {
        execSync(cmd, { stdio: 'pipe', timeout: 5000 });
        const maxWait = 10000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          if (await this.isRunning()) {
            return true;
          }
          await new Promise(r => setTimeout(r, 500));
        }
      } catch { }
      return false;
    };

    if (await trySystemctl('systemctl start ollama')) {
      console.log('[ollama] Service started via systemctl');
      return { success: true };
    }

    if (await trySystemctl('sudo -n systemctl start ollama')) {
      console.log('[ollama] Service started via sudo systemctl');
      return { success: true };
    }

    console.log('[ollama] systemctl failed, starting ollama directly...');

    // Fallback: start ollama serve directly
    try {
      // Check if ollama binary exists
      let ollamaPath = 'ollama';
      try {
        execSync('which ollama', { stdio: 'pipe' });
      } catch {
        // Try common install locations
        const paths = ['/usr/local/bin/ollama', '/usr/bin/ollama'];
        for (const p of paths) {
          try {
            const fs = await import('node:fs');
            if (fs.existsSync(p)) {
              ollamaPath = p;
              break;
            }
          } catch { }
        }
      }

      // Spawn ollama serve in background
      const child = spawn(ollamaPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      // Wait for it to start
      const maxWait = 10000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        if (await this.isRunning()) {
          console.log('[ollama] Service started directly');
          return { success: true };
        }
        await new Promise(r => setTimeout(r, 500));
      }

      return { success: false, error: 'Timeout waiting for ollama serve to start' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[ollama] Failed to start service:', error);
      return { success: false, error };
    }
  }

  /**
   * Check if a specific model is currently loaded in memory
   */
  async isModelLoaded(modelName: string): Promise<boolean> {
    try {
      const running = await this.getRunningModels();
      return running.models.some(m =>
        m.name === modelName ||
        m.name.startsWith(modelName + ':') ||
        m.model === modelName
      );
    } catch {
      return false;
    }
  }

  /**
   * Wait for a model to become available (GPU not busy with different model)
   * Returns true if model is ready, false if timed out
   */
  async waitForModelAvailability(
    modelName: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      onWaiting?: (currentModel: string, elapsedMs: number) => void;
    }
  ): Promise<{ ready: boolean; currentModel?: string; waitedMs: number }> {
    const timeoutMs = options?.timeoutMs ?? 30000; // 30 second default
    const pollIntervalMs = options?.pollIntervalMs ?? 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const running = await this.getRunningModels();

        // No models running - GPU is free
        if (running.models.length === 0) {
          return { ready: true, waitedMs: Date.now() - startTime };
        }

        // Check if our model is already loaded
        const ourModelLoaded = running.models.some(m =>
          m.name === modelName ||
          m.name.startsWith(modelName + ':') ||
          m.model === modelName
        );

        if (ourModelLoaded) {
          return { ready: true, waitedMs: Date.now() - startTime };
        }

        // Another model is running - notify and wait
        const currentModel = running.models[0]?.name || 'unknown';
        const elapsed = Date.now() - startTime;

        if (options?.onWaiting) {
          options.onWaiting(currentModel, elapsed);
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      } catch (error) {
        // If we can't check, assume available and let the actual request fail
        console.warn('[Ollama] Error checking model availability:', error);
        return { ready: true, waitedMs: Date.now() - startTime };
      }
    }

    // Timed out waiting
    const running = await this.getRunningModels().catch(() => ({ models: [] }));
    return {
      ready: false,
      currentModel: running.models[0]?.name,
      waitedMs: Date.now() - startTime
    };
  }

  /**
   * Get Ollama health status including model availability
   * Returns status object with running state and available models
   */
  async getHealthStatus(): Promise<{
    running: boolean;
    hasModels: boolean;
    modelCount: number;
    models: string[];
    error?: string;
  }> {
    try {
      const running = await this.isRunning();
      if (!running) {
        return {
          running: false,
          hasModels: false,
          modelCount: 0,
          models: [],
          error: 'Ollama service is not running',
        };
      }

      const models = await this.listModels();
      return {
        running: true,
        hasModels: models.length > 0,
        modelCount: models.length,
        models: models.map(m => m.name),
      };
    } catch (error) {
      return {
        running: false,
        hasModels: false,
        modelCount: 0,
        models: [],
        error: String(error),
      };
    }
  }
}

// Singleton instance
export const ollama = new OllamaClient();

/**
 * Quick health check for Ollama - returns status object
 * Suitable for use in API endpoints and UI health checks
 */
export async function checkOllamaHealth(): Promise<{
  running: boolean;
  hasModels: boolean;
  modelCount: number;
  models: string[];
  error?: string;
}> {
  return ollama.getHealthStatus();
}

/**
 * Check if Ollama is running
 * Convenience function that uses the singleton OllamaClient instance
 */
export async function isRunning(): Promise<boolean> {
  return ollama.isRunning();
}

/**
 * Stop the Ollama systemd service
 * This fully stops Ollama and frees all GPU memory
 */
export async function stopOllamaService(): Promise<{ success: boolean; error?: string }> {
  return ollama.stopService();
}

/**
 * Start the Ollama systemd service
 */
export async function startOllamaService(): Promise<{ success: boolean; error?: string }> {
  return ollama.startService();
}
