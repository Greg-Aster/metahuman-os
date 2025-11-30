/**
 * Profile Path Validation API
 *
 * POST: Validate a path before migration
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { validateProfilePath, validateNewProfilePath } from '@metahuman/core/path-security';
import { getStorageInfo } from '@metahuman/core/external-storage';

/**
 * POST /api/profile-path/validate
 *
 * Validate a profile path without saving
 *
 * Body:
 * - path: string - Path to validate
 * - checkExists: boolean - Whether path must exist (default: true)
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { path: testPath, checkExists = true } = body;

    if (!testPath) {
      return new Response(
        JSON.stringify({ error: 'Path is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate the path
    const validation = checkExists
      ? validateProfilePath(testPath)
      : validateNewProfilePath(testPath);

    // Get storage info if path exists
    let storageInfo = null;
    if (validation.valid || !checkExists) {
      try {
        storageInfo = getStorageInfo(validation.resolvedPath);
      } catch {
        // Path may not exist yet
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'profile_path_validated',
      details: {
        userId: user.id,
        path: testPath,
        valid: validation.valid,
        errors: validation.errors,
      },
      actor: user.id,
    });

    return new Response(
      JSON.stringify({
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        resolvedPath: validation.resolvedPath,
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
