/**
 * Simple Auth Helpers - No Middleware Bullshit
 *
 * Replaces the overcomplicated withUserContext middleware + AsyncLocalStorage approach
 * with simple, explicit, debuggable auth checks at the handler level.
 */

import { validateSession } from './sessions.js';
import { getUser } from './users.js';
import { getProfilePaths } from './paths.js';
import { audit } from './audit.js';

const LOG_PREFIX = '[auth]';

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
  // console.log(`${LOG_PREFIX} ========== getAuthenticatedUser HIT ==========`);
  
  const sessionId = getSessionId(auth);
  // console.log(`${LOG_PREFIX} Session ID: ${sessionId ? 'found' : 'missing'}`);

  if (!sessionId) {
    console.log(`${LOG_PREFIX} No session ID found - throwing AuthRequiredError`);
    audit({
      category: 'security',
      event: 'auth_failed',
      level: 'warn',
      details: { reason: 'no_session' }
    });
    throw new AuthRequiredError('No session - redirect to auth gate');
  }

  const session = validateSession(sessionId);
  // console.log(`${LOG_PREFIX} Session validation: ${session ? 'valid' : 'invalid'}`);

  if (!session) {
    console.log(`${LOG_PREFIX} Invalid/expired session - throwing AuthRequiredError`);
    audit({
      category: 'security',
      event: 'auth_failed', 
      level: 'warn',
      details: { reason: 'invalid_session', sessionId: sessionId.substring(0, 8) + '...' }
    });
    throw new AuthRequiredError('Invalid or expired session - redirect to auth gate');
  }

  // Get CURRENT user from database (not cached in session)
  // This ensures role changes are immediately reflected
  const user = getUser(session.userId);
  // console.log(`${LOG_PREFIX} User lookup for ID ${session.userId}: ${user ? 'found' : 'not found'}`);

  if (!user) {
    console.log(`${LOG_PREFIX} User not found - throwing AuthRequiredError`);
    audit({
      category: 'security',
      event: 'auth_failed',
      level: 'error',
      details: { reason: 'user_not_found', userId: session.userId }
    });
    throw new AuthRequiredError('User not found - redirect to auth gate');
  }

  // console.log(`${LOG_PREFIX} Auth successful: ${user.username} (${user.role})`);
  audit({
    category: 'security',
    event: 'auth_success',
    level: 'info',
    userId: user.id,
    details: { username: user.username, role: user.role }
  });
  
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
export function getUserPaths(user: User): ReturnType<typeof getProfilePaths> {
  return getProfilePaths(user.username);
}
