/**
 * Drift History API Handlers
 *
 * GET drift history and dimension trends.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Import drift functions from core - these may need to be created/exported
let getDriftHistory: (username: string, days: number) => Promise<any>;
let getDimensionTrends: (username: string, dimension: string, days: number) => Promise<any>;

// Dynamic import to handle module availability
async function ensureDriftFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    if (core.getDriftHistory && core.getDimensionTrends) {
      getDriftHistory = core.getDriftHistory;
      getDimensionTrends = core.getDimensionTrends;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * GET /api/drift/history - Get drift history
 *
 * Query params:
 * - days: number of days of history (default: 30)
 * - dimension: specific dimension to get trends for (optional)
 */
export async function handleGetDriftHistory(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view drift history',
    };
  }

  try {
    const available = await ensureDriftFunctions();
    if (!available) {
      return {
        status: 501,
        error: 'Drift detection not available',
      };
    }

    const days = parseInt(query?.days || '30', 10);
    const dimension = query?.dimension;

    if (dimension) {
      // Get trends for a specific dimension
      const trends = await getDimensionTrends(user.username, dimension, days);
      return successResponse({
        dimension,
        days,
        trends,
      });
    }

    // Get overall drift history
    const history = await getDriftHistory(user.username, days);

    return successResponse({
      days,
      history,
    });
  } catch (error) {
    console.error('[drift/history] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
