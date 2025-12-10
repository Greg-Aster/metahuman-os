/**
 * Profile Path API
 *
 * GET: Get current profile path configuration
 * PUT: Switch to a different profile location WITHOUT migration
 * DELETE: Reset to default profile location
 * POST: Update profile path (triggers migration) - USES STREAMING, NOT MIGRATED
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';
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
import { getProfileStorageConfig, verifyUserPassword } from '@metahuman/core/users';

// GET, PUT, DELETE use unified handler
export const GET = astroHandler;
export const PUT = astroHandler;
export const DELETE = astroHandler;

/**
 * POST /api/profile-path
 *
 * Update profile path and trigger migration
 * This uses Server-Sent Events for progress streaming, so it remains Astro-specific
 *
 * Body:
 * - path: string - New profile path (absolute)
 * - keepSource: boolean - Keep source files after migration (default: true)
 * - encryption: { type: 'none' | 'aes256' | 'luks' | 'veracrypt', password?: string, containerSize?: number, useLoginPassword?: boolean }
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

    // Verify login password if using login password mode for encryption
    if (encryption?.useLoginPassword && (encryption?.type === 'aes256' || encryption?.type === 'luks')) {
      if (!verifyUserPassword(user.username, encryption.password)) {
        return new Response(
          JSON.stringify({ error: 'Incorrect login password' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build migration options
    // Skip integrity validation - background agents modify files during migration
    // (conversation buffers, embeddings, etc. change constantly)
    const migrationOptions: Parameters<typeof migrateProfile>[3] = {
      keepSource,
      overwrite,
      validateIntegrity: false,
      encryption: encryption?.type && encryption.type !== 'none'
        ? {
            type: encryption.type,
            password: encryption.password,
            containerSize: encryption.containerSize,
            useLoginPassword: encryption.useLoginPassword,
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