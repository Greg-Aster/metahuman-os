/**
 * Profile Path Handler
 *
 * Handles profile path configuration
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { getDefaultProfilePath, getProfilePathsWithStatus } from '../../path-builder.js';
import { getProfileStorageConfig, updateProfileStorage } from '../../users.js';
import { audit } from '../../audit.js';
import { validateProfilePath } from '../../path-security.js';
import { getStorageInfo } from '../../external-storage.js';
import { estimateMigrationDuration } from '../../profile-migration.js';
import { getEncryptionMeta, isProfileEncrypted } from '../../encryption.js';

/**
 * GET /api/profile-path
 *
 * Returns current profile path configuration and status
 * Requires authentication
 */
export async function handleGetProfilePath(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Not authenticated',
    };
  }

  try {
    const { paths, resolution } = getProfilePathsWithStatus(req.user.username);
    const defaultPath = getDefaultProfilePath(req.user.username);
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
    const storageConfig = getProfileStorageConfig(req.user.username);

    // Determine encryption type from metadata or storage config
    let encryptionType: 'none' | 'aes256' | 'veracrypt' = 'none';
    if (profileEncrypted) {
      encryptionType = 'aes256'; // Currently only AES-256 is supported
    } else if (storageConfig?.encryption?.type === 'veracrypt') {
      encryptionType = 'veracrypt';
    }

    return {
      status: 200,
      data: {
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
              useLoginPassword: encryptionMeta.useLoginPassword ?? false,
            }
          : null,
      },
    };
  } catch (error) {
    console.error('[profile-path] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * PUT /api/profile-path
 *
 * Switch to a different profile location WITHOUT migration
 * Used when switching to an already-migrated location
 * Requires authentication
 */
export async function handleSwitchProfilePath(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Not authenticated',
    };
  }

  const { path: newPath, type = 'external', deviceId, fallbackBehavior = 'error' } = req.body as {
    path: string;
    type?: 'internal' | 'external' | 'encrypted';
    deviceId?: string;
    fallbackBehavior?: 'error' | 'readonly';
  };

  if (!newPath) {
    return {
      status: 400,
      error: 'Path is required',
    };
  }

  try {
    // Validate the path exists and is accessible
    const validation = validateProfilePath(newPath, { checkExists: true });
    if (!validation.valid) {
      audit({
        level: 'warn',
        category: 'security',
        event: 'profile_path_switch_validation_failed',
        details: {
          userId: req.user.userId,
          username: req.user.username,
          attemptedPath: newPath,
          errors: validation.errors,
        },
        actor: req.user.userId,
      });

      return {
        status: 400,
        error: 'Invalid path',
        data: {
          details: validation.errors,
          warnings: validation.warnings,
        },
      };
    }

    // Check if profile data exists at the location
    const fs = await import('node:fs');
    const path = await import('node:path');
    const personaPath = path.join(newPath, 'persona');
    const memoryPath = path.join(newPath, 'memory');

    if (!fs.existsSync(personaPath) && !fs.existsSync(memoryPath)) {
      return {
        status: 400,
        error: 'No profile data found at this location',
        data: {
          details: ['The directory exists but does not contain profile data (persona/ or memory/ folders)'],
        },
      };
    }

    // Get storage info for the device
    const storageInfo = getStorageInfo(newPath);

    // Update user's profile storage configuration
    // Check if profile is encrypted at new location
    const profileEncrypted = isProfileEncrypted(newPath);
    const encryptionMeta = profileEncrypted ? getEncryptionMeta(newPath) : null;

    const newConfig = {
      path: newPath,
      type: profileEncrypted ? 'encrypted' as const : type as 'internal' | 'external' | 'encrypted',
      deviceId: deviceId || storageInfo?.id,
      fallbackBehavior: fallbackBehavior as 'error' | 'readonly',
      encryption: profileEncrypted && encryptionMeta
        ? {
            type: 'aes256' as const,
            useLoginPassword: encryptionMeta.useLoginPassword ?? false,
          }
        : undefined,
    };

    updateProfileStorage(req.user.userId, newConfig);

    audit({
      level: 'info',
      category: 'security',
      event: 'profile_path_switched',
      details: {
        userId: req.user.userId,
        username: req.user.username,
        newPath,
        storageType: newConfig.type,
        encrypted: profileEncrypted,
      },
      actor: req.user.userId,
    });

    return {
      status: 200,
      data: {
        success: true,
        message: 'Profile location switched successfully',
        newPath,
        storageType: newConfig.type,
        isEncrypted: profileEncrypted,
      },
    };
  } catch (error) {
    console.error('[profile-path] PUT error:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Failed to switch profile location',
    };
  }
}

/**
 * DELETE /api/profile-path
 *
 * Reset to default profile location
 * Requires authentication
 */
export async function handleResetProfilePath(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Not authenticated',
    };
  }

  try {
    const { resetProfileToDefault } = await import('../../profile-migration.js');
    await resetProfileToDefault(req.user.userId, req.user.username);

    return {
      status: 200,
      data: {
        success: true,
        message: 'Profile reset to default location',
      },
    };
  } catch (error) {
    console.error('[profile-path] DELETE error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/profile-path/validate
 *
 * Validate a profile path without switching to it
 * Requires authentication
 */
export async function handleValidateProfilePath(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Not authenticated',
    };
  }

  const { path: targetPath } = req.body as { path: string };

  if (!targetPath) {
    return {
      status: 400,
      error: 'Path is required',
    };
  }

  try {
    const validation = validateProfilePath(targetPath, { checkExists: false });
    const storageInfo = getStorageInfo(targetPath);

    return {
      status: 200,
      data: {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
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
      },
    };
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
