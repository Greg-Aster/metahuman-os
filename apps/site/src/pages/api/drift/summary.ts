import type { APIRoute } from 'astro';
import { getUserOrAnonymous } from '@metahuman/core';
import { loadDriftSummary, initializeSummary } from '@metahuman/core';

/**
 * GET /api/drift/summary
 * Returns drift metrics summary for the authenticated user
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view drift metrics.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let summary = await loadDriftSummary(user.username);

    // Initialize if no summary exists
    if (!summary) {
      summary = await initializeSummary(user.username);
    }

    return new Response(JSON.stringify(summary), {
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
