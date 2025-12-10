/**
 * Mobile App Download API Handler
 *
 * GET mobile app APK file for updates.
 * Returns binary APK data.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

// Dynamic import for audit
let audit: typeof import('../../audit.js').audit | null = null;

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js');
    audit = module.audit;
  }
}

// Path to mobile releases directory
const RELEASES_DIR = path.join(systemPaths.root, 'apps', 'mobile', 'releases');
const VERSION_FILE = path.join(RELEASES_DIR, 'version.json');

/**
 * GET /api/mobile/download - Download mobile app APK
 */
export async function handleGetMobileDownload(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();
    const { query } = req;
    let version = query?.version;

    // If no version specified, get latest
    if (!version) {
      if (!existsSync(VERSION_FILE)) {
        return {
          status: 404,
          error: 'No releases available',
        };
      }
      const versionData = JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
      version = versionData.version;
    }

    if (!version) {
      return {
        status: 400,
        error: 'Version not specified',
      };
    }

    // Sanitize version string to prevent path traversal
    version = version.replace(/[^a-zA-Z0-9.-]/g, '');

    const apkPath = path.join(RELEASES_DIR, `metahuman-${version}.apk`);

    if (!existsSync(apkPath)) {
      return {
        status: 404,
        error: 'APK not found',
        data: {
          message: `Version ${version} is not available for download.`,
        },
      };
    }

    // Read the APK file
    const apkBuffer = readFileSync(apkPath);
    const stats = statSync(apkPath);

    // Audit the download
    if (audit) {
      audit({
        event: 'mobile_app_download',
        category: 'system',
        level: 'info',
        actor: 'mobile_client',
        details: {
          version,
          fileSize: stats.size,
          userAgent: req.headers?.['user-agent'],
        },
      });
    }

    return {
      status: 200,
      binary: apkBuffer,
      contentType: 'application/vnd.android.package-archive',
      headers: {
        'Content-Disposition': `attachment; filename="metahuman-${version}.apk"`,
        'Content-Length': stats.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    };
  } catch (error) {
    console.error('[mobile-download] GET failed:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }
}
