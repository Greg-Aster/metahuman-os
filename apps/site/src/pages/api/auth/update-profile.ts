import type { APIRoute } from 'astro';
import { validateSession } from '@metahuman/core/sessions';
import { getUser, updateUserMetadata } from '@metahuman/core/users';

/**
 * POST /api/auth/update-profile
 *
 * Update the current user's profile (display name, email)
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

    // Get profile data from body
    const body = await context.request.json();
    const { displayName, email } = body;

    // Update metadata
    updateUserMetadata(user.id, {
      displayName: displayName || undefined,
      email: email || undefined,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[update-profile] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update profile',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
