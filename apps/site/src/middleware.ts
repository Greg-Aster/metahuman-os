/**
 * Global Astro Middleware
 *
 * Automatically applies user context to ALL API routes.
 *
 * NOTE: Startup config loading removed (2025-12-23)
 * All configs are user-specific and only loaded within authenticated user context.
 * Auto-start features (Open Interpreter, Big Brother) are triggered by user requests,
 * not server startup.
 */

import { defineMiddleware } from 'astro:middleware';
import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';
import { claimWorkCoordinatorOwnership, ensureQueueSystemStarted } from '@metahuman/core/queue';
import { getModeController } from '@metahuman/core/active-operator/mode';

// Astro loads the middleware module as part of the maintained server entrypoint.
// Start system work coordination here once, independently of UI page visits.
claimWorkCoordinatorOwnership();
void ensureQueueSystemStarted()
  .then(() => getModeController().applyConfiguredMode())
  .catch(error => {
    console.error('[server-boot] Work coordinator failed to start:', error);
  });

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return (end >= 0 ? host.slice(1, end) : host.slice(1)).toLowerCase();
  }
  return host.split(':')[0].toLowerCase();
}

function isLoopbackHost(host: string): boolean {
  const name = stripPort(host);
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

function allowedOrigins(): Set<string> {
  return new Set((process.env.MH_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean));
}

function isCorsAllowed(origin: string | null, host: string | null, method: string): boolean {
  if (!origin) return true;

  const mode = process.env.MH_EXPOSURE_MODE === 'shared' ? 'shared' : 'local';
  const requestHost = host || '';

  if (origin === 'null') {
    return mode === 'local' && isLoopbackHost(requestHost) && !MUTATING_METHODS.has(method.toUpperCase());
  }

  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  if (originHost === requestHost) return true;

  if (mode === 'local') {
    return isLoopbackHost(originHost) && isLoopbackHost(requestHost);
  }

  return allowedOrigins().has(origin);
}

function getCorsHeaders(origin: string | null, host: string | null, method: string): Record<string, string> {
  if (!isCorsAllowed(origin, host, method)) {
    return {};
  }

  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function addCorsHeaders(response: Response, origin: string | null, host: string | null, method: string): Response {
  const corsHeaders = getCorsHeaders(origin, host, method);
  if (Object.keys(corsHeaders).length === 0) return response;

  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Only apply to API routes
  if (!context.url.pathname.startsWith('/api/')) {
    return next();
  }

  // Get Origin header for CORS (mobile app sends 'null' from file://)
  const origin = context.request.headers.get('Origin');
  const host = context.request.headers.get('Host');
  const preflightMethod = context.request.headers.get('Access-Control-Request-Method');
  const corsMethod = context.request.method === 'OPTIONS' && preflightMethod
    ? preflightMethod
    : context.request.method;
  const corsHeaders = getCorsHeaders(origin, host, corsMethod);

  // Handle CORS preflight (OPTIONS) requests
  if (context.request.method === 'OPTIONS') {
    if (origin && Object.keys(corsHeaders).length === 0) {
      return new Response(JSON.stringify({ error: 'CORS origin is not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Error handling wrapper for auth errors
  try {
    const response = await processRequest(context, next);
    // Add CORS headers to all API responses
    return addCorsHeaders(response, origin, host, context.request.method);
  } catch (error) {
    // Convert auth errors to proper HTTP responses
    const errorMessage = (error as Error).message;

    if (errorMessage.startsWith('UNAUTHORIZED:')) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
          message: errorMessage.replace('UNAUTHORIZED: ', '')
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }

    if (errorMessage.startsWith('FORBIDDEN:')) {
      return new Response(
        JSON.stringify({
          error: 'Forbidden',
          message: errorMessage.replace('FORBIDDEN: ', '')
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        }
      );
    }

    // Re-throw other errors
    throw error;
  }
});

async function processRequest(context: any, next: any) {
  // Hand resolved authentication to the Astro adapter so it does not repeat
  // this session and user lookup. Custom Astro routes can keep using locals.
  context.locals.authResolved = true;
  context.locals.userContext = undefined;

  // Try to get session cookie
  const sessionCookie = context.cookies.get('mh_session');

  if (sessionCookie) {
    // Validate session
    const session = validateSession(sessionCookie.value);

    if (session) {
      // Get CURRENT user details from database (not cached in session)
      // This ensures role changes are immediately reflected
      const user = getUser(session.userId);

      if (user) {
        // Set user context in locals for API routes to access
        context.locals.userContext = {
          userId: user.id,
          username: user.username,
          role: user.role,
        };

        // Run request with authenticated user context
        return await runWithUserContext(
          { userId: user.id, username: user.username, role: user.role },
          () => next()
        );
      }
    }
  }

  // SECURITY: No session - run WITHOUT user context
  // NOTE: Dev auto-login removed for security (2025-11-20)
  // Use scripts/dev-session.ts to create auth session in development
  //
  // By not setting user context, getUserContext() returns undefined, which:
  // 1. Prevents storage router from creating profile directories
  // 2. Causes config loading to fall back to system etc/ paths
  // 3. Handlers check req.user.isAuthenticated to reject unauthenticated requests
  return await next();
}
