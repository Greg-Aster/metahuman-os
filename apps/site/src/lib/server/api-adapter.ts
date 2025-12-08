/**
 * Astro Adapter for Unified API
 *
 * Converts Astro APIContext to UnifiedRequest and UnifiedResponse back to Astro Response.
 * This allows Astro routes to use the unified API layer shared with mobile.
 */

import type { APIRoute, APIContext, AstroCookies } from 'astro';
import { routeRequest } from '@metahuman/core/api';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser, CookieOperation } from '@metahuman/core/api';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

/**
 * Resolve user from Astro cookies
 */
function resolveUser(cookies: AstroCookies, requiresAuth: boolean): UnifiedUser {
  if (requiresAuth) {
    try {
      const user = getAuthenticatedUser(cookies);
      return {
        userId: user.id,
        username: user.username,
        role: user.role as 'owner' | 'guest' | 'anonymous',
        isAuthenticated: true,
      };
    } catch {
      // Auth required but failed - return anonymous (handler will reject)
      return {
        userId: 'anonymous',
        username: 'anonymous',
        role: 'anonymous',
        isAuthenticated: false,
      };
    }
  }

  // Public endpoint - allow anonymous
  const user = getUserOrAnonymous(cookies);
  return {
    userId: user.id || 'anonymous',
    username: user.username || 'anonymous',
    role: (user.role as 'owner' | 'guest' | 'anonymous') || 'anonymous',
    isAuthenticated: user.role !== 'anonymous',
  };
}

/**
 * Parse query params from URL
 */
function parseQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

/**
 * Parse path params from Astro context
 */
function parseParams(context: APIContext): Record<string, string> {
  const params: Record<string, string> = {};
  if (context.params) {
    for (const [key, value] of Object.entries(context.params)) {
      if (value !== undefined) {
        params[key] = value;
      }
    }
  }
  return params;
}

/**
 * Convert Astro headers to plain object
 */
function parseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * Convert Astro context to UnifiedRequest
 */
async function toUnifiedRequest(
  context: APIContext,
  requiresAuth: boolean
): Promise<UnifiedRequest> {
  const user = resolveUser(context.cookies, requiresAuth);

  // Parse body for POST/PUT/PATCH/DELETE
  let body: any = undefined;
  const method = context.request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const contentType = context.request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await context.request.json();
      } catch {
        // Invalid JSON - body stays undefined
      }
    } else if (contentType.includes('text/')) {
      try {
        body = await context.request.text();
      } catch {
        // Text parse failed
      }
    }
  }

  // Get cognitive mode from security policy if available
  let cognitiveMode: string | undefined;
  try {
    const policy = getSecurityPolicy(context);
    cognitiveMode = policy.mode;
  } catch {
    // Security policy not available
  }

  return {
    path: context.url.pathname,
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    body,
    query: parseQuery(context.url),
    headers: parseHeaders(context.request.headers),
    params: parseParams(context),
    user,
    // Include cognitive mode as custom metadata
    metadata: cognitiveMode ? { cognitiveMode } : undefined,
  } as UnifiedRequest & { metadata?: { cognitiveMode?: string } };
}

/**
 * Apply cookie operations to Astro response
 */
function applyCookies(cookies: AstroCookies, operations: CookieOperation[]): void {
  for (const op of operations) {
    if (op.action === 'set') {
      cookies.set(op.name, op.value!, op.options);
    } else if (op.action === 'delete') {
      cookies.delete(op.name, op.options);
    }
  }
}

/**
 * Convert async iterable to ReadableStream for streaming responses
 */
function streamToReadable(stream: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Convert UnifiedResponse to Astro Response
 */
function toAstroResponse(
  res: UnifiedResponse,
  cookies: AstroCookies
): Response {
  // Apply cookie operations
  if (res.cookies && res.cookies.length > 0) {
    applyCookies(cookies, res.cookies);
  }

  // Handle streaming responses
  if (res.stream) {
    return new Response(streamToReadable(res.stream), {
      status: res.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...res.headers,
      },
    });
  }

  // Standard JSON response
  const body = res.error
    ? JSON.stringify({ error: res.error })
    : JSON.stringify(res.data);

  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      ...res.headers,
    },
  });
}

/**
 * Create an Astro API route handler from the unified router
 *
 * This is the main factory function for migrating Astro routes to unified handlers.
 *
 * @param requiresAuth - Whether the route requires authentication (default: false)
 * @returns Astro APIRoute handler
 *
 * @example
 * // apps/site/src/pages/api/capture.ts
 * import { createAstroHandler } from '../../lib/server/api-adapter';
 * export const POST = createAstroHandler(true); // requiresAuth = true
 *
 * @example
 * // apps/site/src/pages/api/status.ts
 * import { createAstroHandler } from '../../lib/server/api-adapter';
 * export const GET = createAstroHandler(); // public endpoint
 */
export function createAstroHandler(requiresAuth = false): APIRoute {
  return async (context: APIContext): Promise<Response> => {
    try {
      const req = await toUnifiedRequest(context, requiresAuth);
      const res = await routeRequest(req);
      return toAstroResponse(res, context.cookies);
    } catch (error) {
      console.error('[api-adapter] Error:', error);
      return new Response(
        JSON.stringify({ error: (error as Error).message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

/**
 * Create a catch-all Astro API route handler
 *
 * This can be used to route ALL API requests through the unified layer.
 * Useful for [...path].ts catch-all routes.
 *
 * @example
 * // apps/site/src/pages/api/[...path].ts
 * import { createCatchAllHandler } from '../../lib/server/api-adapter';
 * export const ALL = createCatchAllHandler();
 */
export function createCatchAllHandler(): APIRoute {
  return async (context: APIContext): Promise<Response> => {
    try {
      // Start with public access - the router will enforce auth requirements
      const req = await toUnifiedRequest(context, false);
      const res = await routeRequest(req);
      return toAstroResponse(res, context.cookies);
    } catch (error) {
      console.error('[api-adapter] Catch-all error:', error);
      return new Response(
        JSON.stringify({ error: (error as Error).message }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

/**
 * Helper to create handlers for all HTTP methods
 *
 * @example
 * // apps/site/src/pages/api/tasks.ts
 * import { createAstroHandlers } from '../../lib/server/api-adapter';
 * export const { GET, POST } = createAstroHandlers({ GET: false, POST: true });
 */
export function createAstroHandlers(
  methods: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', boolean>>
): Record<string, APIRoute> {
  const handlers: Record<string, APIRoute> = {};
  for (const [method, requiresAuth] of Object.entries(methods)) {
    handlers[method] = createAstroHandler(requiresAuth ?? false);
  }
  return handlers;
}
