/**
 * Profile Path API
 *
 * GET: Get profile path and encryption status
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getProfilePaths,
} from '@metahuman/core';
import {
  isProfileEncrypted,
  loadEncryptionMeta,
} from '@metahuman/core/encryption';

/**
 * GET /api/profile-path
 *
 * Returns profile path and encryption status
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const encrypted = isProfileEncrypted(profilePaths.root);
    const meta = encrypted ? loadEncryptionMeta(profilePaths.root) : null;

    return new Response(
      JSON.stringify({
        path: profilePaths.root,
        isEncrypted: encrypted,
        passwordMode: meta?.passwordMode || null,
        encryptionInfo: meta
          ? {
              algorithm: meta.algorithm,
              createdAt: meta.createdAt,
              encryptedFiles: meta.encryptedFiles,
              passwordMode: meta.passwordMode || 'separate',
            }
          : null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if ((error as Error).message?.includes('Not authenticated')) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }
};
