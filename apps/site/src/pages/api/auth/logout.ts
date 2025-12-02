import type { APIRoute } from 'astro';
import { getSession, deleteSession } from '@metahuman/core/sessions';
import { getProfileStorageConfig, getUser } from '@metahuman/core/users';
import { audit, lockProfile } from '@metahuman/core';

/**
 * POST /api/auth/logout
 *
 * Delete session, lock encrypted storage, and clear cookie
 */
export const POST: APIRoute = async (context) => {
  try {
    // Get session cookie
    const sessionCookie = context.cookies.get('mh_session');
    let userId: string | undefined;
    let username: string | undefined;

    if (sessionCookie) {
      // Get session info before deleting
      const session = getSession(sessionCookie.value);
      if (session) {
        userId = session.userId;

        // Get user to find username
        const user = getUser(userId);
        username = user?.username;

        // Auto-lock encrypted storage if using login password
        if (username) {
          try {
            const storageConfig = getProfileStorageConfig(username);
            const encType = storageConfig?.encryption?.type;
            const useLoginPassword = storageConfig?.encryption?.useLoginPassword;

            // Auto-lock for LUKS or AES-256 when using login password
            if ((encType === 'luks' || encType === 'aes256') && useLoginPassword) {
              const lockResult = await lockProfile(userId);
              if (lockResult.success) {
                audit({
                  level: 'info',
                  category: 'security',
                  event: 'encryption_auto_locked',
                  details: {
                    userId,
                    username,
                    encryptionType: encType,
                  },
                  actor: userId,
                });
              } else {
                console.warn('[auth/logout] Failed to auto-lock encrypted storage:', lockResult.error);
              }
            }
          } catch (lockError) {
            console.error('[auth/logout] Error during auto-lock:', lockError);
          }
        }
      }

      // Delete session
      const deleted = deleteSession(sessionCookie.value);

      if (deleted) {
        audit({
          level: 'info',
          category: 'security',
          event: 'user_logged_out',
          details: { sessionId: sessionCookie.value, userId, username },
          actor: userId || 'user',
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
