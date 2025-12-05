/**
 * API Configuration for Mobile/Web
 *
 * Provides centralized API URL configuration that:
 * - Returns remote server URL when running in Capacitor native app
 * - Returns relative paths when running in web browser
 * - Supports user-configurable server URLs for mobile
 *
 * This enables the mobile app to bundle the UI locally while making
 * API calls to the remote server, with the ability to switch servers.
 */

// Default servers
const DEFAULT_SERVERS = {
  local: 'https://mh.dndiy.org',
  cloud: 'https://api.metahuman.cloud'  // Future cloud deployment
};

// Cache for server URL (avoid async calls on every request)
let cachedServerUrl: string | null = null;
let cacheInitialized = false;

/**
 * Check if running in Capacitor native app
 */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Check if running in web browser (not native)
 */
export function isWeb(): boolean {
  return !isCapacitorNative();
}

/**
 * Initialize the server URL cache from Capacitor Preferences
 * Called once at app startup
 */
export async function initServerUrl(): Promise<void> {
  if (!isCapacitorNative() || cacheInitialized) {
    cacheInitialized = true;
    return;
  }

  try {
    // Dynamic import to avoid issues in web/SSR context
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: 'server_url' });
    cachedServerUrl = value || DEFAULT_SERVERS.local;
    cacheInitialized = true;
    console.log('[api-config] Initialized server URL:', cachedServerUrl);
  } catch (e) {
    console.warn('[api-config] Failed to load server URL from preferences:', e);
    cachedServerUrl = DEFAULT_SERVERS.local;
    cacheInitialized = true;
  }
}

/**
 * Get the base URL for API calls (sync version using cache)
 * - Mobile (Capacitor): Returns configured or default server URL
 * - Web: Returns empty string (relative paths)
 */
export function getApiBaseUrl(): string {
  if (isCapacitorNative()) {
    // Use cached value, fall back to default if not initialized
    return cachedServerUrl || DEFAULT_SERVERS.local;
  }
  // Web - use relative paths (same origin)
  return '';
}

/**
 * Get the base URL for API calls (async version, reads from storage)
 * Use this when you need the guaranteed current value
 */
export async function getApiBaseUrlAsync(): Promise<string> {
  if (!isCapacitorNative()) {
    return '';  // Web uses relative URLs
  }

  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: 'server_url' });
    const url = value || DEFAULT_SERVERS.local;
    // Update cache
    cachedServerUrl = url;
    return url;
  } catch (e) {
    return cachedServerUrl || DEFAULT_SERVERS.local;
  }
}

/**
 * Set the server URL (mobile only)
 * @param url - The server URL to use
 */
export async function setServerUrl(url: string): Promise<void> {
  if (!isCapacitorNative()) {
    console.warn('[api-config] setServerUrl only works in mobile app');
    return;
  }

  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: 'server_url', value: url });
    cachedServerUrl = url;
    console.log('[api-config] Server URL updated:', url);
  } catch (e) {
    console.error('[api-config] Failed to save server URL:', e);
    throw e;
  }
}

/**
 * Test connection to a server
 * @param url - Server URL to test
 * @returns Object with success status and latency
 */
export async function testServerConnection(url: string): Promise<{
  success: boolean;
  latencyMs: number;
  error?: string;
  version?: string;
}> {
  const start = Date.now();

  try {
    const response = await fetch(`${url}/api/boot`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000)  // 5 second timeout
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        success: false,
        latencyMs,
        error: `Server returned ${response.status}`
      };
    }

    const data = await response.json();
    return {
      success: true,
      latencyMs,
      version: data.version
    };
  } catch (e) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: e instanceof Error ? e.message : 'Connection failed'
    };
  }
}

/**
 * Get list of default servers
 */
export function getDefaultServers(): typeof DEFAULT_SERVERS {
  return { ...DEFAULT_SERVERS };
}

/**
 * Build a full API URL from a path
 * @param path - API path starting with /api/ (e.g., '/api/status')
 * @returns Full URL for mobile, relative path for web
 *
 * @example
 * // In mobile app:
 * apiUrl('/api/status') // => 'https://mh.dndiy.org/api/status'
 *
 * // In web browser:
 * apiUrl('/api/status') // => '/api/status'
 */
export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Fetch wrapper that automatically uses the correct API base URL
 * Preserves all fetch options and adds credentials for cross-origin requests
 *
 * @param path - API path starting with /api/
 * @param init - Fetch options
 * @returns Fetch response
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);

  // For cross-origin requests (mobile), include credentials
  const options: RequestInit = {
    ...init,
    credentials: isCapacitorNative() ? 'include' : (init?.credentials ?? 'same-origin'),
  };

  return fetch(url, options);
}

/**
 * Create an EventSource with the correct API base URL
 * Used for streaming responses (chat, buffer updates, etc.)
 *
 * @param path - API path with query string
 * @returns EventSource instance
 */
export function apiEventSource(path: string): EventSource {
  const url = apiUrl(path);
  return new EventSource(url, { withCredentials: isCapacitorNative() });
}
