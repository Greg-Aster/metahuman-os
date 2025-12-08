import type { APIRoute } from 'astro';
import { getUserOrAnonymous } from '@metahuman/core';
import { getDriftHistory, getDimensionTrends } from '@metahuman/core';

/**
 * GET /api/drift/history
 * Returns drift history for trending/charts
 *
 * Query params:
 * - days: number of days of history (default: 30)
 * - dimension: specific dimension to get trends for (optional)
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view drift history.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const params = url.searchParams;
    const days = parseInt(params.get('days') || '30', 10);
    const dimension = params.get('dimension');

    if (dimension) {
      // Get trends for a specific dimension
      const trends = await getDimensionTrends(user.username, dimension, days);
      return new Response(JSON.stringify({
        dimension,
        days,
        trends,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get overall drift history
    const history = await getDriftHistory(user.username, days);

    return new Response(JSON.stringify({
      days,
      history,
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
