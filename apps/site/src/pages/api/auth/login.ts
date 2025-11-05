import type { APIRoute } from 'astro';
import { authenticateUser } from '@metahuman/core/users';
import { createSession } from '@metahuman/core/sessions';
import { audit } from '@metahuman/core/audit';

/**
 * POST /api/auth/login
 *
 * Authenticate user and create session
 */
export const POST: APIRoute = async (context) => {
  try {
    // Parse request body
    const body = await context.request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username and password are required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Authenticate user
    const user = authenticateUser(username, password);

    if (!user) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid username or password',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Create session
    const session = createSession(user.id, user.role, {
      userAgent: context.request.headers.get('user-agent') || undefined,
      ip: context.clientAddress || undefined,
    });

    // Set session cookie
    context.cookies.set('mh_session', session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: context.url.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    audit({
      level: 'info',
      category: 'security',
      event: 'user_logged_in',
      details: {
        userId: user.id,
        username: user.username,
        role: user.role,
        sessionId: session.id,
      },
      actor: user.id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          metadata: user.metadata,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[auth/login] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Login failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
