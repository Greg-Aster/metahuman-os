/**
 * App Version API Handlers
 *
 * Returns the latest app version info for mobile update checks.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  minAndroidVersion?: number;
  fileSize?: number;
  checksum?: string;
  downloadUrl?: string;
  error?: string;
}

/**
 * GET /api/app-version - Get app version info
 */
export async function handleGetAppVersion(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Path to version.json in mobile releases
    const versionFilePath = path.join(systemPaths.root, 'apps', 'mobile', 'releases', 'version.json');

    // Check if version file exists
    if (!fs.existsSync(versionFilePath)) {
      console.warn('[app-version] Version file not found:', versionFilePath);
      return successResponse({
        error: 'Version info not available',
        version: '1.0',
        versionCode: 1,
        releaseDate: new Date().toISOString().split('T')[0],
        releaseNotes: 'No release info available',
      });
    }

    // Read version file
    const versionData = fs.readFileSync(versionFilePath, 'utf-8');
    const versionInfo: VersionInfo = JSON.parse(versionData);

    // Get server URL for download link from request headers
    const host = req.headers?.['host'] || 'localhost:4321';
    const protocol = req.headers?.['x-forwarded-proto'] || 'http';
    const serverUrl = `${protocol}://${host}`;

    // Add download URL if not present
    const response: VersionInfo = {
      ...versionInfo,
      downloadUrl: versionInfo.downloadUrl || `${serverUrl}/downloads/metahuman-os.apk`,
    };

    return {
      status: 200,
      data: response,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    };
  } catch (error) {
    console.error('[app-version] Error:', error);
    return {
      status: 500,
      error: 'Failed to read version info',
      data: { message: (error as Error).message },
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  }
}

/**
 * OPTIONS /api/app-version - Handle CORS preflight
 */
export async function handleAppVersionOptions(_req: UnifiedRequest): Promise<UnifiedResponse> {
  return {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  };
}
