/**
 * Mobile App Download API
 *
 * Serves the APK file for mobile app updates.
 */

import type { APIRoute } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '@metahuman/core';
import { audit } from '@metahuman/core';

const RELEASES_DIR = path.join(systemPaths.root, 'apps', 'mobile', 'releases');
const VERSION_FILE = path.join(RELEASES_DIR, 'version.json');

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    let version = url.searchParams.get('version');

    // If no version specified, get latest
    if (!version) {
      if (!fs.existsSync(VERSION_FILE)) {
        return new Response(JSON.stringify({ error: 'No releases available' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf-8'));
      version = versionData.version;
    }

    // Sanitize version string to prevent path traversal
    version = version.replace(/[^a-zA-Z0-9.-]/g, '');

    const apkPath = path.join(RELEASES_DIR, `metahuman-${version}.apk`);

    if (!fs.existsSync(apkPath)) {
      return new Response(JSON.stringify({
        error: 'APK not found',
        message: `Version ${version} is not available for download.`,
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read the APK file
    const apkBuffer = fs.readFileSync(apkPath);
    const stats = fs.statSync(apkPath);

    // Audit the download
    audit({
      event: 'mobile_app_download',
      category: 'system',
      level: 'info',
      actor: 'mobile_client',
      details: {
        version,
        fileSize: stats.size,
        userAgent: request.headers.get('user-agent'),
      },
    });

    return new Response(apkBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="metahuman-${version}.apk"`,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    console.error('[mobile/download] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
