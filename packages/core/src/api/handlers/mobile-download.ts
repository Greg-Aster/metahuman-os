/**
 * Mobile App Download API Handler
 *
 * GET mobile app APK file for updates.
 * Returns binary APK data.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { MobileReleaseError, readMobileReleaseApk } from '../../mobile-release.js';

// Dynamic import for audit
let audit: typeof import('../../audit.js').audit | null = null;

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js');
    audit = module.audit;
  }
}

/**
 * GET /api/mobile/download - Download mobile app APK
 */
export async function handleGetMobileDownload(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();
    const { release, binary } = readMobileReleaseApk(req.query?.version);

    // Audit the download
    if (audit) {
      audit({
        event: 'mobile_app_download',
        category: 'system',
        level: 'info',
        actor: 'mobile_client',
        details: {
          version: release.version,
          fileSize: release.fileSize,
          userAgent: req.headers?.['user-agent'],
        },
      });
    }

    return {
      status: 200,
      binary,
      contentType: 'application/vnd.android.package-archive',
      headers: {
        'Content-Disposition': `attachment; filename="metahuman-${release.version}.apk"`,
        'Content-Length': release.fileSize.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    };
  } catch (error) {
    console.error('[mobile-download] GET failed:', error);
    if (error instanceof MobileReleaseError) {
      return { status: error.status, error: error.message };
    }
    return {
      status: 500,
      error: (error as Error).message || 'Internal server error',
    };
  }
}
