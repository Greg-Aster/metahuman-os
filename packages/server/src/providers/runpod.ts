/**
 * RunPod Serverless Provider
 *
 * Implements the LLMProvider interface for RunPod's serverless GPU endpoints.
 * Supports both synchronous (runsync) and asynchronous (run) modes.
 *
 * Key features:
 * - Cold start detection and progress reporting
 * - Automatic retry with exponential backoff
 * - Token usage tracking
 * - Error categorization (rate limit, timeout, model error, etc.)
 */

// ============================================================================
// Types (standalone to avoid core dependency at type level)
// ============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  format?: 'text' | 'json';
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

// ============================================================================
// RunPod-Specific Types
// ============================================================================

export interface RunPodConfig {
  /** RunPod API key */
  apiKey: string;
  /** Serverless endpoint ID */
  endpointId: string;
  /** Custom base URL (optional, for self-hosted) */
  baseUrl?: string;
  /** Request timeout in ms (default: 120000) */
  timeout?: number;
  /** Max retries on transient failures (default: 2) */
  maxRetries?: number;
}

export interface RunPodJobInput {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  repeat_penalty?: number;
  format?: 'text' | 'json';
}

export interface RunPodJobOutput {
  response?: string;
  content?: string;
  message?: { content: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: string;
}

export interface RunPodJobStatus {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  output?: RunPodJobOutput;
  error?: string;
  delayTime?: number;
  executionTime?: number;
}

export type RunPodProgressCallback = (status: {
  phase: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
  elapsedMs?: number;
  queuePosition?: number;
}) => void;

// ============================================================================
// Error Classes
// ============================================================================

export class RunPodError extends Error {
  constructor(
    message: string,
    public code: 'RATE_LIMIT' | 'TIMEOUT' | 'MODEL_ERROR' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'UNKNOWN',
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'RunPodError';
  }
}

// ============================================================================
// Provider Implementation
// ============================================================================

export class RunPodServerlessProvider implements LLMProvider {
  name = 'runpod_serverless';

  private apiKey: string;
  private endpointId: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: RunPodConfig) {
    this.apiKey = config.apiKey;
    this.endpointId = config.endpointId;
    this.baseUrl = config.baseUrl || 'https://api.runpod.ai/v2';
    this.timeout = config.timeout || 120000; // 2 minutes default
    this.maxRetries = config.maxRetries || 2;

    if (!this.apiKey) {
      console.warn('[runpod] No API key configured - provider will fail on requests');
    }
    if (!this.endpointId) {
      console.warn('[runpod] No endpoint ID configured - provider will fail on requests');
    }
  }

  /**
   * Generate a response using RunPod serverless endpoint (synchronous mode)
   */
  async generate(
    messages: LLMMessage[],
    options: LLMOptions = {},
    onProgress?: RunPodProgressCallback
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeRequest(messages, options, onProgress, startTime);
      } catch (error) {
        lastError = error as Error;

        // Check if error is retryable
        if (error instanceof RunPodError && error.retryable && attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[runpod] Retry ${attempt + 1}/${this.maxRetries} after ${backoffMs}ms`);
          await this.sleep(backoffMs);
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('RunPod request failed after retries');
  }

  /**
   * Generate a JSON response
   */
  async generateJSON<T = any>(messages: LLMMessage[], options: LLMOptions = {}): Promise<T> {
    const response = await this.generate(messages, { ...options, format: 'json' });

    try {
      return JSON.parse(response.content) as T;
    } catch (error) {
      throw new RunPodError(
        `Failed to parse JSON response: ${(error as Error).message}`,
        'MODEL_ERROR'
      );
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeRequest(
    messages: LLMMessage[],
    options: LLMOptions,
    onProgress?: RunPodProgressCallback,
    startTime: number = Date.now()
  ): Promise<LLMResponse> {
    // Build request input
    const input: RunPodJobInput = {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 512,
    };

    if (options.model) {
      input.model = options.model;
    }

    if (options.format === 'json') {
      input.format = 'json';
    }

    // Report initial status
    onProgress?.({
      phase: 'queued',
      message: 'Sending request to GPU...',
      elapsedMs: Date.now() - startTime,
    });

    // Use synchronous endpoint for simplicity
    const url = `${this.baseUrl}/${this.endpointId}/runsync`;

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });

    // Handle HTTP errors
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw this.categorizeHttpError(response.status, errorText);
    }

    const result = await response.json() as RunPodJobStatus;

    // Handle job status
    if (result.status === 'FAILED' || result.status === 'CANCELLED') {
      throw new RunPodError(
        result.error || 'Job failed',
        'MODEL_ERROR'
      );
    }

    if (result.status === 'TIMED_OUT') {
      throw new RunPodError(
        'GPU request timed out - try again or use a smaller request',
        'TIMEOUT',
        undefined,
        true
      );
    }

    if (result.status === 'IN_QUEUE' || result.status === 'IN_PROGRESS') {
      // For runsync, this shouldn't happen, but handle it
      onProgress?.({
        phase: 'running',
        message: 'Processing on GPU...',
        elapsedMs: Date.now() - startTime,
      });

      // If we get IN_QUEUE/IN_PROGRESS on runsync, poll for completion
      return this.pollForCompletion(result.id, onProgress, startTime);
    }

    // Extract response content - handle multiple response formats
    const output = result.output;
    if (!output) {
      throw new RunPodError('No output in response', 'MODEL_ERROR');
    }

    // Support multiple output formats:
    // 1. vLLM worker format: output = [{ choices: [{ tokens: ["text"] }], usage: {...} }]
    // 2. Standard format: output = { response: "text" } or { content: "text" }
    // 3. OpenAI-like format: output = { message: { content: "text" } }
    let content: string | undefined;
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    if (Array.isArray(output)) {
      // vLLM worker format: output is an array
      const firstOutput = output[0];
      if (firstOutput?.choices?.[0]?.tokens) {
        // Tokens can be an array of strings or a single string
        const tokens = firstOutput.choices[0].tokens;
        content = Array.isArray(tokens) ? tokens.join('') : tokens;
      } else if (firstOutput?.choices?.[0]?.text) {
        // Alternative vLLM format with text field
        content = firstOutput.choices[0].text;
      } else if (firstOutput?.choices?.[0]?.message?.content) {
        // OpenAI chat completion format
        content = firstOutput.choices[0].message.content;
      }
      // Extract usage from vLLM format
      if (firstOutput?.usage) {
        usage = {
          promptTokens: firstOutput.usage.input || firstOutput.usage.prompt_tokens || 0,
          completionTokens: firstOutput.usage.output || firstOutput.usage.completion_tokens || 0,
          totalTokens: (firstOutput.usage.input || firstOutput.usage.prompt_tokens || 0) +
                       (firstOutput.usage.output || firstOutput.usage.completion_tokens || 0),
        };
      }
    } else {
      // Standard object format
      content = output.response || output.content || output.message?.content;
      if (output.usage) {
        usage = {
          promptTokens: output.usage.prompt_tokens || 0,
          completionTokens: output.usage.completion_tokens || 0,
          totalTokens: output.usage.total_tokens || 0,
        };
      }
    }

    if (!content) {
      console.error('[runpod] Unexpected output format:', JSON.stringify(output).slice(0, 500));
      throw new RunPodError('No content in response output', 'MODEL_ERROR');
    }

    // Report completion
    onProgress?.({
      phase: 'completed',
      message: 'Response received',
      elapsedMs: Date.now() - startTime,
    });

    return {
      content,
      model: options.model || 'runpod-serverless',
      usage,
    };
  }

  /**
   * Poll for job completion (used when runsync returns IN_QUEUE)
   */
  private async pollForCompletion(
    jobId: string,
    onProgress?: RunPodProgressCallback,
    startTime: number = Date.now()
  ): Promise<LLMResponse> {
    const statusUrl = `${this.baseUrl}/${this.endpointId}/status/${jobId}`;
    const pollInterval = 1000;
    const maxPollTime = this.timeout;

    while (Date.now() - startTime < maxPollTime) {
      await this.sleep(pollInterval);

      const response = await this.fetchWithTimeout(statusUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        continue; // Retry on HTTP errors during polling
      }

      const result = await response.json() as RunPodJobStatus;

      onProgress?.({
        phase: result.status === 'IN_QUEUE' ? 'queued' : 'running',
        message: result.status === 'IN_QUEUE'
          ? 'Waiting in queue...'
          : 'Processing on GPU...',
        elapsedMs: Date.now() - startTime,
      });

      if (result.status === 'COMPLETED') {
        const output = result.output;
        if (!output) {
          throw new RunPodError('No output in completed job', 'MODEL_ERROR');
        }

        // Handle multiple output formats (same as executeRequest)
        let content: string | undefined;
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

        if (Array.isArray(output)) {
          const firstOutput = output[0];
          if (firstOutput?.choices?.[0]?.tokens) {
            const tokens = firstOutput.choices[0].tokens;
            content = Array.isArray(tokens) ? tokens.join('') : tokens;
          } else if (firstOutput?.choices?.[0]?.text) {
            content = firstOutput.choices[0].text;
          } else if (firstOutput?.choices?.[0]?.message?.content) {
            content = firstOutput.choices[0].message.content;
          }
          if (firstOutput?.usage) {
            usage = {
              promptTokens: firstOutput.usage.input || firstOutput.usage.prompt_tokens || 0,
              completionTokens: firstOutput.usage.output || firstOutput.usage.completion_tokens || 0,
              totalTokens: (firstOutput.usage.input || 0) + (firstOutput.usage.output || 0),
            };
          }
        } else {
          content = output.response || output.content || output.message?.content;
          if (output.usage) {
            usage = {
              promptTokens: output.usage.prompt_tokens || 0,
              completionTokens: output.usage.completion_tokens || 0,
              totalTokens: output.usage.total_tokens || 0,
            };
          }
        }

        if (!content) {
          console.error('[runpod] Unexpected output format in poll:', JSON.stringify(output).slice(0, 500));
          throw new RunPodError('No content in completed job output', 'MODEL_ERROR');
        }

        onProgress?.({
          phase: 'completed',
          message: 'Response received',
          elapsedMs: Date.now() - startTime,
        });

        return {
          content,
          model: 'runpod-serverless',
          usage,
        };
      }

      if (result.status === 'FAILED' || result.status === 'CANCELLED') {
        throw new RunPodError(
          result.error || 'Job failed',
          'MODEL_ERROR'
        );
      }

      if (result.status === 'TIMED_OUT') {
        throw new RunPodError(
          'GPU request timed out',
          'TIMEOUT',
          undefined,
          true
        );
      }
    }

    throw new RunPodError(
      `Polling timeout after ${maxPollTime}ms`,
      'TIMEOUT',
      undefined,
      true
    );
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new RunPodError(
          `Request timeout after ${this.timeout}ms`,
          'TIMEOUT',
          undefined,
          true
        );
      }
      throw new RunPodError(
        `Network error: ${(error as Error).message}`,
        'NETWORK_ERROR',
        undefined,
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Categorize HTTP errors into appropriate RunPodError types
   */
  private categorizeHttpError(status: number, errorText: string): RunPodError {
    if (status === 401 || status === 403) {
      return new RunPodError(
        `Authentication failed: ${errorText}`,
        'AUTH_ERROR',
        status
      );
    }

    if (status === 429) {
      return new RunPodError(
        'Rate limited - too many requests',
        'RATE_LIMIT',
        status,
        true
      );
    }

    if (status === 408 || status === 504) {
      return new RunPodError(
        `Request timeout: ${errorText}`,
        'TIMEOUT',
        status,
        true
      );
    }

    if (status >= 500) {
      return new RunPodError(
        `Server error (${status}): ${errorText}`,
        'UNKNOWN',
        status,
        true
      );
    }

    return new RunPodError(
      `HTTP error (${status}): ${errorText}`,
      'UNKNOWN',
      status
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a RunPod provider from configuration
 */
export function createRunPodProvider(config: RunPodConfig): RunPodServerlessProvider {
  return new RunPodServerlessProvider(config);
}
