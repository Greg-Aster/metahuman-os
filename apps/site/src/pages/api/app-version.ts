/**
 * App Version API
 *
 * Returns the latest app version info for mobile update checks.
 * Reads from apps/mobile/releases/version.json
 */

import type { APIRoute } from 'astro';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the version.json file
// In development: apps/mobile/releases/version.json
// The file should be deployed to a public location in production
const VERSION_FILE_PATH = join(__dirname, '../../../../mobile/releases/version.json');

interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  minAndroidVersion?: number;
  fileSize?: number;
  checksum?: string;
  downloadUrl?: string;
}

export const GET: APIRoute = async ({ request }) => {
  try {
    // Check if version file exists
    if (!existsSync(VERSION_FILE_PATH)) {
      console.warn('[api/app-version] Version file not found:', VERSION_FILE_PATH);
      return new Response(
        JSON.stringify({
          error: 'Version info not available',
          version: '1.0',
          versionCode: 1,
          releaseDate: new Date().toISOString().split('T')[0],
          releaseNotes: 'No release info available',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Read version file
    const versionData = readFileSync(VERSION_FILE_PATH, 'utf-8');
    const versionInfo: VersionInfo = JSON.parse(versionData);

    // Get server URL for download link
    const url = new URL(request.url);
    const serverUrl = `${url.protocol}//${url.host}`;

    // Add download URL if not present
    const response: VersionInfo = {
      ...versionInfo,
      downloadUrl: versionInfo.downloadUrl || `${serverUrl}/downloads/metahuman-os.apk`,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (e) {
    console.error('[api/app-version] Error:', e);
    return new Response(
      JSON.stringify({
        error: 'Failed to read version info',
        message: e instanceof Error ? e.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
};

// Handle CORS preflight
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
