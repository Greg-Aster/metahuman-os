/**
 * Queue Metrics API
 *
 * Returns lane throughput metrics for the dashboard.
 */

import type { APIRoute } from 'astro';
import { getAllLaneMetrics, getThroughputHistory, getLastHourSummary } from '@metahuman/core';

export const GET: APIRoute = async ({ url }) => {
  try {
    const hours = parseInt(url.searchParams.get('hours') || '24', 10);
    const lane = url.searchParams.get('lane') as 'local-llm' | 'vector-index' | 'remote-llm' | null;

    // Get all lane metrics
    const metrics = getAllLaneMetrics();

    // Get throughput history for requested hours
    const history = lane
      ? { [lane]: getThroughputHistory(lane, hours) }
      : {
          'local-llm': getThroughputHistory('local-llm', hours),
          'vector-index': getThroughputHistory('vector-index', hours),
          'remote-llm': getThroughputHistory('remote-llm', hours),
        };

    // Get last hour summary
    const lastHour = getLastHourSummary();

    return new Response(
      JSON.stringify({
        success: true,
        metrics: {
          lastUpdated: metrics.lastUpdated,
          lanes: metrics.lanes,
          history,
          lastHour,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API] Queue metrics error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
