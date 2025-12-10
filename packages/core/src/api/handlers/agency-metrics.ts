/**
 * Agency Metrics API Handlers
 *
 * GET agency metrics and desire counts.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic import for optional agency functions
let loadMetrics: ((username: string) => Promise<any>) | null = null;
let listDesiresByStatus: ((status: string, username: string) => Promise<any[]>) | null = null;

async function ensureAgencyFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    if (core.loadMetrics && core.listDesiresByStatus) {
      loadMetrics = core.loadMetrics;
      listDesiresByStatus = core.listDesiresByStatus;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

type DesireStatus =
  | 'nascent'
  | 'pending'
  | 'evaluating'
  | 'planning'
  | 'reviewing'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rejected'
  | 'abandoned'
  | 'failed';

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
    const available = await ensureAgencyFunctions();
    if (!available || !loadMetrics || !listDesiresByStatus) {
      return {
        status: 501,
        error: 'Agency metrics not available',
      };
    }

    const metrics = await loadMetrics(user.username);

    // Get counts by status
    const statuses: DesireStatus[] = [
      'nascent',
      'pending',
      'evaluating',
      'planning',
      'reviewing',
      'approved',
      'executing',
      'completed',
      'rejected',
      'abandoned',
      'failed',
    ];

    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const desires = await listDesiresByStatus(status, user.username);
      counts[status] = desires.length;
    }

    return successResponse({
      metrics,
      counts,
      summary: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        active:
          counts.evaluating +
          counts.planning +
          counts.reviewing +
          counts.approved +
          counts.executing,
        waiting: counts.nascent + counts.pending,
        completed: counts.completed,
        failed: counts.rejected + counts.abandoned + counts.failed,
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
