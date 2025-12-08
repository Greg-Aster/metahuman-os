import type { APIRoute } from 'astro';
import { getUserOrAnonymous } from '@metahuman/core';
import { loadDriftReport } from '@metahuman/core';

/**
 * GET /api/drift/reports/[id]
 * Returns a specific drift report
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view drift reports.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Report ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const report = await loadDriftReport(user.username, id);

    if (!report) {
      return new Response(
        JSON.stringify({ error: 'Report not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(report), {
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
