/**
 * POST /api/profiles/delete
 *
 * Delete a user profile (owner-only operation)
 *
 * Performs cascading deletion:
 * 1. Deletes all active sessions for the user
 * 2. Removes user record from persona/users.json
 * 3. Recursively deletes profiles/<username>/ directory
 *
 * Security:
 * - Owner-only (role check)
 * - Cannot delete owner account
 * - Cannot delete your own account while logged in
 * - Cannot delete the guest profile
 * - Requires confirmation (confirmUsername field)
 *
 * Request body:
 * {
 *   "username": "john-doe",
 *   "confirmUsername": "john-doe"  // Must match username
 * }
 */

import type { APIRoute } from 'astro';
import { validateSession } from '@metahuman/core/sessions';
import { deleteProfileComplete } from '@metahuman/core/profile';
import { getUser } from '@metahuman/core/users';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Step 1: Validate authentication
    const sessionCookie = cookies?.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const session = validateSession(sessionCookie.value);
    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired session' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const sessionUser = getUser(session.userId);
    if (!sessionUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const isOwner = session.role === 'owner';

    // Step 2: Permission check (owners can delete anyone; standard users can delete themselves)
    const body = await request.json();
    const { username, confirmUsername } = body;

    const isSelfDelete =
      session.role === 'standard' && sessionUser.username === username;

    if (!isOwner && !isSelfDelete) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner permission required to delete other profiles',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 3: Parse request body (already read above)

    // Step 4: Validate request parameters
    if (!username || typeof username !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request: username is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (confirmUsername !== username) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Confirmation username does not match',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 5: Perform deletion with full cascading cleanup
    const actor = isOwner
      ? `${session.userId} (owner)`
      : `${session.userId} (self-delete)`;
    const result = await deleteProfileComplete(username, session.userId, actor);

    // Step 6: Return result
    if (result.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Profile '${username}' deleted successfully`,
          details: {
            username: result.username,
            sessionsDeleted: result.sessionsDeleted,
            userDeleted: result.userDeleted,
            profileDeleted: result.profileDeleted,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error || 'Profile deletion failed',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('[profiles/delete] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to delete profile',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
