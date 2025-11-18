/**
 * Global Astro Middleware
 *
 * Automatically applies user context to ALL API routes
 */

import { defineMiddleware } from 'astro:middleware';
import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';
import { getUser, getUserByUsername } from '@metahuman/core/users';

export const onRequest = defineMiddleware(async (context, next) => {
  // Only apply to API routes
  if (!context.url.pathname.startsWith('/api/')) {
    return next();
  }

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

  // DEVELOPMENT MODE: Auto-login as owner if no session exists
  // This avoids needing to manually set cookies during development
  const isDevelopment = import.meta.env.DEV;
  const devAutoLogin = process.env.DEV_AUTO_LOGIN !== 'false'; // Default to true in dev
  const devUsername = process.env.DEV_USERNAME || 'greggles'; // Allow override via env var

  if (isDevelopment && devAutoLogin) {
    // Try to find the specified user (defaults to 'greggles')
    const ownerUser = getUserByUsername(devUsername);

    if (ownerUser && ownerUser.role === 'owner') {

      // Set user context in locals
      context.locals.userContext = {
        userId: ownerUser.id,
        username: ownerUser.username,
        role: ownerUser.role,
      };

      // Run request with owner context
      return await runWithUserContext(
        { userId: ownerUser.id, username: ownerUser.username, role: ownerUser.role },
        () => next()
      );
    }
  }

  // SECURITY: No session - run with anonymous context
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
});
