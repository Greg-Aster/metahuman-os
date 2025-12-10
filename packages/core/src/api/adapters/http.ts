/**
 * Unified HTTP Adapter
 *
 * ONE adapter used by BOTH web (Astro) and mobile (nodejs-mobile).
 * Converts HTTP requests to UnifiedRequest, calls the router,
 * converts UnifiedResponse back to HTTP response.
 *
 * SAME CODE FOR WEB AND MOBILE - no duplication.
 */

import { routeRequest } from '../router.js';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../types.js';
import { validateSession } from '../../sessions.js';
import { getUser } from '../../users.js';

/**
 * Parse cookies from Cookie header string
 */
export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name && rest.length > 0) {
        cookies[name] = decodeURIComponent(rest.join('='));
      }
    });
  }
  return cookies;
}

/**
 * Resolve user from session cookie - SAME LOGIC FOR WEB AND MOBILE
 */
export function resolveUserFromCookie(sessionToken: string | undefined): UnifiedUser {
  if (!sessionToken) {
    return { userId: 'anonymous', username: 'anonymous', role: 'anonymous', isAuthenticated: false };
  }

  try {
    const session = validateSession(sessionToken);
    if (!session || session.role === 'anonymous') {
      return { userId: 'anonymous', username: 'anonymous', role: 'anonymous', isAuthenticated: false };
    }

    const user = getUser(session.userId);
    if (!user) {
      return { userId: 'anonymous', username: 'anonymous', role: 'anonymous', isAuthenticated: false };
    }

    return {
      userId: user.id,
      username: user.username,
      role: user.role as 'owner' | 'guest' | 'anonymous',
      isAuthenticated: true,
    };
  } catch {
    return { userId: 'anonymous', username: 'anonymous', role: 'anonymous', isAuthenticated: false };
  }
}

/**
 * Build UnifiedRequest from HTTP request components
 * Used by both Astro and mobile HTTP server
 */
export function buildUnifiedRequest(params: {
  path: string;
  method: string;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  cookieHeader?: string | null;
}): UnifiedRequest {
  const cookies = parseCookies(params.cookieHeader);
  const sessionToken = cookies['mh_session'];
  const user = resolveUserFromCookie(sessionToken);

  return {
    path: params.path.split('?')[0], // Remove query string from path
    method: params.method as UnifiedRequest['method'],
    body: params.body,
    query: params.query || {},
    headers: params.headers || {},
    user,
    params: {},
    // Include session token in metadata for handlers that need it (e.g., logout)
    metadata: sessionToken ? { sessionToken } : undefined,
  };
}

/**
 * Format cookie for Set-Cookie header
 */
export function formatSetCookie(cookie: {
  action: 'set' | 'delete';
  name: string;
  value?: string;
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'strict' | 'lax' | 'none';
    path?: string;
    maxAge?: number;
  };
}): string {
  if (cookie.action === 'delete') {
    return `${cookie.name}=; Max-Age=0; Path=/`;
  }

  let cookieStr = `${cookie.name}=${encodeURIComponent(cookie.value || '')}`;
  if (cookie.options) {
    if (cookie.options.httpOnly) cookieStr += '; HttpOnly';
    if (cookie.options.path) cookieStr += `; Path=${cookie.options.path}`;
    if (cookie.options.maxAge) cookieStr += `; Max-Age=${cookie.options.maxAge}`;
    if (cookie.options.sameSite) cookieStr += `; SameSite=${cookie.options.sameSite}`;
    if (cookie.options.secure) cookieStr += '; Secure';
  }
  return cookieStr;
}

/**
 * HTTP Response type - supports JSON, binary, and streaming
 */
export interface HttpResponse {
  status: number;
  body: string | Buffer;
  headers: Record<string, string>;
  cookies: string[];
  isBinary?: boolean;
  isStreaming?: boolean;
  stream?: AsyncIterable<string>;
}

/**
 * Handle HTTP request using unified router
 * Returns response data and cookies to set
 *
 * SAME FUNCTION FOR WEB AND MOBILE
 */
export async function handleHttpRequest(params: {
  path: string;
  method: string;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  cookieHeader?: string | null;
}): Promise<HttpResponse> {
  // Build unified request
  const request = buildUnifiedRequest(params);

  // Route to handler
  let response: UnifiedResponse;
  try {
    response = await routeRequest(request);
  } catch (error) {
    console.error('[http-adapter] Handler error:', error);
    response = {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }

  // Build response cookies
  const cookies: string[] = [];
  if (response.cookies && Array.isArray(response.cookies)) {
    for (const cookie of response.cookies) {
      cookies.push(formatSetCookie(cookie));
    }
  }

  // Handle streaming responses (SSE)
  if (response.stream) {
    return {
      status: response.status,
      body: '', // Body is streamed, not buffered
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...response.headers,
      },
      cookies,
      isStreaming: true,
      stream: response.stream,
    };
  }

  // Handle binary responses (e.g., images)
  if (response.binary) {
    return {
      status: response.status,
      body: response.binary,
      headers: {
        'Content-Type': response.contentType || 'application/octet-stream',
        ...response.headers,
      },
      cookies,
      isBinary: true,
    };
  }

  // Build JSON response body
  const body = JSON.stringify(response.data || { error: response.error });

  return {
    status: response.status,
    body,
    headers: {
      'Content-Type': 'application/json',
      ...response.headers,
    },
    cookies,
  };
}
