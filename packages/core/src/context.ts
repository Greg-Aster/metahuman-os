/**
 * User Context Management
 *
 * Provides thread-safe user context using AsyncLocalStorage for multi-user operations.
 * Context automatically resolves user-specific paths and configuration.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { getProfilePaths, systemPaths } from './path-builder.js';

export interface UserContext {
  userId: string;
  username: string;
  role: 'owner' | 'standard' | 'guest' | 'anonymous';
  profilePaths: ReturnType<typeof getProfilePaths>;
  systemPaths: typeof systemPaths;
  activeProfile?: string; // Selected profile for guest users
}

const contextStorage = new AsyncLocalStorage<UserContext>();

/**
 * Run function with isolated user context (RECOMMENDED)
 *
 * Automatically manages context lifecycle and prevents leakage to other async operations.
 * This is the recommended way to handle user context as it ensures proper cleanup.
 *
 * @param user - User information (userId, username, role)
 * @param fn - Function to run with user context
 * @returns Promise resolving to function result
 *
 * @example
 * ```typescript
 * await withUserContext(
 *   { userId: 'abc123', username: 'greggles', role: 'owner' },
 *   async () => {
 *     const memories = findUnprocessedMemories(); // Uses context!
 *     await processMemories(memories);
 *   }
 * );
 * // Context automatically cleaned up - no leakage to next operation
 * ```
 */
export function withUserContext<T>(
  user: { userId: string; username: string; role: string; activeProfile?: string },
  fn: () => T | Promise<T>
): Promise<T> {
  // For guests with an active profile, use that profile's paths
  // Otherwise use the user's own username
  const profileUser =
    user.activeProfile && user.role !== 'owner' ? user.activeProfile : user.username;

  const profilePaths = getProfilePaths(profileUser);
  const context: UserContext = {
    userId: user.userId,
    username: user.username,
    role: user.role as 'owner' | 'standard' | 'guest' | 'anonymous',
    profilePaths,
    systemPaths,
    activeProfile: user.activeProfile,
  };

  return contextStorage.run(context, async () => {
    const result = await fn();
    return result;
  });
}

/**
 * Set user context for current async scope (DEPRECATED)
 *
 * WARNING: This uses AsyncLocalStorage.enterWith() which can leak context to unrelated
 * async operations. Prefer using withUserContext() instead for automatic isolation.
 *
 * Only use this if you have legacy code that cannot be refactored to use withUserContext().
 *
 * @param userId - User ID
 * @param username - Username for profile directory
 * @param role - User role
 *
 * @deprecated Use withUserContext() instead for automatic cleanup
 */
export function setUserContext(
  userId: string,
  username: string,
  role: 'owner' | 'standard' | 'guest' | 'anonymous'
): void {
  const profilePaths = getProfilePaths(username);
  const context: UserContext = {
    userId,
    username,
    role,
    profilePaths,
    systemPaths,
  };

  contextStorage.enterWith(context);
}

/**
 * Clear user context (DEPRECATED)
 *
 * WARNING: Only works with setUserContext(). If you used withUserContext(),
 * context is automatically cleaned up when the function completes.
 *
 * @deprecated Use withUserContext() instead for automatic cleanup
 */
export function clearUserContext(): void {
  contextStorage.enterWith(undefined);
}

/**
 * Get current user context
 *
 * Returns undefined if no context is set (e.g., system operations, unauthenticated requests).
 *
 * @returns Current user context or undefined
 */
export function getUserContext(): UserContext | undefined {
  return contextStorage.getStore();
}

/**
 * Check if there is an active user context
 *
 * @returns true if user context is set
 */
export function hasUserContext(): boolean {
  return contextStorage.getStore() !== undefined;
}
