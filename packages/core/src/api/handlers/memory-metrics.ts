/**
 * Memory Metrics API Handlers
 *
 * Unified handlers for memory coverage metrics.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getMemoryMetrics } from '../../memory-metrics-cache.js';

/**
 * GET /api/memory-metrics - Get memory coverage metrics
 */
export async function handleGetMemoryMetrics(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const forceFresh = query.fresh === 'true';
    const metrics = await getMemoryMetrics(user.username, { forceFresh });

    return successResponse(metrics);
  } catch (error) {
    console.error('[memory-metrics] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
