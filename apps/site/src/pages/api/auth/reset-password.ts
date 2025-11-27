import type { APIRoute } from 'astro';
import { verifyRecoveryCode } from '@metahuman/core/recovery-codes';
import { updatePassword, getUserByUsername } from '@metahuman/core/users';
import { auditSecurity } from '@metahuman/core/audit';

/**
 * POST /api/auth/reset-password
 *
 * Reset password using recovery code
 * Body: { username, recoveryCode, newPassword }
 */
export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const { username, recoveryCode, newPassword } = body;

    // Validate input
    if (!username || !recoveryCode || !newPassword) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username, recovery code, and new password are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify user exists
    const user = getUserByUsername(username);
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid credentials' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify recovery code
    if (!verifyRecoveryCode(username, recoveryCode)) {
      auditSecurity({
        actor: username,
        event: 'password_reset_failed',
        details: { reason: 'invalid_recovery_code' },
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid or already-used recovery code',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate new password
    if (newPassword.length < 4) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Password must be at least 4 characters',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update password
    updatePassword(user.id, newPassword);

    // Audit the reset
    auditSecurity({
      actor: username,
      event: 'password_reset_success',
      details: { method: 'recovery_code' },
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Password reset successfully' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[reset-password] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset password',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
