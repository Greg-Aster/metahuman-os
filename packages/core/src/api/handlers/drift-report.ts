/**
 * Drift Report API Handlers
 *
 * GET a specific drift report by ID.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let loadDriftReport: any;

async function ensureDriftFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    loadDriftReport = core.loadDriftReport;
    return !!loadDriftReport;
  } catch {
    return false;
  }
}

/**
 * GET /api/drift/reports/:id - Get a specific drift report
 */
export async function handleGetDriftReport(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, params } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required to view drift reports.' };
    }

    const available = await ensureDriftFunctions();
    if (!available) {
      return { status: 501, error: 'Drift functions not available' };
    }

    const id = params?.id;
    if (!id) {
      return { status: 400, error: 'Report ID is required' };
    }

    const report = await loadDriftReport(user.username, id);

    if (!report) {
      return { status: 404, error: 'Report not found' };
    }

    return successResponse(report);
  } catch (error) {
    console.error('[drift-report] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
