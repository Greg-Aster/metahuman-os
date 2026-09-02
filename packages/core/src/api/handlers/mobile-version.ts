/**
 * Mobile Version API Handler
 *
 * GET mobile app version info for update checks.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadLatestMobileRelease, MobileReleaseError } from '../../mobile-release.js';

const PUBLIC_RELEASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

/**
 * GET /api/mobile/version - Get mobile app version info
 */
export async function handleGetMobileVersion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { query } = req;
    const currentVersion = query?.current || null;
    const currentVersionCode = Number(query?.versionCode || 0);
    if (!Number.isInteger(currentVersionCode) || currentVersionCode < 0) {
      return { status: 400, error: 'versionCode must be a non-negative integer', headers: PUBLIC_RELEASE_HEADERS };
    }

    const release = loadLatestMobileRelease();

    // Determine if update is available
    const updateAvailable = currentVersionCode > 0
      ? release.versionCode > currentVersionCode
      : false;

    const response = successResponse({
      latest: {
        version: release.version,
        versionCode: release.versionCode,
        releaseDate: release.releaseDate,
        releaseNotes: release.releaseNotes,
        minAndroidVersion: release.minAndroidVersion,
        fileSize: release.fileSize,
        checksum: release.checksum,
        downloadUrl: `/api/mobile/download?version=${release.version}`,
      },
      updateAvailable,
      currentVersion: currentVersion || undefined,
    });
    response.headers = PUBLIC_RELEASE_HEADERS;
    return response;
  } catch (error) {
    console.error('[mobile-version] GET failed:', error);
    if (error instanceof MobileReleaseError) {
      return { status: error.status, error: error.message, headers: PUBLIC_RELEASE_HEADERS };
    }
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
      headers: PUBLIC_RELEASE_HEADERS,
    };
  }
}
