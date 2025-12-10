/**
 * Drift Reports API Handlers
 *
 * GET list of drift reports.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for drift functions
let listDriftReports: any;
let getLatestDriftReport: any;

async function ensureDriftFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    listDriftReports = core.listDriftReports;
    getLatestDriftReport = core.getLatestDriftReport;
    return !!(listDriftReports && getLatestDriftReport);
  } catch {
    return false;
  }
}

/**
 * GET /api/drift/reports - Get list of drift reports
 * Query params:
 *   - limit: number of reports to return (default: 20)
 *   - offset: pagination offset (default: 0)
 *   - latest: if "true", returns only the most recent report
 */
export async function handleGetDriftReports(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, query } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required to view drift reports.' };
    }

    const available = await ensureDriftFunctions();
    if (!available) {
      return { status: 501, error: 'Drift functions not available' };
    }

    const latest = query?.latest === 'true';

    if (latest) {
      const report = await getLatestDriftReport(user.username);
      return successResponse({ report });
    }

    const limit = parseInt(query?.limit || '20', 10);
    const offset = parseInt(query?.offset || '0', 10);

    const { reports, total } = await listDriftReports(user.username, { limit, offset });

    return successResponse({
      reports,
      total,
      limit,
      offset,
      hasMore: offset + reports.length < total,
    });
  } catch (error) {
    console.error('[drift-reports] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
