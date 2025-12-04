import type { APIRoute } from 'astro';
import { authenticateUser, getProfileStorageConfig } from '@metahuman/core/users';
import { createSession } from '@metahuman/core/sessions';
import { audit, unlockProfile } from '@metahuman/core';

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
    // Use sameSite: 'none' for cross-origin requests (mobile app)
    // This requires secure: true (HTTPS)
    context.cookies.set('mh_session', session.id, {
      httpOnly: true,
      sameSite: 'none', // Required for cross-origin (mobile app)
      secure: true, // Required when sameSite is 'none'
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    // Auto-unlock encrypted storage if using login password
    let encryptionUnlocked = false;
    let encryptionError: string | undefined;

    try {
      const storageConfig = getProfileStorageConfig(user.username);
      const encType = storageConfig?.encryption?.type;
      const useLoginPassword = storageConfig?.encryption?.useLoginPassword;

      // Auto-unlock for LUKS or AES-256 when using login password
      if ((encType === 'luks' || encType === 'aes256') && useLoginPassword) {
        const unlockResult = await unlockProfile(user.id, password);
        encryptionUnlocked = unlockResult.success;
        if (!unlockResult.success) {
          encryptionError = unlockResult.error;
          console.warn('[auth/login] Failed to auto-unlock encrypted storage:', unlockResult.error);
        } else {
          audit({
            level: 'info',
            category: 'security',
            event: 'encryption_auto_unlocked',
            details: {
              userId: user.id,
              username: user.username,
              encryptionType: encType,
            },
            actor: user.id,
          });
        }
      }
    } catch (unlockError) {
      console.error('[auth/login] Error during auto-unlock:', unlockError);
      encryptionError = (unlockError as Error).message;
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'user_logged_in',
      details: {
        userId: user.id,
        username: user.username,
        role: user.role,
        sessionId: session.id,
        encryptionUnlocked,
        encryptionError,
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
