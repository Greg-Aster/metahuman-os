import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../../packages/core/src/sessions.js';
import { getUser, updatePassword, verifyUserPassword } from '../../../../../../packages/core/src/users.js';

/**
 * POST /api/auth/change-password
 *
 * Change the current user's password
 */
export const POST: APIRoute = async (context) => {
  try {
    // Get session
    const sessionCookie = context.cookies.get('mh_session');

    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = validateSession(sessionCookie.value);

    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get current user
    const user = getUser(session.userId);

    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get passwords from body
    const body = await context.request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return new Response(
        JSON.stringify({ success: false, error: 'Current and new passwords are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify current password
    if (!verifyUserPassword(user.username, currentPassword)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Current password is incorrect' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update password
    updatePassword(user.id, newPassword);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[change-password] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to change password',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
