/**
 * API Configuration for Mobile/Web
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile app is a STANDALONE program, NOT a thin client
 * - API calls on mobile go to local handlers (empty base URL)
 * - Server URL is ONLY used for explicit sync operations
 * - Web app uses relative paths (same origin = same machine)
 *
 * The mobile app bundles the UI and handles operations locally.
 * Server connection is OPTIONAL and only for syncing profiles.
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
 * Check if running in Capacitor native app (LEGACY - kept for compatibility)
 */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Check if running in React Native WebView
 * React Native WebView injects window.ReactNativeWebView
 * Also detect by checking if we're loading from localhost:4322 (mobile server)
 */
export function isReactNativeWebView(): boolean {
  if (typeof window === 'undefined') return false;
  // React Native WebView injects this global
  if ((window as any).ReactNativeWebView) return true;
  // Also check URL - React Native loads from http://127.0.0.1:4322
  if (window.location?.origin?.includes('127.0.0.1:4322')) return true;
  return false;
}

/**
 * Check if running in ANY mobile app (Capacitor OR React Native)
 * Use this for mobile-specific features like app updates
 */
export function isMobileApp(): boolean {
  return isCapacitorNative() || isReactNativeWebView();
}

/**
 * Check if running in web browser (not native)
 */
export function isWeb(): boolean {
  return !isMobileApp();
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
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile: Returns empty string (local nodejs-mobile handles requests)
 * - Web: Returns empty string (same-origin server)
 *
 * Remote server URL is ONLY used for explicit sync operations via getSyncServerUrl()
 */
export function getApiBaseUrl(): string {
  // Both mobile and web use empty string (local/same-origin)
  // Mobile handles requests via nodejs-mobile (through nodeBridge)
  // Web handles requests via same-origin server
  return '';
}

/**
 * Get the sync server URL for explicit sync operations ONLY
 * This is the ONLY place remote server should be used
 */
export function getSyncServerUrl(): string {
  return cachedServerUrl || DEFAULT_SERVERS.local;
}

/**
 * Get the base URL for API calls (async version)
 *
 * LOCAL-FIRST: Always returns empty string (local/same-origin)
 * Use getSyncServerUrlAsync() for explicit sync operations
 */
export async function getApiBaseUrlAsync(): Promise<string> {
  return '';  // Local-first: all API calls go to local/same-origin
}

/**
 * Get the sync server URL (async version, reads from storage)
 * Use this for EXPLICIT sync operations ONLY
 */
export async function getSyncServerUrlAsync(): Promise<string> {
  if (!isCapacitorNative()) {
    return DEFAULT_SERVERS.local;  // Web can still sync to server
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

    // 401/403 means server IS reachable, just needs auth - treat as connected
    if (response.status === 401 || response.status === 403) {
      return {
        success: true,
        latencyMs,
        version: undefined  // Can't get version without auth
      };
    }

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
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile: Routes through nodeBridge for local nodejs-mobile handling
 * - Web: Standard fetch to same-origin server
 *
 * This is THE universal API function - same code for both platforms.
 * Mobile handles everything locally, web uses the same-origin server.
 *
 * @param path - API path starting with /api/
 * @param init - Fetch options
 * @returns Fetch response
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // Mobile: route through nodeBridge for LOCAL handling (nodejs-mobile)
  // This makes mobile a standalone program, not dependent on remote server
  if (isCapacitorNative()) {
    const { nodeBridge } = await import('./node-bridge');
    return nodeBridge(path, init);
  }

  // Web: standard fetch with relative paths (same-origin server)
  const url = apiUrl(path);
  const options: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
  };

  return fetch(url, options);
}

/**
 * Create an EventSource for SSE streaming (WEB ONLY)
 *
 * UNIFIED APPROACH:
 * - Web: Uses native EventSource (same-origin, cookies work automatically)
 * - Mobile: Should NOT use this function - use apiFetch with stream=false instead
 *
 * Mobile chat uses apiFetch with stream=false because:
 * 1. CapacitorHttp (used by nodeBridge) doesn't support streaming
 * 2. Native EventSource can't send cookies cross-origin to nodejs-mobile server
 * 3. apiFetch routes through nodeBridge which properly handles cookies
 *
 * @param path - API path with query string
 * @returns EventSource instance
 */
export function apiEventSource(path: string): EventSource {
  // Web only - mobile should use apiFetch with stream=false
  if (isCapacitorNative()) {
    console.warn('[apiEventSource] Mobile should use apiFetch with stream=false, not EventSource');
  }

  return new EventSource(path);
}

/**
 * Normalize a URL to ensure it has a protocol (https://)
 *
 * Handles common user input mistakes:
 * - "mh.dndiy.org" -> "https://mh.dndiy.org"
 * - "http://..." -> "https://..." (upgrade to https)
 * - "https://..." -> unchanged
 * - Removes trailing slashes
 *
 * @param url - URL string that may or may not have protocol
 * @returns Normalized URL with https:// protocol
 */
export function normalizeUrl(url: string): string {
  if (!url) return url;

  let normalized = url.trim();

  // Add https:// if no protocol
  if (!normalized.match(/^https?:\/\//i)) {
    normalized = `https://${normalized}`;
  }

  // Upgrade http to https
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }

  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}

/**
 * Fetch wrapper for REMOTE servers (external URLs)
 *
 * IMPORTANT: This is different from apiFetch() which is for LOCAL API calls.
 * Use this for sync operations to external servers like mh.dndiy.org.
 *
 * On mobile, uses Capacitor's native HTTP to bypass WebView CORS restrictions.
 * On web, uses standard fetch.
 *
 * @param url - Full URL to fetch (will be normalized)
 * @param init - Fetch options
 * @returns Response object
 */
export async function remoteFetch(url: string, init?: RequestInit): Promise<Response> {
  // Normalize URL to ensure proper protocol
  const normalizedUrl = normalizeUrl(url);

  // Mobile: use CapacitorHttp to bypass CORS
  if (isCapacitorNative()) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const method = (init?.method || 'GET').toUpperCase();

      // Parse body if present
      let data: any = undefined;
      if (init?.body) {
        try {
          data = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        } catch {
          data = { _raw: String(init.body) };
        }
      }

      console.log('[remoteFetch] URL:', normalizedUrl);
      console.log('[remoteFetch] Method:', method);

      const response = await CapacitorHttp.request({
        url: normalizedUrl,
        method,
        data,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers as Record<string, string> || {}),
        },
      });

      console.log('[remoteFetch] Response status:', response.status);

      // Convert to standard Response
      const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      return new Response(body, {
        status: response.status,
        headers: new Headers(response.headers),
      });
    } catch (err) {
      console.error('[remoteFetch] CapacitorHttp error:', err);
      throw err;
    }
  }

  // Web: standard fetch
  return fetch(normalizedUrl, {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
