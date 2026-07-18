import {
  loadCognitiveMode,
  canUseOperator,
  type CognitiveModeId,
} from './cognitive-mode.js';
import { validateSession } from './sessions.js';
import { getUser, getUserByUsername } from './users.js';
import { getUserContext } from './context.js';

const LOG_PREFIX = '[security-policy]';

/**
 * Request context interface for HTTP requests
 * Used primarily for Astro request contexts
 */
export interface RequestContext {
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
  username?: string;
  userId?: string;
  role?: UserRole;
  sessionId?: string;
}

/**
 * User role types for access control
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO ANONYMOUS USERS - ALL ACCESS REQUIRES AUTHENTICATION                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  owner    - Full system access, can manage other users                    ║
 * ║  standard - Read/write access to their own profile                        ║
 * ║  guest    - Read-only access (authenticated via auth gate, no password)   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export type UserRole = 'owner' | 'standard' | 'guest';

/**
 * Session information extracted from request context
 */
export interface SessionInfo {
  role: UserRole;
  id?: string;
  email?: string;
  username?: string;
}

/**
 * Security policy details for error responses
 */
export interface SecurityErrorDetails {
  reason: string;
  currentMode?: CognitiveModeId;
  role?: UserRole;
  required?: string;
  // Additional context fields - intentionally flexible for error reporting
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Custom error for security violations
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public details: SecurityErrorDetails
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Unified security policy that combines cognitive mode + user role
 *
 * This is the single source of truth for all permission decisions.
 */
export interface SecurityPolicy {
  // Core permissions
  canReadMemory: boolean;
  canWriteMemory: boolean;
  canUseOperator: boolean;
  canChangeMode: boolean;
  canChangeTrust: boolean;
  canAccessTraining: boolean;
  canFactoryReset: boolean;

  // Multi-user permissions
  canEditSystemCode: boolean;
  canAccessAllProfiles: boolean;
  canEditOwnProfile: boolean;

  // Path-based permissions (new tier system)
  canReadDocs: boolean;
  canWriteDocs: boolean;
  canReadProfile(username: string): boolean;
  canWriteProfile(username: string): boolean;
  canAccessSystemConfigs: boolean;

  // Context
  role: UserRole;
  mode: CognitiveModeId;
  sessionId?: string;
  username?: string;

  // Helper methods that throw SecurityError if not allowed
  requireWrite(): void;
  requireOperator(): void;
  requireOwner(): void;
  requireConfig(): void;
  requireFileAccess(filePath: string): void;
  requireProfileRead(targetUsername: string): void;
  requireProfileWrite(targetUsername: string): void;
}

/**
 * Compute security policy based on cognitive mode and session
 *
 * This is the core permission resolution logic.
 */
export function computeSecurityPolicy(
  mode: CognitiveModeId,
  session: SessionInfo | null
): SecurityPolicy {
  // All users must be authenticated - no anonymous access
  // If session is null, it means system operation or error case
  const role = session?.role ?? 'guest'; // Default to most restrictive role
  const username = session?.username;
  const isOwner = role === 'owner';

  // Determine permissions based on mode + role
  const policy: SecurityPolicy = {
    // Memory reads: owner and standard users only (guests are read-only chat)
    canReadMemory: role === 'owner' || role === 'standard',

    // Memory writes: owner and standard users only
    // NOTE: Changed to save memories in ALL modes (dual, agent, emulation) when logged in
    // The cognitiveMode is saved in metadata for LoRA training differentiation
    canWriteMemory: role === 'owner' || role === 'standard',

    // Operator: dual or agent mode AND owner/standard user (not guest, not emulation)
    canUseOperator: canUseOperator(mode) && (role === 'owner' || role === 'standard'),

    // Mode changes: owner and standard users only
    // Users should be able to control their own cognitive mode
    canChangeMode: role === 'owner' || role === 'standard',

    // Trust changes: owner only
    canChangeTrust: role === 'owner',

    // Training: not emulation AND owner only
    canAccessTraining: mode !== 'emulation' && role === 'owner',

    // Factory reset: owner only
    canFactoryReset: role === 'owner',

    // Owner permissions
    canEditSystemCode: isOwner,

    canAccessAllProfiles: isOwner,

    // Edit own profile: owner and standard users only (guests are read-only)
    canEditOwnProfile: role === 'owner' || role === 'standard',

    // Path-based permissions (new tier system)
    // Docs: everyone can read, only the owner can write
    canReadDocs: true, // All authenticated users can read docs
    canWriteDocs: isOwner,

    // Profile access: function-based checks
    canReadProfile: (targetUsername: string) => {
      if (isOwner) return true;
      if (role === 'guest') return false; // Guests cannot read profiles
      return targetUsername === username; // Standard users can read own profile
    },

    canWriteProfile: (targetUsername: string) => {
      if (isOwner) return true;
      if (role === 'guest') return false; // Guests cannot write
      return targetUsername === username; // Standard users can write own profile
    },

    // System configs: owner only
    canAccessSystemConfigs: isOwner,

    // Context
    role,
    mode,
    sessionId: session?.id,
    username,

    // Helper methods
    requireWrite() {
      if (!this.canWriteMemory) {
        throw new SecurityError('Write operations not allowed', {
          reason: role === 'guest' ? 'guest_user' : 'unknown',
          currentMode: mode,
          role,
        });
      }
    },

    requireOperator() {
      if (!this.canUseOperator) {
        throw new SecurityError('Operator access not allowed', {
          reason:
            role !== 'owner' && role !== 'standard'
              ? 'insufficient_role'
              : !canUseOperator(mode)
              ? 'operator_disabled_in_mode'
              : 'unknown',
          currentMode: mode,
          role,
          required: 'authenticated user (owner or standard) in dual/agent mode',
        });
      }
    },

    requireOwner() {
      if (this.role !== 'owner') {
        throw new SecurityError('Owner role required', {
          reason: 'insufficient_role',
          role,
          required: 'owner',
        });
      }
    },

    requireConfig() {
      if (!this.canChangeMode && !this.canChangeTrust) {
        throw new SecurityError('Configuration changes not allowed', {
          reason: 'insufficient_role',
          role,
          required: 'owner',
        });
      }
    },

    requireFileAccess(filePath: string) {
      if (!filePath || typeof filePath !== 'string') {
        throw new SecurityError('Invalid file path', {
          reason: 'invalid_input',
          filePath: String(filePath),
        });
      }

      // Normalize and sanitize path
      const normalizedPath = filePath
        .replace(/\\/g, '/') // Convert backslashes to forward slashes
        .replace(/\/+/g, '/') // Remove duplicate slashes  
        .replace(/\/\./g, '/') // Remove single dot segments
        .replace(/\/\.\.\//g, '/'); // Remove double dot segments (basic traversal prevention)

      // Additional security check for path traversal attempts
      if (normalizedPath.includes('../') || normalizedPath.includes('..\\') || normalizedPath.includes('..')) {
        throw new SecurityError('Path traversal attempt detected', {
          reason: 'path_traversal',
          filePath: normalizedPath,
          originalPath: filePath,
        });
      }

      // System directories (brain/, packages/, apps/, bin/)
      const systemDirs = ['brain/', 'packages/', 'apps/', 'bin/', 'scripts/'];
      const isSystemPath = systemDirs.some((dir) => normalizedPath.includes(dir));

      if (isSystemPath) {
        // System code requires the owner role
        if (!this.canEditSystemCode) {
          throw new SecurityError('Cannot edit system code', {
            reason: 'not_owner',
            role,
            username,
            filePath: normalizedPath,
            required: 'owner role',
          });
        }
        return; // Owner can edit system code
      }

      // Profile-specific paths (profiles/{username}/)
      if (normalizedPath.includes('profiles/')) {
        const profileMatch = normalizedPath.match(/profiles\/([^/]+)\//);
        if (profileMatch) {
          const targetUsername = profileMatch[1];

          // Check if user is accessing their own profile
          if (targetUsername === username) {
            if (!this.canEditOwnProfile) {
              throw new SecurityError('Cannot edit own profile', {
                reason: 'insufficient_permissions',
                role,
                username,
                filePath: normalizedPath,
              });
            }
            return; // User can edit their own profile
          }

          // Accessing another user's profile requires the owner role
          if (!this.canAccessAllProfiles) {
            throw new SecurityError('Cannot access other user profiles', {
              reason: 'not_owner',
              role,
              username,
              targetUsername,
              filePath: normalizedPath,
              required: 'owner role',
            });
          }
          return; // Owner can access any profile
        }
      }

      // Docs directory - check canWriteDocs
      if (normalizedPath.includes('/docs/') || normalizedPath.endsWith('/docs')) {
        if (!this.canWriteDocs) {
          throw new SecurityError('Cannot edit documentation', {
            reason: 'docs_readonly',
            role,
            username,
            filePath: normalizedPath,
            required: 'owner role',
          });
        }
        return; // Owner can edit docs
      }

      // Root-level files - owner only for safety
      if (!this.canEditSystemCode) {
        throw new SecurityError('Cannot edit root-level files', {
          reason: 'not_owner',
          role,
          username,
          filePath: normalizedPath,
          required: 'owner role',
        });
      }
    },

    requireProfileRead(targetUsername: string) {
      if (!targetUsername || typeof targetUsername !== 'string') {
        throw new SecurityError('Invalid username', {
          reason: 'invalid_input',
          targetUsername: String(targetUsername),
        });
      }
      
      if (!this.canReadProfile(targetUsername)) {
        throw new SecurityError('Cannot read profile', {
          reason: 'insufficient_permissions',
          role,
          username,
          targetUsername,
          required: role === 'guest' ? 'owner or standard role' : 'profile ownership or owner role',
        });
      }
    },

    requireProfileWrite(targetUsername: string) {
      if (!targetUsername || typeof targetUsername !== 'string') {
        throw new SecurityError('Invalid username', {
          reason: 'invalid_input',
          targetUsername: String(targetUsername),
        });
      }
      
      if (!this.canWriteProfile(targetUsername)) {
        throw new SecurityError('Cannot write to profile', {
          reason: 'insufficient_permissions',
          role,
          username,
          targetUsername,
          required: role === 'guest' ? 'owner or standard role' : 'profile ownership or owner role',
        });
      }
    },
  };

  return policy;
}

/**
 * Extract session info from request context
 *
 * Reads session cookie from Astro context and validates it.
 * Returns SessionInfo with role and user ID, or null if no valid session.
 * NO ANONYMOUS ACCESS - null means authentication required.
 */
function extractSession(context?: RequestContext): SessionInfo | null {
  console.log(`${LOG_PREFIX} extractSession called`);

  if (context?.username) {
    const user = getUserByUsername(context.username);
    const role = context.role ?? user?.role ?? 'guest';
    const username = user?.username ?? context.username;

    return {
      role,
      id: context.userId ?? user?.id ?? context.sessionId,
      email: user?.metadata?.email,
      username,
    };
  }
  
  // Try to get session cookie from Astro context
  const sessionCookie = context?.cookies?.get('mh_session');

  if (!sessionCookie) {
    console.log(`${LOG_PREFIX} No session cookie found`);
    // No cookie = authentication required
    return null;
  }

  // Validate session
  let session;
  try {
    session = validateSession(sessionCookie.value);
  } catch (error) {
    console.error(`${LOG_PREFIX} Session validation failed:`, error);
    return null;
  }

  if (!session) {
    console.log(`${LOG_PREFIX} Session validation returned null - invalid/expired`);
    // Invalid/expired session = authentication required
    return null;
  }

  // Get user details
  let user;
  try {
    user = getUser(session.userId);
  } catch (error) {
    console.error(`${LOG_PREFIX} User lookup failed for session:`, session.userId, error);
    return null;
  }

  const username = user?.username;

  // Return session info
  const sessionInfo = {
    role: session.role,
    id: session.userId,
    email: user?.metadata?.email,
    username,
  };
  
  console.log(`${LOG_PREFIX} Session extracted successfully for user: ${username}, role: ${session.role}`);
  return sessionInfo;
}

// Request-scoped cache to avoid recomputing policy multiple times per request
const REQUEST_POLICY_CACHE = new WeakMap<RequestContext, SecurityPolicy>();

/**
 * Get security policy for current request
 *
 * This is the main entry point. Call this from middleware or route handlers.
 *
 * @param context - Optional request context (HTTP request object)
 * @returns SecurityPolicy with all permission flags and helper methods
 *
 * @example
 * // In API route
 * const policy = getSecurityPolicy(context);
 * policy.requireWrite(); // Throws if not allowed
 *
 * // In operator agent
 * const policy = getSecurityPolicy(); // No context = use current global mode
 */
export function getSecurityPolicy(context?: RequestContext): SecurityPolicy {
  console.log(`${LOG_PREFIX} ========== getSecurityPolicy CALLED ==========`);
  console.log(`${LOG_PREFIX} Input: hasContext=${!!context}`);

  // If context provided, check cache
  if (context && REQUEST_POLICY_CACHE.has(context)) {
    console.log(`${LOG_PREFIX} Returning cached policy`);
    return REQUEST_POLICY_CACHE.get(context)!;
  }

  // PRIORITY 1: Try to get user context from AsyncLocalStorage (set by graph pipeline)
  // This allows skills executed from graph nodes to access authenticated user info
  let session: SessionInfo | null = null;
  try {
    const userContext = getUserContext();
    if (userContext) {
      session = {
        role: userContext.role,
        id: userContext.userId,
        username: userContext.username,
      };
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to get user context:`, error);
    // Continue without user context - will fall back to HTTP session extraction
  }

  // PRIORITY 2: Extract session from HTTP request (if no AsyncLocalStorage context)
  if (!session) {
    console.log(`${LOG_PREFIX} No user context found, extracting from HTTP session`);
    session = extractSession(context);
  } else {
    console.log(`${LOG_PREFIX} Using AsyncLocalStorage session for user: ${session.username}`);
  }

  // Load current cognitive mode from file system
  let mode: CognitiveModeId = 'dual';
  try {
    const cogModeConfig = loadCognitiveMode();
    mode = cogModeConfig.currentMode;
  } catch (error) {
    // If no user context (e.g., system bootstrap), fall back safely to emulation
    if (!session) {
      mode = 'emulation';
    } else {
      throw error;
    }
  }

  // SECURITY: Guests get emulation mode only (read-only access)
  if (session?.role === 'guest') {
    console.log(`${LOG_PREFIX} Guest user detected, forcing emulation mode`);
    mode = 'emulation';
  }

  // Compute policy
  const policy = computeSecurityPolicy(mode, session);

  console.log(`${LOG_PREFIX} Policy computed for user: ${policy.username}, role: ${policy.role}, mode: ${policy.mode}`);
  console.log(`${LOG_PREFIX} Key permissions: read=${policy.canReadMemory}, write=${policy.canWriteMemory}, operator=${policy.canUseOperator}, owner=${policy.role === 'owner'}`);

  // Cache if we have context
  if (context) {
    REQUEST_POLICY_CACHE.set(context, policy);
  }

  return policy;
}

/**
 * Check if a specific permission is granted
 *
 * Utility function for when you just need a boolean check
 */
export function checkPermission(
  permission: keyof Pick<
    SecurityPolicy,
    | 'canReadMemory'
    | 'canWriteMemory'
    | 'canUseOperator'
    | 'canChangeMode'
    | 'canChangeTrust'
    | 'canAccessTraining'
    | 'canFactoryReset'
  >,
  context?: RequestContext
): boolean {
  const policy = getSecurityPolicy(context);
  return policy[permission];
}

/**
 * Get permission summary for debugging/display
 */
export function getPermissionSummary(context?: RequestContext): Record<string, boolean> {
  const policy = getSecurityPolicy(context);
  return {
    canReadMemory: policy.canReadMemory,
    canWriteMemory: policy.canWriteMemory,
    canUseOperator: policy.canUseOperator,
    canChangeMode: policy.canChangeMode,
    canChangeTrust: policy.canChangeTrust,
    canAccessTraining: policy.canAccessTraining,
    canFactoryReset: policy.canFactoryReset,
  };
}
