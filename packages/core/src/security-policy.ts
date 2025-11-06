import {
  loadCognitiveMode,
  canWriteMemory,
  canUseOperator,
  type CognitiveModeId,
} from './cognitive-mode.js';
import { validateSession } from './sessions.js';
import { getUser } from './users.js';

/**
 * User role types for access control
 */
export type UserRole = 'owner' | 'guest' | 'anonymous';

/**
 * Session information extracted from request context
 */
export interface SessionInfo {
  role: UserRole;
  id?: string;
  email?: string;
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

  // Context
  role: UserRole;
  mode: CognitiveModeId;
  sessionId?: string;

  // Helper methods that throw SecurityError if not allowed
  requireWrite(): void;
  requireOperator(): void;
  requireOwner(): void;
  requireConfig(): void;
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

  // Determine permissions based on mode + role
  const policy: SecurityPolicy = {
    // Memory reads: any authenticated user (not anonymous)
    canReadMemory: role !== 'anonymous',

    // Memory writes: mode allows writes AND user is not a guest
    canWriteMemory: canWriteMemory(mode) && role !== 'guest',

    // Operator: dual or agent mode AND owner only (not emulation)
    canUseOperator: canUseOperator(mode) && role === 'owner',

    // Mode changes: owner only (regardless of current mode)
    canChangeMode: role === 'owner',

    // Trust changes: owner only
    canChangeTrust: role === 'owner',

    // Training: not emulation AND owner only
    canAccessTraining: mode !== 'emulation' && role === 'owner',

    // Factory reset: owner only
    canFactoryReset: role === 'owner',

    // Context
    role,
    mode,
    sessionId: session?.id,

    // Helper methods
    requireWrite() {
      if (!this.canWriteMemory) {
        throw new SecurityError('Write operations not allowed', {
          reason:
            role === 'guest'
              ? 'guest_user'
              : !canWriteMemory(mode)
              ? 'read_only_mode'
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
            role !== 'owner'
              ? 'insufficient_role'
              : !canUseOperator(mode)
              ? 'operator_disabled_in_mode'
              : 'unknown',
          currentMode: mode,
          role,
          required: 'owner role in dual mode',
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

  // Return session info
  return {
    role: session.role,
    id: session.userId,
    email: user?.metadata?.email,
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

  // Load current cognitive mode
  const cogModeConfig = loadCognitiveMode();
  const mode = cogModeConfig.currentMode;

  // Extract session (if available)
  const session = extractSession(context);

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
