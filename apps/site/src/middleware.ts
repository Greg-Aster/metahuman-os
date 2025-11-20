/**
 * Global Astro Middleware
 *
 * Automatically applies user context to ALL API routes
 */

import { defineMiddleware } from 'astro:middleware';
import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';

export const onRequest = defineMiddleware(async (context, next) => {
  // Only apply to API routes
  if (!context.url.pathname.startsWith('/api/')) {
    return next();
  }

  // Error handling wrapper for auth errors
  try {
    return await processRequest(context, next);
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
          headers: { 'Content-Type': 'application/json' }
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
          headers: { 'Content-Type': 'application/json' }
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
      // Handle anonymous sessions
      if (session.role === 'anonymous') {
        // All anonymous users use the 'guest' profile
        const activeProfile = session.metadata?.activeProfile || undefined;

        // Set anonymous context in locals
        context.locals.userContext = {
          userId: 'anonymous',
          username: 'anonymous', // Always 'anonymous' for anonymous users
          role: 'anonymous',
          activeProfile: activeProfile, // The selected profile ('guest')
        };

        // Run request with anonymous user context
        return await runWithUserContext(
          {
            userId: 'anonymous',
            username: 'anonymous', // Always 'anonymous' for anonymous users
            role: 'anonymous',
            activeProfile, // The selected profile ('guest')
          },
          () => next()
        );
      }

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

  // SECURITY: No session - run with anonymous context
  // NOTE: Dev auto-login removed for security (2025-11-20)
  // Use scripts/dev-session.ts to create auth session in development
  // Set anonymous context in locals
  context.locals.userContext = {
    userId: 'anonymous',
    username: 'anonymous',
    role: 'anonymous',
  };

  // This prevents fallback to root paths and protects owner data
  return await runWithUserContext(
    { userId: 'anonymous', username: 'anonymous', role: 'anonymous' },
    () => next()
  );
}
