import type { APIRoute } from 'astro';
import { getUserOrAnonymous } from '@metahuman/core';
import { loadMetrics, listDesiresByStatus, type DesireStatus } from '@metahuman/core';

/**
 * GET /api/agency/metrics
 * Returns agency metrics and desire counts
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view metrics.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const metrics = await loadMetrics(user.username);

    // Get counts by status
    const statuses: DesireStatus[] = [
      'nascent', 'pending', 'evaluating', 'planning', 'reviewing',
      'approved', 'executing', 'completed', 'rejected', 'abandoned', 'failed'
    ];

    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const desires = await listDesiresByStatus(status, user.username);
      counts[status] = desires.length;
    }

    return new Response(JSON.stringify({
      metrics,
      counts,
      summary: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        active: counts.evaluating + counts.planning + counts.reviewing + counts.approved + counts.executing,
        waiting: counts.nascent + counts.pending,
        completed: counts.completed,
        failed: counts.rejected + counts.abandoned + counts.failed,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
