import { getSecurityPolicy, SecurityError } from '@metahuman/core/security-policy';
import { audit } from '@metahuman/core';
import type { APIRoute, APIContext } from 'astro';

/**
 * Middleware to enforce write restrictions based on security policy
 *
 * Uses the unified policy layer that considers both cognitive mode and user role.
 *
 * Usage:
 *   export const POST = requireWriteMode(handler);
 */
export function requireWriteMode(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    try {
      const policy = getSecurityPolicy(context);
      policy.requireWrite(); // Throws SecurityError if not allowed

      // Write allowed, proceed with handler
      return await handler(context);
    } catch (error) {
      if (error instanceof SecurityError) {
        // Log security event
        audit({
          level: 'warn',
          category: 'security',
          event: 'write_attempt_blocked',
          details: {
            endpoint: context.url.pathname,
            method: context.request.method,
            ...error.details
          },
          actor: 'security_middleware'
        });

        return new Response(
          JSON.stringify({
            error: error.message,
            ...error.details,
            hint: error.details.reason === 'read_only_mode'
              ? 'Switch to dual or agent mode to enable write operations'
              : 'Insufficient permissions for this operation'
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'X-Security-Blocked': 'true'
            }
          }
        );
      }

      // Re-throw non-security errors
      throw error;
    }
  };
}

/**
 * Middleware to enforce operator access restrictions based on security policy
 *
 * Usage:
 *   export const POST = requireOperatorMode(handler);
 */
export function requireOperatorMode(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    try {
      const policy = getSecurityPolicy(context);
      policy.requireOperator(); // Throws SecurityError if not allowed

      // Operator allowed, proceed with handler
      return await handler(context);
    } catch (error) {
      if (error instanceof SecurityError) {
        // Log security event
        audit({
          level: 'warn',
          category: 'security',
          event: 'operator_access_blocked',
          details: {
            endpoint: context.url.pathname,
            ...error.details
          },
          actor: 'security_middleware'
        });

        return new Response(
          JSON.stringify({
            error: error.message,
            ...error.details,
            hint: 'Only owners in dual consciousness mode can access operator'
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'X-Security-Blocked': 'true'
            }
          }
        );
      }

      // Re-throw non-security errors
      throw error;
    }
  };
}

/**
 * Middleware to enforce training pipeline restrictions based on security policy
 *
 * Usage:
 *   export const POST = requireTrainingEnabled(handler);
 */
export function requireTrainingEnabled(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    try {
      const policy = getSecurityPolicy(context);

      if (!policy.canAccessTraining) {
        throw new SecurityError('Training operations not allowed', {
          reason: policy.mode === 'emulation' ? 'training_disabled_in_mode' : 'insufficient_role',
          currentMode: policy.mode,
          role: policy.role
        });
      }

      return await handler(context);
    } catch (error) {
      if (error instanceof SecurityError) {
        audit({
          level: 'warn',
          category: 'security',
          event: 'training_access_blocked',
          details: {
            endpoint: context.url.pathname,
            ...error.details
          },
          actor: 'security_middleware'
        });

        return new Response(
          JSON.stringify({
            error: error.message,
            ...error.details,
            hint: 'Training operations require owner role and non-emulation mode'
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Re-throw non-security errors
      throw error;
    }
  };
}

/**
 * Helper to audit configuration access attempts
 *
 * Logs all config changes for security monitoring.
 * Use with policy.requireOwner() or policy.requireConfig() for enforcement.
 *
 * Usage:
 *   auditConfigAccess(context, 'cognitive_mode_change');
 *   policy.requireOwner(); // Throws if not owner
 */
export function auditConfigAccess(
  context: APIContext,
  operation: string
): void {
  const policy = getSecurityPolicy(context);

  audit({
    level: 'warn',
    category: 'security',
    event: 'config_access_attempt',
    details: {
      operation,
      endpoint: context.url.pathname,
      role: policy.role,
      mode: policy.mode,
      sessionId: policy.sessionId
    },
    actor: policy.sessionId ?? 'anonymous'
  });
}

/**
 * Middleware to require owner role for configuration changes
 *
 * Usage:
 *   export const POST = requireOwner(handler);
 */
export function requireOwner(handler: APIRoute): APIRoute {
  return async (context: APIContext) => {
    try {
      const policy = getSecurityPolicy(context);
      policy.requireOwner(); // Throws SecurityError if not owner

      return await handler(context);
    } catch (error) {
      if (error instanceof SecurityError) {
        audit({
          level: 'warn',
          category: 'security',
          event: 'owner_access_denied',
          details: {
            endpoint: context.url.pathname,
            ...error.details
          },
          actor: 'security_middleware'
        });

        return new Response(
          JSON.stringify({
            error: error.message,
            ...error.details,
            hint: 'This operation requires owner authentication'
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              'X-Security-Blocked': 'true'
            }
          }
        );
      }

      // Re-throw non-security errors
      throw error;
    }
  };
}
