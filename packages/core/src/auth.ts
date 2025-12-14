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

/**
 * Authenticated user - all valid users in the system
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO ANONYMOUS USERS - ALL ACCESS REQUIRES AUTHENTICATION                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  owner    - Full system access, can manage other users                    ║
 * ║  standard - Read/write access to their own profile                        ║
 * ║  guest    - Read-only access (authenticated via auth gate, no password)   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  role: 'owner' | 'standard' | 'guest';
}

// User is ALWAYS authenticated - no anonymous access allowed
export type User = AuthenticatedUser;

/**
 * Custom error class for auth failures - indicates redirect to auth gate needed
 */
export class AuthRequiredError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

/**
 * Get authenticated user from session
 *
 * UNIVERSAL - works for both web (cookies) and mobile (session token string)
 *
 * Throws AuthRequiredError if:
 * - No session (redirect to auth gate)
 * - Invalid/expired session (redirect to auth gate)
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
    throw new AuthRequiredError('No session - redirect to auth gate');
  }

  const session = validateSession(sessionId);

  if (!session) {
    throw new AuthRequiredError('Invalid or expired session - redirect to auth gate');
  }

  // Get CURRENT user from database (not cached in session)
  // This ensures role changes are immediately reflected
  const user = getUser(session.userId);

  if (!user) {
    throw new AuthRequiredError('User not found - redirect to auth gate');
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role as 'owner' | 'standard' | 'guest',
  };
}

/**
 * Get profile paths for a user
 *
 * Returns profile paths for the authenticated user.
 * Since all users are now authenticated, this always succeeds.
 *
 * @example
 * ```typescript
 * const user = getAuthenticatedUser(cookies);
 * const paths = getUserPaths(user);
 * ```
 */
export function getUserPaths(user: User) {
  return getProfilePaths(user.username);
}

/**
 * Check if user has permission for an operation
 *
 * Permission levels by role:
 * - guest: read only
 * - standard: read + write
 * - owner: read + write + admin
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
