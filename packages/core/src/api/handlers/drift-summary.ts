/**
 * Drift Summary API Handlers
 *
 * GET drift metrics summary.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for drift functions
let loadDriftSummary: any;
let initializeSummary: any;

async function ensureDriftFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    loadDriftSummary = core.loadDriftSummary;
    initializeSummary = core.initializeSummary;
    return !!(loadDriftSummary && initializeSummary);
  } catch {
    return false;
  }
}

/**
 * GET /api/drift/summary - Get drift metrics summary
 */
export async function handleGetDriftSummary(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required to view drift metrics.' };
    }

    const available = await ensureDriftFunctions();
    if (!available) {
      return { status: 501, error: 'Drift functions not available' };
    }

    let summary = await loadDriftSummary(user.username);

    // Initialize if no summary exists
    if (!summary) {
      summary = await initializeSummary(user.username);
    }

    return successResponse(summary);
  } catch (error) {
    console.error('[drift-summary] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
