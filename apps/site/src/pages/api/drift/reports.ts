import type { APIRoute } from 'astro';
import { getUserOrAnonymous } from '@metahuman/core';
import { listDriftReports, getLatestDriftReport } from '@metahuman/core';

/**
 * GET /api/drift/reports
 * Returns list of drift reports for the authenticated user
 *
 * Query params:
 * - limit: number of reports to return (default: 20)
 * - offset: pagination offset (default: 0)
 * - latest: if "true", returns only the most recent report
 */
export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view drift reports.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const params = url.searchParams;
    const latest = params.get('latest') === 'true';

    if (latest) {
      const report = await getLatestDriftReport(user.username);
      return new Response(JSON.stringify({ report }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const limit = parseInt(params.get('limit') || '20', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const { reports, total } = await listDriftReports(user.username, { limit, offset });

    return new Response(JSON.stringify({
      reports,
      total,
      limit,
      offset,
      hasMore: offset + reports.length < total,
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
