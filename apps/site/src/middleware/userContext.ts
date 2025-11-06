/**
 * User Context Middleware
 *
 * Automatically wraps API route handlers with user context based on session.
 * This ensures that all path and config operations use the correct user's data.
 *
 * SECURITY: Anonymous requests run with a special 'anonymous' context that
 * blocks all write operations and provides no access to user data.
 */

import type { APIRoute } from 'astro';
import { withUserContext as runWithUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';

/**
 * Wrap an API route handler with user context
 *
 * Extracts session from cookie, validates it, and runs handler with user context.
 * Falls back to no context for anonymous users.
 *
 * @param handler - API route handler to wrap
 * @returns Wrapped handler with automatic user context management
 *
 * @example
 * ```typescript
 * // In an API route file
 * import { withUserContext } from '../../middleware/userContext';
 *
 * const handler: APIRoute = async (context) => {
 *   // paths.episodic automatically resolves to user's profile
 *   const memories = await loadMemories();
 *   return new Response(JSON.stringify(memories));
 * };
 *
 * export const GET = withUserContext(handler);
 * ```
 */
export function withUserContext(handler: APIRoute): APIRoute {
  return async (context) => {
    // Try to get session cookie from Astro context
    const sessionCookie = context.cookies.get('mh_session');

    if (sessionCookie) {
      // Validate session
      const session = validateSession(sessionCookie.value);

      if (session) {
        // Get CURRENT user details from database (not cached in session)
        // This ensures role changes are immediately reflected
        const user = getUser(session.userId);

        if (user) {
          // Check if guest has selected a profile
          const activeProfile = session.metadata?.activeProfile;

          // Run handler with user context using CURRENT role from database
          // This prevents stale privilege escalation
          return await runWithUserContext(
            {
              userId: user.id,
              username: user.username,
              role: user.role,
              activeProfile: activeProfile, // Pass selected profile for guests
            },
            () => handler(context)
          );
        }
      }
    }

    // SECURITY: No session - run with anonymous context
    // This prevents fallback to root paths and protects owner data
    return await runWithUserContext(
      { userId: 'anonymous', username: 'anonymous', role: 'anonymous' },
      () => handler(context)
    );
  };
}
