/**
 * Fetch with timeout and retry logic
 *
 * Prevents hanging requests and provides graceful error handling
 */

export interface FetchTimeoutOptions extends RequestInit {
  timeout?: number; // milliseconds, default 10000 (10s)
  retries?: number; // number of retries, default 0
  retryDelay?: number; // delay between retries in ms, default 1000
}

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Fetch with automatic timeout and optional retries
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchTimeoutOptions = {}
): Promise<Response> {
  const {
    timeout = 10000,
    retries = 0,
    retryDelay = 1000,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      lastError = error as Error;

      // If it's an abort error, convert to timeout error
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new FetchTimeoutError(
          `Request to ${url} timed out after ${timeout}ms`
        );
      }

      // If this isn't the last attempt, wait before retrying
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('Unknown fetch error');
}

/**
 * Fetch JSON with timeout, returns null on error instead of throwing
 */
export async function fetchJSONSafe<T = any>(
  url: string,
  options: FetchTimeoutOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetchWithTimeout(url, options);

    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
