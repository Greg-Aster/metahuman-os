/**
 * API Configuration for Mobile/Web
 *
 * Provides centralized API URL configuration that:
 * - Returns remote server URL when running in Capacitor native app
 * - Returns relative paths when running in web browser
 *
 * This enables the mobile app to bundle the UI locally while making
 * API calls to the remote server.
 */

/**
 * Check if running in Capacitor native app
 */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Get the base URL for API calls
 * - Mobile (Capacitor): Returns full remote server URL
 * - Web: Returns empty string (relative paths)
 */
export function getApiBaseUrl(): string {
  if (isCapacitorNative()) {
    // Mobile app - API calls go to remote server
    return 'https://mh.dndiy.org';
  }
  // Web - use relative paths (same origin)
  return '';
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
