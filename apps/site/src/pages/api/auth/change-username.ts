import type { APIRoute } from 'astro';
import { validateSession } from '../../../../../../packages/core/src/sessions.js';
import { getUser, updateUsername } from '../../../../../../packages/core/src/users.js';

/**
 * POST /api/auth/change-username
 *
 * Change the current user's username
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

    // Get new username from body
    const body = await context.request.json();
    const { newUsername } = body;

    if (!newUsername || typeof newUsername !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'New username is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update username
    updateUsername(user.id, newUsername);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[change-username] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to change username',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
