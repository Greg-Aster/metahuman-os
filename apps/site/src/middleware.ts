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
        // Run request with authenticated user context
        return await runWithUserContext(
          { userId: user.id, username: user.username, role: user.role },
          () => next()
        );
      }
    }
  }

  // SECURITY: No session - run with anonymous context
  // This prevents fallback to root paths and protects owner data
  return await runWithUserContext(
    { userId: 'anonymous', username: 'anonymous', role: 'anonymous' },
    () => next()
  );
});
