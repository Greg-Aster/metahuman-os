import type { APIRoute } from 'astro';
import { createSession } from '@metahuman/core/sessions';
import { audit } from '@metahuman/core/audit';

/**
 * POST /api/auth/guest
 *
 * Creates an anonymous session for guest browsing
 */
export const POST: APIRoute = async (context) => {
  try {
    // Create anonymous session (30 min expiry via session system)
    const session = createSession('anonymous', 'anonymous');

    // Set session cookie
    // Use sameSite: 'none' for cross-origin requests (mobile app)
    context.cookies.set('mh_session', session.id, {
      httpOnly: true,
      sameSite: 'none', // Required for cross-origin (mobile app)
      secure: true, // Required when sameSite is 'none'
      path: '/',
      maxAge: 30 * 60, // 30 minutes
    });

    audit({
      level: 'info',
      category: 'security',
      event: 'guest_session_created',
      actor: 'anonymous',
      details: { sessionId: session.id },
    });

    return new Response(
      JSON.stringify({
        success: true,
        session: {
          id: session.id,
          role: 'anonymous',
          expiresAt: session.expiresAt,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[auth/guest] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to create guest session',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
