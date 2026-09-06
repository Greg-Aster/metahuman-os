/**
 * Agency Metrics API Handlers
 *
 * GET agency metrics and desire counts.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  DESIRE_STATUSES,
  IN_PROGRESS_DESIRE_STATUSES,
  NEEDS_ACTION_DESIRE_STATUSES,
  TERMINAL_DESIRE_STATUSES,
  WAITING_DESIRE_STATUSES,
} from '../../agency/lifecycle-policy.js';
import type { DesireStatus } from '../../agency/types.js';
import { listAllDesires, loadMetrics } from '../../agency/storage.js';

/**
 * GET /api/agency/metrics - Get agency metrics and desire counts
 */
export async function handleGetAgencyMetrics(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view metrics',
    };
  }

  try {
    const [metrics, desires] = await Promise.all([
      loadMetrics(user.username),
      listAllDesires(user.username),
    ]);
    const counts = Object.fromEntries(
      DESIRE_STATUSES.map(status => [status, 0]),
    ) as Record<DesireStatus, number>;
    for (const desire of desires) {
      if (desire.status in counts) counts[desire.status] += 1;
    }

    return successResponse({
      metrics,
      counts,
      summary: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        active: IN_PROGRESS_DESIRE_STATUSES.reduce((total, status) => total + counts[status], 0),
        waiting: WAITING_DESIRE_STATUSES.reduce((total, status) => total + counts[status], 0),
        needsAction: NEEDS_ACTION_DESIRE_STATUSES.reduce((total, status) => total + counts[status], 0),
        completed: counts.completed,
        failed: TERMINAL_DESIRE_STATUSES
          .filter(status => status !== 'completed')
          .reduce((total, status) => total + counts[status], 0),
      },
    });
  } catch (error) {
    console.error('[agency/metrics] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
