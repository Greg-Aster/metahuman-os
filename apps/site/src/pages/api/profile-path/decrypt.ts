/**
 * Profile Decryption API
 *
 * POST: Decrypt existing encrypted profile data in-place
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getProfilePaths,
  audit,
} from '@metahuman/core';
import {
  decryptDirectory,
  verifyPassword,
  getEncryptionMeta,
  isProfileEncrypted,
  ENCRYPTION_META_FILE,
} from '@metahuman/core/encryption';
import { updateProfileStorage, getProfileStorageConfig } from '@metahuman/core/users';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/profile-path/decrypt
 *
 * Decrypt existing encrypted profile data in-place
 *
 * Body:
 * - password: string - Encryption password to verify and use
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

    // Check if profile is encrypted
    if (!isProfileEncrypted(profilePaths.root)) {
      return new Response(
        JSON.stringify({ error: 'Profile is not encrypted' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify password before proceeding
    if (!verifyPassword(profilePaths.root, password)) {
      return new Response(
        JSON.stringify({ error: 'Incorrect password' }),
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
          },
          actor: user.id,
        });

        sendProgress({
          step: 'init',
          status: 'running',
          message: 'Verifying encryption metadata...',
        });

        // Get encryption metadata to derive key
        const meta = getEncryptionMeta(profilePaths.root);
        if (!meta) {
          throw new Error('Encryption metadata not found');
        }

        // Import deriveKey for key derivation
        const { deriveKey } = await import('@metahuman/core/encryption');
        const salt = Buffer.from(meta.salt, 'base64');
        const key = deriveKey(password, salt);

        sendProgress({
          step: 'init',
          status: 'completed',
          message: 'Decryption key derived',
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
            // Directory may not exist or have no encrypted files
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
          step: 'cleanup',
          status: 'running',
          message: 'Removing encryption metadata...',
        });

        // Remove encryption metadata files
        const metaPath = path.join(profilePaths.root, ENCRYPTION_META_FILE);
        const verifyPath = path.join(profilePaths.root, '.encryption-verify.enc');

        try {
          if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
          }
          if (fs.existsSync(verifyPath)) {
            fs.unlinkSync(verifyPath);
          }
        } catch (error) {
          console.warn('[decrypt] Failed to remove metadata files:', error);
        }

        // Update user profile config to remove encryption
        const currentConfig = getProfileStorageConfig(user.username);
        updateProfileStorage(user.id, {
          ...currentConfig,
          encryption: {
            type: 'none',
          },
          path: profilePaths.root,
        });

        sendProgress({
          step: 'cleanup',
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
