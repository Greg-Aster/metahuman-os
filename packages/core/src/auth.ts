/**
 * Simple Auth Helpers - No Middleware Bullshit
 *
 * Replaces the overcomplicated withUserContext middleware + AsyncLocalStorage approach
 * with simple, explicit, debuggable auth checks at the handler level.
 */

import { validateSession } from './sessions.js';
import { getUser } from './users.js';
import { getProfilePaths, systemPaths } from './paths.js';

// Generic cookies interface - works with Astro or any other framework
export interface Cookies {
  get(name: string): { value: string } | undefined;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'owner' | 'standard' | 'guest';
}

export interface AnonymousUser {
  id: 'anonymous';
  username: 'anonymous';
  role: 'anonymous';
}

export type User = AuthenticatedUser | AnonymousUser;

/**
 * Get authenticated user from session cookie
 *
 * Throws error if:
 * - No session cookie
 * - Invalid session
 * - Session is anonymous
 * - User not found in database
 *
 * Use this for protected endpoints that require authentication.
 *
 * @example
 * ```typescript
 * export const POST: APIRoute = async ({ cookies }) => {
 *   const user = getAuthenticatedUser(cookies);
 *   const paths = getProfilePaths(user.username);
 *   // ... do authenticated stuff
 * };
 * ```
 */
export function getAuthenticatedUser(cookies: Cookies): AuthenticatedUser {
  const sessionCookie = cookies.get('mh_session');

  if (!sessionCookie) {
    throw new Error('UNAUTHORIZED: No session cookie');
  }

  const session = validateSession(sessionCookie.value);

  if (!session) {
    throw new Error('UNAUTHORIZED: Invalid session');
  }

  if (session.role === 'anonymous') {
    throw new Error('UNAUTHORIZED: Anonymous session not allowed');
  }

  // Get CURRENT user from database (not cached in session)
  // This ensures role changes are immediately reflected
  const user = getUser(session.userId);

  if (!user) {
    throw new Error('UNAUTHORIZED: User not found');
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role as 'owner' | 'standard' | 'guest',
  };
}

/**
 * Get user or return anonymous user
 *
 * Never throws - returns anonymous user if auth fails.
 * Use this for public endpoints that degrade gracefully for anonymous users.
 *
 * @example
 * ```typescript
 * export const GET: APIRoute = async ({ cookies }) => {
 *   const user = getUserOrAnonymous(cookies);
 *
 *   if (user.role === 'anonymous') {
 *     return new Response(JSON.stringify({ message: 'Please log in' }));
 *   }
 *
 *   const paths = getProfilePaths(user.username);
 *   // ... do user-specific stuff
 * };
 * ```
 */
export function getUserOrAnonymous(cookies: Cookies): User {
  try {
    return getAuthenticatedUser(cookies);
  } catch (error) {
    return {
      id: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
    };
  }
}

/**
 * Get profile paths for a user
 *
 * Safe wrapper around getProfilePaths that handles anonymous users.
 * Returns null for anonymous users instead of throwing.
 *
 * @example
 * ```typescript
 * const user = getUserOrAnonymous(cookies);
 * const paths = getUserPaths(user);
 *
 * if (!paths) {
 *   return new Response('Unauthorized', { status: 401 });
 * }
 * ```
 */
export function getUserPaths(user: User) {
  if (user.role === 'anonymous') {
    return null;
  }

  return getProfilePaths(user.username);
}

/**
 * Check if user has permission for an operation
 *
 * @example
 * ```typescript
 * const user = getAuthenticatedUser(cookies);
 *
 * if (!hasPermission(user, 'write')) {
 *   return new Response('Forbidden', { status: 403 });
 * }
 * ```
 */
export function hasPermission(
  user: User,
  permission: 'read' | 'write' | 'admin'
): boolean {
  if (user.role === 'anonymous') {
    return permission === 'read'; // Anonymous can only read
  }

  if (user.role === 'guest') {
    return permission === 'read'; // Guests can only read
  }

  if (user.role === 'standard') {
    return permission !== 'admin'; // Standard users can read/write but not admin
  }

  // Owner can do everything
  return true;
}

/**
 * Require specific permission or throw 403
 *
 * @example
 * ```typescript
 * const user = getAuthenticatedUser(cookies);
 * requirePermission(user, 'write'); // Throws if no write permission
 * ```
 */
export function requirePermission(
  user: User,
  permission: 'read' | 'write' | 'admin'
): void {
  if (!hasPermission(user, permission)) {
    throw new Error(`FORBIDDEN: User ${user.username} lacks ${permission} permission`);
  }
}
