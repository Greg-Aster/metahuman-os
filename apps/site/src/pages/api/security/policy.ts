import type { APIRoute } from 'astro';
import { getSecurityPolicy, getPermissionSummary } from '@metahuman/core/security-policy';

/**
 * Get current security policy for the UI
 *
 * Returns all permission flags so UI can reactively show/hide features
 *
 * NOTE: This endpoint is safe for anonymous users - it returns restricted
 * permissions that block all write operations.
 */
export const GET: APIRoute = async (context) => {
  try {
    const policy = getSecurityPolicy(context);
    const permissions = getPermissionSummary(context);

    return new Response(
      JSON.stringify({
        success: true,
        policy: {
          // Permission flags
          ...permissions,

          // Context
          role: policy.role,
          mode: policy.mode,
          sessionId: policy.sessionId,

          // Computed helpers for UI
          isReadOnly: !policy.canWriteMemory,
          isOwner: policy.role === 'owner',
          isGuest: policy.role === 'guest',
          isAnonymous: policy.role === 'anonymous',
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store', // Don't cache, policy can change
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
