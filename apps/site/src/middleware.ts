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

// CORS headers for mobile app cross-origin requests
// When the mobile app loads from file:// and calls https://mh.dndiy.org/api/*
// IMPORTANT: Access-Control-Allow-Origin cannot be '*' when using credentials
// We must echo back the request's Origin header for credentials to work
function getCorsHeaders(origin: string | null): Record<string, string> {
  return {
    // Echo back origin (or use 'null' for file:// requests)
    // This is required when Access-Control-Allow-Credentials is true
    'Access-Control-Allow-Origin': origin || 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function addCorsHeaders(response: Response, origin: string | null): Response {
  const corsHeaders = getCorsHeaders(origin);
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
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight (OPTIONS) requests
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Error handling wrapper for auth errors
  try {
    const response = await processRequest(context, next);
    // Add CORS headers to all API responses
    return addCorsHeaders(response, origin);
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
