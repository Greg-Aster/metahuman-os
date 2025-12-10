/**
 * Mobile Version API Handler
 *
 * GET mobile app version info for update checks.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  checksum?: string;
  minAndroidVersion: number;
}

interface VersionResponse {
  latest: VersionInfo;
  updateAvailable: boolean;
  currentVersion?: string;
}

// Path to mobile releases directory
const RELEASES_DIR = path.join(systemPaths.root, 'apps', 'mobile', 'releases');
const VERSION_FILE = path.join(RELEASES_DIR, 'version.json');

/**
 * GET /api/mobile/version - Get mobile app version info
 */
export async function handleGetMobileVersion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;
    const currentVersion = query?.current || null;
    const currentVersionCode = parseInt(query?.versionCode || '0', 10);

    // Check if version.json exists
    if (!existsSync(VERSION_FILE)) {
      return {
        status: 404,
        error: 'No releases available',
        data: {
          message: 'No mobile app releases have been published yet.',
        },
      };
    }

    // Read version info
    const versionData = JSON.parse(readFileSync(VERSION_FILE, 'utf-8')) as VersionInfo;

    // Check if APK file exists
    const apkPath = path.join(RELEASES_DIR, `metahuman-${versionData.version}.apk`);
    if (!existsSync(apkPath)) {
      return {
        status: 404,
        error: 'APK not found',
        data: {
          message: `Release ${versionData.version} APK file is missing.`,
        },
      };
    }

    // Get file size
    const stats = statSync(apkPath);
    versionData.fileSize = stats.size;

    // Determine if update is available
    const updateAvailable = currentVersionCode > 0
      ? versionData.versionCode > currentVersionCode
      : false;

    const response: VersionResponse = {
      latest: {
        ...versionData,
        downloadUrl: `/api/mobile/download?version=${versionData.version}`,
      },
      updateAvailable,
      currentVersion: currentVersion || undefined,
    };

    return successResponse(response);
  } catch (error) {
    console.error('[mobile-version] GET failed:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }
}
