/**
 * Profile Decryption API
 *
 * POST: Decrypt encrypted profile data in-place
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getProfilePaths,
  audit,
} from '@metahuman/core';
import {
  deriveKeyFromMeta,
  decryptDirectory,
  loadEncryptionMeta,
  removeEncryptionMeta,
  removeVerificationFile,
  isProfileEncrypted,
  verifyPassword,
} from '@metahuman/core/encryption';
import { updateUserMetadata, verifyUserPassword } from '@metahuman/core/users';

/**
 * POST /api/profile-path/decrypt
 *
 * Decrypt encrypted profile data in-place
 *
 * Body:
 * - password: string - Decryption password
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body = await request.json();
    const { password } = body;

    // Validate inputs
    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if encrypted
    if (!isProfileEncrypted(profilePaths.root)) {
      return new Response(
        JSON.stringify({ error: 'Profile is not encrypted' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load encryption metadata
    const meta = loadEncryptionMeta(profilePaths.root);
    if (!meta) {
      return new Response(
        JSON.stringify({ error: 'Encryption metadata not found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // For 'user' mode, also verify it matches their login password
    const passwordMode = meta.passwordMode || 'separate'; // Default to separate for legacy
    if (passwordMode === 'user') {
      if (!verifyUserPassword(user.username, password)) {
        return new Response(
          JSON.stringify({ error: 'Password does not match your login password' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Derive key and verify against encryption verification file
    const key = deriveKeyFromMeta(password, meta);
    if (!verifyPassword(profilePaths.root, key)) {
      return new Response(
        JSON.stringify({ error: 'Invalid decryption password' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create SSE response for progress updates
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream({
      start(c) {
        controller = c;
      },
    });

    const sendProgress = (progress: {
      step: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      message: string;
      progress?: number;
      error?: string;
    }) => {
      try {
        const data = `data: ${JSON.stringify({ progress })}\n\n`;
        controller.enqueue(encoder.encode(data));
      } catch {
        // Stream may be closed
      }
    };

    const sendResult = (result: {
      success: boolean;
      filesProcessed?: number;
      error?: string;
    }) => {
      try {
        const data = `data: ${JSON.stringify({ result })}\n\n`;
        controller.enqueue(encoder.encode(data));
        controller.close();
      } catch {
        // Stream may be closed
      }
    };

    // Start decryption process
    (async () => {
      try {
        audit({
          level: 'info',
          category: 'security',
          event: 'profile_decryption_started',
          details: {
            userId: user.id,
            profilePath: profilePaths.root,
            passwordMode,
          },
          actor: user.id,
        });

        sendProgress({
          step: 'init',
          status: 'running',
          message: 'Verifying decryption key...',
        });

        sendProgress({
          step: 'init',
          status: 'completed',
          message: 'Decryption key verified',
        });

        sendProgress({
          step: 'decrypt',
          status: 'running',
          message: 'Decrypting profile data...',
          progress: 0,
        });

        // Decrypt all profile directories
        let totalDecrypted = 0;
        const dirsToDecrypt = ['memory', 'persona', 'etc'];

        for (const dir of dirsToDecrypt) {
          const dirPath = `${profilePaths.root}/${dir}`;
          try {
            const decrypted = await decryptDirectory(dirPath, key, {
              onProgress: (file, current, total) => {
                const dirProgress = (current / total) * 100;
                sendProgress({
                  step: 'decrypt',
                  status: 'running',
                  message: `Decrypting ${dir}... (${current}/${total})`,
                  progress: Math.round(dirProgress),
                });
              },
            });
            totalDecrypted += decrypted;
          } catch (error) {
            // Directory may not exist
            console.warn(`[decrypt] Skipping ${dir}:`, (error as Error).message);
          }
        }

        sendProgress({
          step: 'decrypt',
          status: 'completed',
          message: `Decrypted ${totalDecrypted} files`,
          progress: 100,
        });

        sendProgress({
          step: 'finalize',
          status: 'running',
          message: 'Removing encryption metadata...',
        });

        // Remove encryption metadata
        removeEncryptionMeta(profilePaths.root);
        removeVerificationFile(profilePaths.root);

        // Update user metadata to remove encryption info
        updateUserMetadata(user.id, {
          profileEncryption: null,
        });

        sendProgress({
          step: 'finalize',
          status: 'completed',
          message: 'Encryption metadata removed',
        });

        sendProgress({
          step: 'complete',
          status: 'completed',
          message: 'Profile decryption complete!',
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_decryption_completed',
          details: {
            userId: user.id,
            profilePath: profilePaths.root,
            filesDecrypted: totalDecrypted,
          },
          actor: user.id,
        });

        sendResult({
          success: true,
          filesProcessed: totalDecrypted,
        });
      } catch (error) {
        const errorMessage = (error as Error).message || 'Decryption failed';

        audit({
          level: 'error',
          category: 'security',
          event: 'profile_decryption_failed',
          details: {
            userId: user.id,
            profilePath: profilePaths.root,
            error: errorMessage,
          },
          actor: user.id,
        });

        sendProgress({
          step: 'error',
          status: 'failed',
          message: 'Decryption failed',
          error: errorMessage,
        });

        sendResult({
          success: false,
          error: errorMessage,
        });
      }
    })();

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
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
