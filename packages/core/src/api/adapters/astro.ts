/**
 * Astro Adapter
 *
 * Makes Astro routes trivially thin - ONE LINE to call unified handlers.
 * SAME business logic as mobile, just different wrapper.
 *
 * Usage in Astro route:
 * ```typescript
 * import { astroHandler } from '@metahuman/core/api/adapters/astro';
 * export const GET = astroHandler;
 * export const POST = astroHandler;
 * ```
 */

import { handleHttpRequest } from './http.js';

/**
 * Minimal Astro-compatible types (no dependency on astro package)
 * These match Astro's APIContext and APIRoute signatures
 */
interface AstroAPIContext {
  request: Request;
  url: URL;
  cookies: unknown; // We don't use Astro's cookies, we handle them via headers
  params: Record<string, string | undefined>;
  [key: string]: unknown;
}

type AstroAPIRoute = (context: AstroAPIContext) => Response | Promise<Response>;

/**
 * Universal Astro handler that routes ALL requests through unified handlers.
 *
 * This is the SAME code path as mobile - both use handleHttpRequest().
 * The only difference is how we extract request data and format the response.
 */
export const astroHandler: AstroAPIRoute = async (context: AstroAPIContext) => {
  const { request, url } = context;

  // Parse body for non-GET requests
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
  }

  // Parse query params
  const query: Record<string, string> = {};
  url.searchParams.forEach((value: string, key: string) => {
    query[key] = value;
  });

  // Convert headers to plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });

  // Call unified handler - SAME AS MOBILE
  const result = await handleHttpRequest({
    path: url.pathname,
    method: request.method,
    body,
    query,
    headers,
    cookieHeader: request.headers.get('cookie'),
  });

  // Handle streaming responses (SSE)
  if (result.isStreaming && result.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of result.stream!) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          console.error('[astro-adapter] Stream error:', err);
        } finally {
          controller.close();
        }
      },
    });

    const response = new Response(stream, {
      status: result.status,
      headers: result.headers,
    });

    // Set cookies
    if (result.cookies.length > 0) {
      for (const cookieStr of result.cookies) {
        response.headers.append('Set-Cookie', cookieStr);
      }
    }

    return response;
  }

  // Build Astro response (non-streaming)
  // Convert Buffer to Uint8Array for Response compatibility
  const responseBody = Buffer.isBuffer(result.body)
    ? new Uint8Array(result.body)
    : result.body;

  const response = new Response(responseBody, {
    status: result.status,
    headers: result.headers,
  });

  // Set cookies via headers (not Astro's cookie API - this works universally)
  if (result.cookies.length > 0) {
    for (const cookieStr of result.cookies) {
      response.headers.append('Set-Cookie', cookieStr);
    }
  }

  return response;
};

/**
 * Create an Astro handler for a specific HTTP method.
 * Useful when you only want to handle specific methods.
 */
export function createAstroHandler(allowedMethods?: string[]): AstroAPIRoute {
  return async (context: AstroAPIContext) => {
    if (allowedMethods && !allowedMethods.includes(context.request.method)) {
      return new Response(
        JSON.stringify({ error: `Method ${context.request.method} not allowed` }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return astroHandler(context);
  };
}

// Re-export for convenience
export { handleHttpRequest, buildUnifiedRequest } from './http.js';
