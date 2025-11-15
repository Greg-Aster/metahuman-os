/**
 * User Resolver
 *
 * Resolves username to full UserContext object for use with withUserContext().
 * Used by training orchestrators to get user context from CLI arguments.
 */

import { getUserByUsername } from './users.js';
import { getProfilePaths, systemPaths } from './paths.js';
import type { UserContext } from './context.js';

/**
 * Resolve username to full UserContext object
 *
 * Looks up user in persona/users.json and returns complete context
 * with profile paths for use with withUserContext().
 *
 * @param username - Username to resolve
 * @returns UserContext object or null if user not found
 *
 * @example
 * ```typescript
 * const userInfo = await resolveUserInfo('greggles');
 * if (!userInfo) {
 *   console.error('User not found');
 *   process.exit(1);
 * }
 *
 * await withUserContext(userInfo, async () => {
 *   // Training operations with user context
 *   const memories = collectEpisodicMemories(ctx.profilePaths.episodic);
 * });
 * ```
 */
export function resolveUserInfo(username: string): UserContext | null {
  // Look up user in users database
  const user = getUserByUsername(username);

  if (!user) {
    console.warn(`[user-resolver] User not found: ${username}`);
    return null;
  }

  // Get profile paths for this user
  const profilePaths = getProfilePaths(username);

  // Build UserContext object
  const context: UserContext = {
    userId: user.id,
    username: user.username,
    role: user.role,
    profilePaths,
    systemPaths,
  };

  return context;
}

/**
 * Resolve username to UserContext, throwing if not found
 *
 * Same as resolveUserInfo() but throws an error instead of returning null.
 * Useful for CLI commands where user not found should halt execution.
 *
 * @param username - Username to resolve
 * @returns UserContext object
 * @throws Error if user not found
 *
 * @example
 * ```typescript
 * const userInfo = requireUserInfo('greggles');
 * await withUserContext(userInfo, async () => {
 *   // Training operations
 * });
 * ```
 */
export function requireUserInfo(username: string): UserContext {
  const context = resolveUserInfo(username);

  if (!context) {
    throw new Error(`User '${username}' not found. Available users: ${listUsernames().join(', ')}`);
  }

  return context;
}

/**
 * List all usernames in the system
 *
 * Useful for error messages and validation.
 *
 * @returns Array of usernames
 */
export function listUsernames(): string[] {
  const { getUsers } = require('./users.js');
  const users = getUsers();
  return users.map((u: any) => u.username);
}

/**
 * Check if a user exists
 *
 * @param username - Username to check
 * @returns true if user exists
 */
export function userExists(username: string): boolean {
  return getUserByUsername(username) !== null;
}
