/**
 * User Context Management
 *
 * Provides thread-safe user context using AsyncLocalStorage for multi-user operations.
 * Context automatically resolves user-specific paths and configuration.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { getProfilePaths, systemPaths } from './path-builder.js';
import { audit } from './audit.js';

const LOG_PREFIX = '[context]';

/**
 * User context for authenticated users
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO ANONYMOUS USERS - ALL ACCESS REQUIRES AUTHENTICATION                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  owner    - Full system access, can manage other users                    ║
 * ║  standard - Read/write access to their own profile                        ║
 * ║  guest    - Read-only access (authenticated via auth gate, no password)   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export interface UserContext {
  userId: string;
  username: string;
  role: 'owner' | 'standard' | 'guest';
  profilePaths: ReturnType<typeof getProfilePaths>; // All authenticated users have profile paths
  systemPaths: typeof systemPaths;
  activeProfile?: string; // Selected profile for guest users viewing another profile
}

const contextStorage = new AsyncLocalStorage<UserContext | undefined>();

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
  console.log(`${LOG_PREFIX} ========== withUserContext HIT ==========`);
  console.log(`${LOG_PREFIX} User: ${user.username} (${user.role}), activeProfile: ${user.activeProfile || 'none'}`);

  // Safety check: ensure username is defined (all users must be authenticated)
  if (!user.username) {
    const error = new Error(`Invalid user context: username is undefined for user ${user.userId} with role ${user.role}`);
    console.error(`${LOG_PREFIX} Context creation failed:`, error);
    audit({
      category: 'security',
      level: 'error',
      event: 'context_creation_failed',
      details: { userId: user.userId, role: user.role, reason: 'missing_username' },
      actor: 'context-system'
    });
    throw error;
  }

  // For guests with an active profile, use that profile's paths
  // Otherwise use the user's own username
  const profileUser =
    user.activeProfile && user.role !== 'owner' ? user.activeProfile : user.username;
  console.log(`${LOG_PREFIX} Profile user resolved to: ${profileUser}`);
  
  const profilePaths = getProfilePaths(profileUser);

  const context: UserContext = {
    userId: user.userId,
    username: user.username,
    role: user.role as 'owner' | 'standard' | 'guest',
    profilePaths,
    systemPaths,
    activeProfile: user.activeProfile,
  };

  // Log context creation for audit trail
  audit({
    category: 'system',
    level: 'info',
    event: 'user_context_created',
    details: { 
      userId: user.userId, 
      username: user.username, 
      role: user.role,
      activeProfile: user.activeProfile,
      profilePath: profilePaths.root
    },
    actor: user.username
  });

  return contextStorage.run(context, async () => {
    try {
      console.log(`${LOG_PREFIX} Executing function within user context`);
      const result = await fn();
      console.log(`${LOG_PREFIX} Function completed successfully`);
      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} Function execution failed within context:`, error);
      audit({
        category: 'system',
        level: 'error',
        event: 'context_function_failed',
        details: { 
          userId: user.userId, 
          username: user.username,
          error: (error as Error).message
        },
        actor: user.username
      });
      throw error;
    }
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
  role: 'owner' | 'standard' | 'guest'
): void {
  console.log(`${LOG_PREFIX} ========== setUserContext HIT ==========`);
  console.log(`${LOG_PREFIX} DEPRECATED: Setting context for ${username} (${role})`);
  
  // All authenticated users have profile paths
  const profilePaths = getProfilePaths(username);

  const context: UserContext = {
    userId,
    username,
    role,
    profilePaths,
    systemPaths,
  };

  // Log deprecated context usage
  audit({
    category: 'system',
    level: 'warn',
    event: 'deprecated_context_set',
    details: { userId, username, role, profilePath: profilePaths.root },
    actor: username
  });

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
  console.log(`${LOG_PREFIX} ========== clearUserContext HIT ==========`);
  console.log(`${LOG_PREFIX} DEPRECATED: Clearing user context`);
  
  // Log deprecated context clearing
  audit({
    category: 'system',
    level: 'warn',
    event: 'deprecated_context_clear',
    details: {},
    actor: 'context-system'
  });

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
  const context = contextStorage.getStore();
  console.log(`${LOG_PREFIX} getUserContext called, found: ${context ? `${context.username} (${context.role})` : 'none'}`);
  return context;
}

/**
 * Check if there is an active user context
 *
 * @returns true if user context is set
 */
export function hasUserContext(): boolean {
  const hasContext = contextStorage.getStore() !== undefined;
  console.log(`${LOG_PREFIX} hasUserContext called, result: ${hasContext}`);
  return hasContext;
}
