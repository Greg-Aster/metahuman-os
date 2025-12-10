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

// Universal auth input - accepts cookies OR session token string
export type AuthInput = Cookies | string | undefined;

// Helper to extract session ID from either format
function getSessionId(auth: AuthInput): string | undefined {
  if (!auth) return undefined;
  if (typeof auth === 'string') return auth; // Direct session token (mobile)
  return auth.get('mh_session')?.value; // Cookie interface (web)
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'owner' | 'standard' | 'guest';
}

export interface AnonymousUser {
  id: 'anonymous' | 'guest';
  username: 'anonymous' | 'guest';
  role: 'anonymous';
  metadata?: {
    sourceProfile?: string;
  };
}

export type User = AuthenticatedUser | AnonymousUser;

/**
 * Get authenticated user from session
 *
 * UNIVERSAL - works for both web (cookies) and mobile (session token string)
 *
 * Throws error if:
 * - No session
 * - Invalid session
 * - Session is anonymous
 * - User not found in database
 *
 * @example
 * ```typescript
 * // Web (Astro cookies)
 * const user = getAuthenticatedUser(cookies);
 *
 * // Mobile (session token string)
 * const user = getAuthenticatedUser(sessionToken);
 * ```
 */
export function getAuthenticatedUser(auth: AuthInput): AuthenticatedUser {
  const sessionId = getSessionId(auth);

  if (!sessionId) {
    throw new Error('UNAUTHORIZED: No session');
  }

  const session = validateSession(sessionId);

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
 * UNIVERSAL - works for both web (cookies) and mobile (session token string)
 *
 * Never throws - returns anonymous user if auth fails.
 * Use this for public endpoints that degrade gracefully for anonymous users.
 *
 * @example
 * ```typescript
 * // Web (Astro cookies)
 * const user = getUserOrAnonymous(cookies);
 *
 * // Mobile (session token string)
 * const user = getUserOrAnonymous(sessionToken);
 * ```
 */
export function getUserOrAnonymous(auth: AuthInput): User {
  try {
    return getAuthenticatedUser(auth);
  } catch (error) {
    // Check if this is an anonymous session with a selected guest profile
    const sessionId = getSessionId(auth);
    if (sessionId) {
      const session = validateSession(sessionId);
      if (session?.role === 'anonymous' && session.metadata?.activeProfile === 'guest') {
        return {
          id: 'guest',
          username: 'guest',
          role: 'anonymous' as const,
          metadata: {
            sourceProfile: session.metadata.sourceProfile,
          },
        } as User;
      }
    }
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
