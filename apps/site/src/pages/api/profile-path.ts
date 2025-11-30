/**
 * Profile Path API
 *
 * GET: Get current profile path configuration
 * POST: Update profile path (triggers migration)
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getProfilePathsWithStatus,
  getDefaultProfilePath,
  audit,
} from '@metahuman/core';
import { validateProfilePath } from '@metahuman/core/path-security';
import { migrateProfile, estimateMigrationDuration } from '@metahuman/core/profile-migration';
import { getStorageInfo } from '@metahuman/core/external-storage';
import { isProfileEncrypted, getEncryptionMeta } from '@metahuman/core/encryption';
import { getProfileStorageConfig } from '@metahuman/core/users';

/**
 * GET /api/profile-path
 *
 * Returns current profile path configuration and status
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const { paths, resolution } = getProfilePathsWithStatus(user.username);
    const defaultPath = getDefaultProfilePath(user.username);
    const storageInfo = getStorageInfo(paths.root);

    // Get migration estimate if using custom path
    let migrationEstimate = null;
    if (resolution.root !== defaultPath) {
      try {
        migrationEstimate = await estimateMigrationDuration(paths.root);
      } catch {
        // Ignore estimation errors
      }
    }

    // Get encryption status
    const profileEncrypted = isProfileEncrypted(paths.root);
    const encryptionMeta = profileEncrypted ? getEncryptionMeta(paths.root) : null;
    const storageConfig = getProfileStorageConfig(user.username);

    // Determine encryption type from metadata or storage config
    let encryptionType: 'none' | 'aes256' | 'veracrypt' = 'none';
    if (profileEncrypted) {
      encryptionType = 'aes256'; // Currently only AES-256 is supported
    } else if (storageConfig?.encryption?.type === 'veracrypt') {
      encryptionType = 'veracrypt';
    }

    return new Response(
      JSON.stringify({
        currentPath: paths.root,
        defaultPath,
        usingCustomPath: resolution.root !== defaultPath,
        usingFallback: resolution.usingFallback,
        fallbackReason: resolution.fallbackReason,
        storageType: resolution.storageType,
        storageInfo: storageInfo
          ? {
              id: storageInfo.id,
              type: storageInfo.type,
              label: storageInfo.label,
              fsType: storageInfo.fsType,
              mounted: storageInfo.mounted,
              writable: storageInfo.writable,
              freeSpace: storageInfo.freeSpace,
              totalSpace: storageInfo.totalSpace,
            }
          : null,
        migrationEstimate,
        // Encryption status
        isEncrypted: profileEncrypted,
        encryptionType,
        encryptionInfo: encryptionMeta
          ? {
              algorithm: encryptionMeta.algorithm,
              createdAt: encryptionMeta.createdAt,
              encryptedFiles: encryptionMeta.encryptedFiles,
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

/**
 * POST /api/profile-path
 *
 * Update profile path and trigger migration
 *
 * Body:
 * - path: string - New profile path (absolute)
 * - keepSource: boolean - Keep source files after migration (default: true)
 * - encryption: { type: 'none' | 'aes256' | 'veracrypt', password?: string, containerSize?: number }
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { path: newPath, keepSource = true, overwrite = false, encryption } = body;

    if (!newPath) {
      return new Response(
        JSON.stringify({ error: 'Path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate the new path (checkExists: false because we'll create the directory)
    const validation = validateProfilePath(newPath, { checkExists: false });
    if (!validation.valid) {
      audit({
        level: 'warn',
        category: 'security',
        event: 'profile_path_validation_failed',
        details: {
          userId: user.id,
          username: user.username,
          attemptedPath: newPath,
          errors: validation.errors,
        },
        actor: user.id,
      });

      return new Response(
        JSON.stringify({
          error: 'Invalid path',
          details: validation.errors,
          warnings: validation.warnings,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get current paths for comparison
    const { paths: currentPaths } = getProfilePathsWithStatus(user.username);

    if (currentPaths.root === newPath) {
      return new Response(
        JSON.stringify({ error: 'New path is same as current path' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build migration options
    const migrationOptions: Parameters<typeof migrateProfile>[3] = {
      keepSource,
      overwrite,
      validateIntegrity: encryption?.type !== 'aes256', // Skip for encrypted files
      encryption: encryption?.type && encryption.type !== 'none'
        ? {
            type: encryption.type,
            password: encryption.password,
            containerSize: encryption.containerSize,
          }
        : undefined,
    };

    // Run migration as a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const progress of migrateProfile(
            user.id,
            user.username,
            newPath,
            migrationOptions
          )) {
            const data = JSON.stringify({ progress });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          controller.close();
        } catch (error) {
          const errorData = JSON.stringify({
            error: (error as Error).message,
            progress: {
              step: 'error',
              status: 'failed',
              message: 'Migration failed',
              error: (error as Error).message,
            },
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
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

/**
 * DELETE /api/profile-path
 *
 * Reset to default profile location
 */
export const DELETE: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const { resetProfileToDefault } = await import('@metahuman/core/profile-migration');
    await resetProfileToDefault(user.id, user.username);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Profile reset to default location',
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
