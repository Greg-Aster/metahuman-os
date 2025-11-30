/**
 * Profile Encryption API
 *
 * POST: Encrypt existing profile data in-place with AES-256-GCM
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getProfilePaths,
  audit,
} from '@metahuman/core';
import {
  deriveKey,
  generateSalt,
  encryptDirectory,
  saveEncryptionMeta,
  createVerificationFile,
  isProfileEncrypted,
  type EncryptionMeta,
} from '@metahuman/core/encryption';
import { updateProfileStorage, getProfileStorageConfig } from '@metahuman/core/users';

/**
 * POST /api/profile-path/encrypt
 *
 * Encrypt existing profile data in-place
 *
 * Body:
 * - password: string - Encryption password (min 8 chars)
 * - type: 'aes256' - Encryption type (only AES-256 supported for in-place)
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body = await request.json();
    const { password, type = 'aes256' } = body;

    // Validate inputs
    if (!password || password.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 8 characters' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (type !== 'aes256') {
      return new Response(
        JSON.stringify({ error: 'Only AES-256 encryption is supported for in-place encryption' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if already encrypted
    if (isProfileEncrypted(profilePaths.root)) {
      return new Response(
        JSON.stringify({ error: 'Profile is already encrypted' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
      bytesProcessed?: number;
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

    // Start encryption process
    (async () => {
      try {
        audit({
          level: 'info',
          category: 'security',
          event: 'profile_encryption_started',
          details: {
            userId: user.id,
            profilePath: profilePaths.root,
            encryptionType: type,
          },
          actor: user.id,
        });

        sendProgress({
          step: 'init',
          status: 'running',
          message: 'Initializing encryption...',
        });

        // Generate salt and derive key
        const salt = generateSalt();
        const key = deriveKey(password, salt);

        sendProgress({
          step: 'init',
          status: 'completed',
          message: 'Encryption key derived',
        });

        sendProgress({
          step: 'encrypt',
          status: 'running',
          message: 'Encrypting profile data...',
          progress: 0,
        });

        // Encrypt all profile directories
        let totalEncrypted = 0;
        const dirsToEncrypt = ['memory', 'persona', 'etc'];

        for (const dir of dirsToEncrypt) {
          const dirPath = `${profilePaths.root}/${dir}`;
          try {
            const encrypted = await encryptDirectory(dirPath, key, {
              onProgress: (file, current, total) => {
                const dirProgress = (current / total) * 100;
                sendProgress({
                  step: 'encrypt',
                  status: 'running',
                  message: `Encrypting ${dir}... (${current}/${total})`,
                  progress: Math.round(dirProgress),
                });
              },
            });
            totalEncrypted += encrypted;
          } catch (error) {
            // Directory may not exist
            console.warn(`[encrypt] Skipping ${dir}:`, (error as Error).message);
          }
        }

        sendProgress({
          step: 'encrypt',
          status: 'completed',
          message: `Encrypted ${totalEncrypted} files`,
          progress: 100,
        });

        sendProgress({
          step: 'finalize',
          status: 'running',
          message: 'Saving encryption metadata...',
        });

        // Create encryption metadata
        const meta: EncryptionMeta = {
          version: 1,
          algorithm: 'aes-256-gcm',
          keyDerivation: 'pbkdf2',
          pbkdf2Iterations: 100_000,
          pbkdf2Digest: 'sha512',
          salt: salt.toString('base64'),
          createdAt: new Date().toISOString(),
          encryptedFiles: totalEncrypted,
        };

        saveEncryptionMeta(profilePaths.root, meta);
        createVerificationFile(profilePaths.root, key);

        // Update user profile config
        const currentConfig = getProfileStorageConfig(user.username);
        updateProfileStorage(user.id, {
          encryption: {
            type: 'aes256',
            encryptedAt: new Date().toISOString(),
          },
          path: currentConfig?.path || profilePaths.root,
        });

        sendProgress({
          step: 'finalize',
          status: 'completed',
          message: 'Encryption metadata saved',
        });

        sendProgress({
          step: 'complete',
          status: 'completed',
          message: 'Profile encryption complete!',
        });

        audit({
          level: 'info',
          category: 'security',
          event: 'profile_encryption_completed',
          details: {
            userId: user.id,
            profilePath: profilePaths.root,
            filesEncrypted: totalEncrypted,
          },
          actor: user.id,
        });

        sendResult({
          success: true,
          filesProcessed: totalEncrypted,
        });
      } catch (error) {
        const errorMessage = (error as Error).message || 'Encryption failed';

        audit({
          level: 'error',
          category: 'security',
          event: 'profile_encryption_failed',
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
          message: 'Encryption failed',
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
