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
import type { UnifiedUser } from '../types.js';

/**
 * Minimal Astro-compatible types (no dependency on astro package)
 * These match Astro's APIContext and APIRoute signatures
 */
interface AstroAPIContext {
  request: Request;
  url: URL;
  cookies: unknown; // We don't use Astro's cookies, we handle them via headers
  params: Record<string, string | undefined>;
  locals?: {
    authResolved?: boolean;
    userContext?: {
      userId: string;
      username: string;
      role: 'owner' | 'standard' | 'guest';
    };
  };
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
  const resolvedUser: UnifiedUser | null | undefined = context.locals?.authResolved
    ? context.locals.userContext
      ? {
          ...context.locals.userContext,
          isAuthenticated: true,
        }
      : null
    : undefined;

  // Parse body for non-GET requests
  let body: unknown;
  let rawBody: Buffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.startsWith('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const fields: Record<string, unknown> = {};

        for (const [key, value] of formData.entries()) {
          if (typeof value === 'string') {
            fields[key] = value;
            continue;
          }

          if (value && typeof value === 'object' && 'arrayBuffer' in value) {
            const file = value as unknown as {
              name?: string;
              type?: string;
              size?: number;
              arrayBuffer: () => Promise<ArrayBuffer>;
            };

            fields[key] = {
              name: file.name || key,
              type: file.type || 'application/octet-stream',
              size: file.size || 0,
              buffer: Buffer.from(await file.arrayBuffer()),
            };
          }
        }

        body = fields;
      } catch {
        body = undefined;
      }
    } else if (contentType.startsWith('audio/') ||
        contentType.startsWith('image/') ||
        contentType === 'application/octet-stream') {
      try {
        const arrayBuffer = await request.arrayBuffer();
        rawBody = Buffer.from(arrayBuffer);
      } catch {
        rawBody = undefined;
      }
    } else {
      // Parse JSON body
      try {
        const text = await request.text();
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
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
    rawBody,
    query,
    headers,
    cookieHeader: request.headers.get('cookie'),
    signal: request.signal,
    resolvedUser,
    userContextEstablished: Boolean(resolvedUser?.isAuthenticated),
  });

  // Handle streaming responses (SSE)
  if (result.isStreaming && result.stream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        try {
          for await (const chunk of result.stream!) {
            if (closed || request.signal.aborted) break;
            try {
              controller.enqueue(encoder.encode(chunk));
            } catch (err) {
              closed = true;
              if (!(err instanceof TypeError && String(err.message).includes('Controller is already closed'))) {
                console.error('[astro-adapter] Stream enqueue error:', err);
              }
              break;
            }
          }
        } catch (err) {
          if (!(err instanceof TypeError && String(err.message).includes('Controller is already closed'))) {
            console.error('[astro-adapter] Stream error:', err);
          }
        } finally {
          if (!closed) {
            try {
              controller.close();
            } catch {}
          }
        }
      },
      cancel() {
        (result.stream as AsyncIterator<string> | undefined)?.return?.();
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

// Re-export for convenience
export { handleHttpRequest, buildUnifiedRequest } from './http.js';
