import type { APIRoute } from 'astro';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';

/**
 * GET /api/auth/me
 *
 * Get current user from session
 */
export const GET: APIRoute = async (context) => {
  try {
    // Get session cookie
    const sessionCookie = context.cookies.get('mh_session');

    if (!sessionCookie) {
      // No session = anonymous
      return new Response(
        JSON.stringify({
          success: true,
          user: null,
          role: 'anonymous',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate session
    const session = validateSession(sessionCookie.value);

    if (!session) {
      // Invalid/expired session = anonymous
      return new Response(
        JSON.stringify({
          success: true,
          user: null,
          role: 'anonymous',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Handle anonymous sessions
    if (session.role === 'anonymous') {
      const activeProfile = session.metadata?.activeProfile;
      const sourceProfile = session.metadata?.sourceProfile;

      if (activeProfile && sourceProfile) {
        // Guest has selected a public profile - return virtual user
        return new Response(
          JSON.stringify({
            success: true,
            user: {
              id: session.userId,
              username: 'anonymous',
              role: 'anonymous',
              metadata: {
                displayName: `Guest viewing ${sourceProfile}`,
                activeProfile: activeProfile,
                sourceProfile: sourceProfile,
              },
            },
            role: 'anonymous',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } else {
        // Anonymous without profile - not authenticated
        return new Response(
          JSON.stringify({
            success: true,
            user: null,
            role: 'anonymous',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Get user for authenticated sessions
    const user = getUser(session.userId);

    if (!user) {
      // User not found (shouldn't happen)
      return new Response(
        JSON.stringify({
          success: true,
          user: null,
          role: 'anonymous',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          metadata: user.metadata,
          lastLogin: user.lastLogin,
        },
        role: user.role,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[auth/me] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to get user info',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
