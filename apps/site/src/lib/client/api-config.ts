/**
 * Browser transport owner. Local web and mobile use their same-origin API;
 * the hosted static UI uses the backend selected in this browser.
 * Profile sync has its own server selection, independent of UI transport.
 */

// Default servers for explicit profile sync.
// Local web/API calls remain same-origin; remote sync requires user input.
const DEFAULT_SERVERS = {
  local: '',
  cloud: ''
};

// Cache for server URL (avoid async calls on every request)
let cachedServerUrl: string | null = null;
let cacheInitialized = false;

declare const __METAHUMAN_STATIC_UI__: boolean | undefined;
const BACKEND_STORAGE_KEY = 'mh_backend_url';

export function isHostedUi(): boolean {
  return typeof __METAHUMAN_STATIC_UI__ !== 'undefined' && __METAHUMAN_STATIC_UI__;
}

/** Save only the chosen address. Authentication remains on that backend. */
export function setBackendUrl(url: string): void {
  const normalized = normalizeUrl(url);
  if (normalized) localStorage.setItem(BACKEND_STORAGE_KEY, normalized);
  else localStorage.removeItem(BACKEND_STORAGE_KEY);
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
  console.log('[api-config] Initialized sync server URL:', cachedServerUrl || '(not configured)');
}

/**
 * Get the selected API destination synchronously.
 *
 * The hosted UI stores its backend address in the browser. This never changes
 * the local web/mobile execution contract or the profile sync destination.
 */
export function getApiBaseUrl(): string {
  if (isHostedUi() && typeof window !== 'undefined') {
    return localStorage.getItem(BACKEND_STORAGE_KEY) || '';
  }
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
 * Uses the same transport destination as the synchronous owner.
 */
export async function getApiBaseUrlAsync(): Promise<string> {
  return getApiBaseUrl();
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
    const response = await fetch(`${url}/api/app-info`, {
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
 * @returns A backend URL for hosted UI API paths; otherwise the original path.
 *
 * @example
 * // In mobile app:
 * apiUrl('/api/status') // => '/api/status'
 *
 * // Hosted UI with desktop.ainek.io selected:
 * apiUrl('/api/status') // => 'https://desktop.ainek.io/api/status'
 *
 * // In web browser:
 * apiUrl('/api/status') // => '/api/status'
 */
export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) return path;
  return `${getApiBaseUrl()}${path}`;
}

function shouldReportAuthFailure(path: string): boolean {
  return ![
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/guest',
    '/api/auth/sync-user',
    '/api/auth/users',
    '/api/auth/reset-password',
    '/api/auth/logout',
  ].some(authPath => path.startsWith(authPath));
}

/**
 * Only an unauthenticated response invalidates the current login.
 *
 * A 403 means the session is valid but the current role cannot perform the
 * requested action. Reporting it as an auth failure would make AuthGate call
 * logout and destroy an otherwise healthy standard-user session.
 */
export function isSessionAuthenticationFailure(status: number): boolean {
  return status === 401;
}

function isMutatingMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function shouldReportAction(path: string, method: string): boolean {
  if (!isMutatingMethod(method)) return false;
  return ![
    '/api/auth/',
    '/api/persona_chat',
    '/api/semantic-turn',
    '/api/llm-proxy',
    '/api/profile-sync/import',
  ].some(prefix => path.startsWith(prefix));
}

function actionLabel(path: string, method: string): string {
  const normalized = path
    .replace(/^\/api\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/[-_/]+/g, ' ')
    .trim();
  return `${method.toUpperCase()} ${normalized || 'API action'}`;
}

async function reportAuthFailure(path: string, response: Response): Promise<void> {
  if (typeof window === 'undefined' || !shouldReportAuthFailure(path)) return;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    payload = undefined;
  }

  window.dispatchEvent(new CustomEvent('mh:api-auth-failure', {
    detail: {
      path,
      status: response.status,
      payload,
    },
  }));
}

function reportAction(detail: {
  id: string;
  path: string;
  method: string;
  state: 'pending' | 'success' | 'error';
  status?: number;
  message?: string;
}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mh:api-action', { detail }));
}

/**
 * Fetch wrapper that automatically uses the correct API base URL
 *
 * Cookies belong to the selected backend. Cross-origin hosted requests include
 * them; local web and mobile retain their existing same-origin behavior.
 *
 * @param path - API path starting with /api/
 * @param init - Fetch options
 * @returns Fetch response
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  const options: RequestInit = {
    ...init,
    credentials: init?.credentials ?? (getApiBaseUrl() ? 'include' : 'same-origin'),
  };
  const method = options.method || 'GET';
  const shouldReport = shouldReportAction(path, method);
  const actionId = shouldReport
    ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    : '';

  if (shouldReport) {
    reportAction({
      id: actionId,
      path,
      method,
      state: 'pending',
      message: `${actionLabel(path, method)} started`,
    });
  }

  try {
    const response = await fetch(url, options);
    if (isSessionAuthenticationFailure(response.status)) {
      void reportAuthFailure(path, response);
    }
    if (shouldReport) {
      reportAction({
        id: actionId,
        path,
        method,
        state: response.ok ? 'success' : 'error',
        status: response.status,
        message: response.ok
          ? `${actionLabel(path, method)} completed`
          : `${actionLabel(path, method)} failed (${response.status})`,
      });
    }
    return response;
  } catch (error) {
    if (shouldReport) {
      reportAction({
        id: actionId,
        path,
        method,
        state: 'error',
        message: `${actionLabel(path, method)} failed: ${error instanceof Error ? error.message : 'Network error'}`,
      });
    }
    throw error;
  }
}

/**
 * Create an EventSource for SSE streaming
 *
 * Uses the same destination and credentials as ordinary API requests.
 * Mounted views retain ownership of stream lifetime and browser reconnection.
 *
 * @param path - API path with query string
 * @returns EventSource instance
 */
export function apiEventSource(path: string): EventSource {
  return new EventSource(apiUrl(path), { withCredentials: Boolean(getApiBaseUrl()) });
}

/** Normalize a server URL, preserving explicit HTTP for local servers. */
export function normalizeUrl(url: string): string {
  if (!url.trim()) return '';
  const input = url.trim();
  const normalized = new URL(/^https?:/i.test(input) ? input : `https://${input}`);
  if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') {
    throw new Error('Server URL must use http or https');
  }
  return normalized.toString().replace(/\/+$/, '');
}
