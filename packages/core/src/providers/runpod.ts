/**
 * RunPod Serverless Provider
 *
 * Implements the canonical Core provider contract for RunPod serverless GPU endpoints.
 * Supports both synchronous (runsync) and asynchronous (run) modes.
 *
 * Key features:
 * - Cold start detection and progress reporting
 * - Automatic retry with exponential backoff
 * - Token usage tracking
 * - Error categorization (rate limit, timeout, model error, etc.)
 */

import type {
  ProviderMessage,
  ProviderOptions,
  ProviderProgressCallback,
  ProviderResponse,
} from './types.js';
import { extractRunPodOutput, parseRunPodJobStatus } from './runpod-output.js';

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

interface RunPodJobInput {
  messages: ProviderMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  repeat_penalty?: number;
  format?: 'text' | 'json';
}

export type RunPodProgressCallback = ProviderProgressCallback;

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

export class RunPodServerlessProvider {
  readonly name = 'runpod_serverless';

  private apiKey: string;
  private endpointId: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(config: RunPodConfig) {
    if (!config.apiKey?.trim()) throw new TypeError('RunPod API key is required');
    if (!config.endpointId?.trim()) throw new TypeError('RunPod endpoint ID is required');
    if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
      throw new TypeError('RunPod timeout must be a positive number');
    }
    if (config.maxRetries !== undefined && (!Number.isInteger(config.maxRetries) || config.maxRetries < 0)) {
      throw new TypeError('RunPod maxRetries must be a non-negative integer');
    }

    this.apiKey = config.apiKey.trim();
    this.endpointId = config.endpointId.trim();
    this.baseUrl = (config.baseUrl ?? 'https://api.runpod.ai/v2').replace(/\/+$/, '');
    this.timeout = config.timeout ?? 120000;
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * Generate a response using RunPod serverless endpoint (synchronous mode)
   */
  async generate(
    messages: ProviderMessage[],
    options: ProviderOptions = {},
    onProgress?: RunPodProgressCallback
  ): Promise<ProviderResponse> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeRequest(messages, options, onProgress, startTime);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (lastError instanceof RunPodError && lastError.retryable && attempt < this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[runpod] Retry ${attempt + 1}/${this.maxRetries} after ${backoffMs}ms`);
          await this.sleep(backoffMs);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('RunPod request failed after retries');
  }

  /**
   * Generate a JSON response
   */
  async generateJSON<T = unknown>(messages: ProviderMessage[], options: ProviderOptions = {}): Promise<T> {
    const response = await this.generate(messages, { ...options, format: 'json' });

    try {
      return JSON.parse(response.content) as T;
    } catch (error) {
      throw new RunPodError(
        `Failed to parse JSON response: ${error instanceof Error ? error.message : String(error)}`,
        'MODEL_ERROR'
      );
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeRequest(
    messages: ProviderMessage[],
    options: ProviderOptions,
    onProgress?: RunPodProgressCallback,
    startTime: number = Date.now()
  ): Promise<ProviderResponse> {
    // Build request input
    const input: RunPodJobInput = {
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 512,
      top_p: options.topP,
      repeat_penalty: options.repeatPenalty,
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

    const result = parseRunPodJobStatus(await response.json());

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
      return this.pollForCompletion(result.id, options.model, onProgress, startTime);
    }

    if (!result.output) {
      throw new RunPodError('No output in response', 'MODEL_ERROR');
    }
    const { content, usage } = extractRunPodOutput(result.output);

    if (!content) {
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
      provider: this.name,
      usage,
    };
  }

  /**
   * Poll for job completion (used when runsync returns IN_QUEUE)
   */
  private async pollForCompletion(
    jobId: string,
    model: string | undefined,
    onProgress?: RunPodProgressCallback,
    startTime: number = Date.now()
  ): Promise<ProviderResponse> {
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

      const result = parseRunPodJobStatus(await response.json());

      onProgress?.({
        phase: result.status === 'IN_QUEUE' ? 'queued' : 'running',
        message: result.status === 'IN_QUEUE'
          ? 'Waiting in queue...'
          : 'Processing on GPU...',
        elapsedMs: Date.now() - startTime,
      });

      if (result.status === 'COMPLETED') {
        if (!result.output) {
          throw new RunPodError('No output in completed job', 'MODEL_ERROR');
        }
        const { content, usage } = extractRunPodOutput(result.output);

        if (!content) {
          throw new RunPodError('No content in completed job output', 'MODEL_ERROR');
        }

        onProgress?.({
          phase: 'completed',
          message: 'Response received',
          elapsedMs: Date.now() - startTime,
        });

        return {
          content,
          model: model || 'runpod-serverless',
          provider: this.name,
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
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RunPodError(
          `Request timeout after ${this.timeout}ms`,
          'TIMEOUT',
          undefined,
          true
        );
      }
      throw new RunPodError(
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
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
