import type { APIRoute } from 'astro';
import { deleteSession } from '@metahuman/core/sessions';
import { audit } from '@metahuman/core/audit';

/**
 * POST /api/auth/logout
 *
 * Delete session and clear cookie
 */
export const POST: APIRoute = async (context) => {
  try {
    // Get session cookie
    const sessionCookie = context.cookies.get('mh_session');

    if (sessionCookie) {
      // Delete session
      const deleted = deleteSession(sessionCookie.value);

      if (deleted) {
        audit({
          level: 'info',
          category: 'security',
          event: 'user_logged_out',
          details: { sessionId: sessionCookie.value },
          actor: 'user',
        });
      }
    }

    // Clear cookie
    context.cookies.delete('mh_session', {
      path: '/',
    });

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[auth/logout] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Logout failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
