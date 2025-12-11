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
 * Check if running in mobile app (React Native WebView)
 * Use this for mobile-specific features like app updates
 */
export function isMobileApp(): boolean {
  return isReactNativeWebView();
}

/**
 * Check if running in web browser (not native)
 */
export function isWeb(): boolean {
  return !isMobileApp();
}

/**
 * Initialize the server URL cache
 * Called once at app startup
 */
export async function initServerUrl(): Promise<void> {
  if (cacheInitialized) {
    return;
  }

  cachedServerUrl = DEFAULT_SERVERS.local;
  cacheInitialized = true;
  console.log('[api-config] Initialized server URL:', cachedServerUrl);
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
 * Get the sync server URL (async version)
 * Use this for EXPLICIT sync operations ONLY
 */
export async function getSyncServerUrlAsync(): Promise<string> {
  return cachedServerUrl || DEFAULT_SERVERS.local;
}

/**
 * Set the server URL
 * @param url - The server URL to use
 */
export async function setServerUrl(url: string): Promise<void> {
  cachedServerUrl = url;
  console.log('[api-config] Server URL updated:', url);
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
 * UNIFIED ARCHITECTURE:
 * - React Native: Standard fetch to local Node.js server (http://127.0.0.1:4322)
 * - Web: Standard fetch to same-origin server
 *
 * Both platforms use the same fetch API - no special handling needed!
 *
 * @param path - API path starting with /api/
 * @param init - Fetch options
 * @returns Fetch response
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // Both React Native and Web use standard fetch
  // React Native WebView automatically routes to local Node.js server
  // Web uses relative paths to same-origin server
  const url = apiUrl(path);
  const options: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
  };

  return fetch(url, options);
}

/**
 * Create an EventSource for SSE streaming
 *
 * UNIFIED APPROACH:
 * - Web: Uses native EventSource (same-origin, cookies work automatically)
 * - React Native: EventSource works with local Node.js server on 127.0.0.1:4322
 *
 * Both platforms can use EventSource because:
 * - React Native WebView loads from same origin as Node.js server
 * - Cookies and auth work identically on both platforms
 *
 * @param path - API path with query string
 * @returns EventSource instance
 */
export function apiEventSource(path: string): EventSource {
  // Both platforms use standard EventSource
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
 * Uses standard fetch on both platforms.
 *
 * @param url - Full URL to fetch (will be normalized)
 * @param init - Fetch options
 * @returns Response object
 */
export async function remoteFetch(url: string, init?: RequestInit): Promise<Response> {
  // Normalize URL to ensure proper protocol
  const normalizedUrl = normalizeUrl(url);

  // Standard fetch for both web and React Native
  return fetch(normalizedUrl, {
    ...init,
    credentials: init?.credentials ?? 'include',
  });
}
