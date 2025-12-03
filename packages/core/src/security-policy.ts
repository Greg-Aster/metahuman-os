import {
  loadCognitiveMode,
  canWriteMemory,
  canUseOperator,
  type CognitiveModeId,
} from './cognitive-mode.js';
import { validateSession } from './sessions.js';
import { getUser } from './users.js';
import { getUserContext } from './context.js';

/**
 * User role types for access control
 *
 * - owner: Full system access (legacy role, maps to admin)
 * - standard: Full access to own profile, read-only docs
 * - guest: Read-only access to docs and shared content
 * - anonymous: Unauthenticated users (read-only, emulation mode only)
 */
export type UserRole = 'owner' | 'standard' | 'guest' | 'anonymous';

/**
 * Check if a user has administrator privileges
 * Administrators can edit system code and access all profiles
 *
 * NOTE: Admin privileges are granted to users with 'owner' role.
 * The ADMIN_USERS environment variable is deprecated and no longer used.
 */
export function isAdministrator(username?: string, role?: UserRole): boolean {
  if (!username) return false;

  // Owner role automatically grants admin privileges
  if (role === 'owner') return true;

  // Legacy ADMIN_USERS support (deprecated, but kept for backward compatibility)
  // This will be removed in a future version
  const adminUsers = process.env.ADMIN_USERS || '';
  if (adminUsers) {
    const adminList = adminUsers
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (adminList.includes(username)) {
      console.warn(`[Security] ADMIN_USERS is deprecated. User '${username}' should have 'owner' role instead.`);
      return true;
    }
  }

  return false;
}

/**
 * Session information extracted from request context
 */
export interface SessionInfo {
  role: UserRole;
  id?: string;
  email?: string;
  username?: string;
  isAdmin?: boolean;
}

/**
 * Security policy details for error responses
 */
export interface SecurityErrorDetails {
  reason: string;
  currentMode?: CognitiveModeId;
  role?: UserRole;
  required?: string;
  [key: string]: any;
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
  isAdmin: boolean;

  // Helper methods that throw SecurityError if not allowed
  requireWrite(): void;
  requireOperator(): void;
  requireOwner(): void;
  requireConfig(): void;
  requireAdmin(): void;
  requireFileAccess(filePath: string): void;
  requireProfileRead(targetUsername: string): void;
  requireProfileWrite(targetUsername: string): void;
}

/**
 * Compute security policy based on cognitive mode and session
 *
 * This is the core permission resolution logic.
 */
function computeSecurityPolicy(
  mode: CognitiveModeId,
  session: SessionInfo | null
): SecurityPolicy {
  const role = session?.role ?? 'anonymous';
  const username = session?.username;
  const isAdmin = session?.isAdmin ?? false;

  // Determine permissions based on mode + role + admin status
  const policy: SecurityPolicy = {
    // Memory reads: authenticated users only (not anonymous or guest)
    // Guests should only chat, not access personal data
    canReadMemory: role !== 'anonymous' && role !== 'guest',

    // Memory writes: any authenticated user (not anonymous or guest)
    // NOTE: Changed to save memories in ALL modes (dual, agent, emulation) when logged in
    // The cognitiveMode is saved in metadata for LoRA training differentiation
    canWriteMemory: role !== 'anonymous' && role !== 'guest',

    // Operator: dual or agent mode AND authenticated user (owner or standard, not guest/anonymous, not emulation)
    canUseOperator: canUseOperator(mode) && (role === 'owner' || role === 'standard'),

    // Mode changes: authenticated users (not guests or anonymous)
    // Users should be able to control their own cognitive mode
    canChangeMode: role === 'owner' || role === 'standard',

    // Trust changes: owner only
    canChangeTrust: role === 'owner',

    // Training: not emulation AND owner only
    canAccessTraining: mode !== 'emulation' && role === 'owner',

    // Factory reset: owner only
    canFactoryReset: role === 'owner',

    // Multi-user permissions
    // System code editing: administrators only
    canEditSystemCode: isAdmin,

    // Access all profiles: administrators only
    canAccessAllProfiles: isAdmin,

    // Edit own profile: any authenticated user (not anonymous or guest)
    canEditOwnProfile: role !== 'anonymous' && role !== 'guest',

    // Path-based permissions (new tier system)
    // Docs: everyone can read, only admins can write
    canReadDocs: true, // All users (including anonymous) can read docs
    canWriteDocs: isAdmin,

    // Profile access: function-based checks
    canReadProfile: (targetUsername: string) => {
      if (isAdmin) return true; // Admins can read all profiles
      if (role === 'anonymous' || role === 'guest') return false; // Guests/anonymous cannot read profiles
      return targetUsername === username; // Standard users can read own profile
    },

    canWriteProfile: (targetUsername: string) => {
      if (isAdmin) return true; // Admins can write all profiles
      if (role === 'anonymous' || role === 'guest') return false; // Guests/anonymous cannot write
      if (role === 'standard') return targetUsername === username; // Standard users can write own profile
      return targetUsername === username; // Owners can write own profile
    },

    // System configs: admin or owner only
    canAccessSystemConfigs: isAdmin || role === 'owner',

    // Context
    role,
    mode,
    sessionId: session?.id,
    username,
    isAdmin,

    // Helper methods
    requireWrite() {
      if (!this.canWriteMemory) {
        throw new SecurityError('Write operations not allowed', {
          reason:
            role === 'anonymous'
              ? 'anonymous_user'
              : role === 'guest'
              ? 'guest_user'
              : 'unknown',
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

    requireAdmin() {
      if (!this.canEditSystemCode) {
        throw new SecurityError('Administrator privileges required', {
          reason: 'not_administrator',
          role,
          username,
          required: 'admin privileges (owner role)',
        });
      }
    },

    requireFileAccess(filePath: string) {
      const normalizedPath = filePath.replace(/\\/g, '/');

      // System directories (brain/, packages/, apps/, bin/)
      const systemDirs = ['brain/', 'packages/', 'apps/', 'bin/', 'scripts/'];
      const isSystemPath = systemDirs.some((dir) => normalizedPath.includes(dir));

      if (isSystemPath) {
        // System code requires admin privileges
        if (!this.canEditSystemCode) {
          throw new SecurityError('Cannot edit system code', {
            reason: 'not_administrator',
            role,
            username,
            filePath: normalizedPath,
            required: 'admin privileges (owner role)',
          });
        }
        return; // Admin can edit anything
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

          // Accessing another user's profile requires admin
          if (!this.canAccessAllProfiles) {
            throw new SecurityError('Cannot access other user profiles', {
              reason: 'not_administrator',
              role,
              username,
              targetUsername,
              filePath: normalizedPath,
              required: 'admin privileges (owner role)',
            });
          }
          return; // Admin can access any profile
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
            required: 'admin privileges',
          });
        }
        return; // Admin can edit docs
      }

      // Root-level files - admin only for safety
      if (!this.canEditSystemCode) {
        throw new SecurityError('Cannot edit root-level files', {
          reason: 'not_administrator',
          role,
          username,
          filePath: normalizedPath,
          required: 'admin privileges (owner role)',
        });
      }
    },

    requireProfileRead(targetUsername: string) {
      if (!this.canReadProfile(targetUsername)) {
        throw new SecurityError('Cannot read profile', {
          reason: 'insufficient_permissions',
          role,
          username,
          targetUsername,
          required: role === 'anonymous' ? 'authentication' : 'profile ownership or admin',
        });
      }
    },

    requireProfileWrite(targetUsername: string) {
      if (!this.canWriteProfile(targetUsername)) {
        throw new SecurityError('Cannot write to profile', {
          reason: 'insufficient_permissions',
          role,
          username,
          targetUsername,
          required: role === 'anonymous' ? 'authentication' : role === 'guest' ? 'standard user role' : 'profile ownership or admin',
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
 * Returns SessionInfo with role and user ID, or null for anonymous.
 */
function extractSession(context?: any): SessionInfo | null {
  // Try to get session cookie from Astro context
  const sessionCookie = context?.cookies?.get('mh_session');

  if (!sessionCookie) {
    // No cookie = anonymous user
    return {
      role: 'anonymous',
      id: undefined,
    };
  }

  // Validate session
  const session = validateSession(sessionCookie.value);

  if (!session) {
    // Invalid/expired session = anonymous
    return {
      role: 'anonymous',
      id: undefined,
    };
  }

  // Get user details
  const user = getUser(session.userId);

  // Check if user is administrator
  // Owner role automatically grants admin privileges
  const username = user?.username;
  const isAdmin = isAdministrator(username, session.role);

  // Return session info
  return {
    role: session.role,
    id: session.userId,
    email: user?.metadata?.email,
    username,
    isAdmin,
  };
}

// Request-scoped cache to avoid recomputing policy multiple times per request
const REQUEST_POLICY_CACHE = new WeakMap<any, SecurityPolicy>();

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
export function getSecurityPolicy(context?: any): SecurityPolicy {
  // If context provided, check cache
  if (context && REQUEST_POLICY_CACHE.has(context)) {
    return REQUEST_POLICY_CACHE.get(context)!;
  }

  // PRIORITY 1: Try to get user context from AsyncLocalStorage (set by graph pipeline)
  // This allows skills executed from graph nodes to access authenticated user info
  let session: SessionInfo | null = null;
  const userContext = getUserContext();
  if (userContext && userContext.role !== 'anonymous') {
    session = {
      role: userContext.role,
      id: userContext.userId,
      username: userContext.username,
      isAdmin: isAdministrator(userContext.username, userContext.role),
    };
  }

  // PRIORITY 2: Extract session from HTTP request (if no AsyncLocalStorage context)
  if (!session) {
    session = extractSession(context);
  }

  // Load current cognitive mode from file system
  let mode: CognitiveModeId = 'dual';
  try {
    const cogModeConfig = loadCognitiveMode();
    mode = cogModeConfig.currentMode;
  } catch (error) {
    // If no user context (e.g., anonymous or system bootstrap), fall back safely
    if (!session || session.role === 'anonymous') {
      mode = 'emulation';
    } else {
      throw error;
    }
  }

  // SECURITY: Override to emulation mode for anonymous users
  // Anonymous users should never have access to dual or agent modes
  if (session?.role === 'anonymous') {
    mode = 'emulation';
  }

  // Compute policy
  const policy = computeSecurityPolicy(mode, session);

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
  context?: any
): boolean {
  const policy = getSecurityPolicy(context);
  return policy[permission];
}

/**
 * Get permission summary for debugging/display
 */
export function getPermissionSummary(context?: any): Record<string, boolean> {
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
