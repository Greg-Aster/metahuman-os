import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { loadDesire, loadExecutionAttempts, loadExecutionAttempt } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/executions]';

/**
 * GET /api/agency/desires/:id/executions
 * Get execution attempts for a desire.
 * Query params:
 *   - attempt: specific attempt number (optional)
 */
export const GET: APIRoute = async ({ params, cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify desire exists
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if specific attempt requested
    const attemptParam = url.searchParams.get('attempt');
    if (attemptParam) {
      const attemptNumber = parseInt(attemptParam, 10);
      if (isNaN(attemptNumber) || attemptNumber < 1) {
        return new Response(
          JSON.stringify({ error: 'Invalid attempt number' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const attempt = await loadExecutionAttempt(id, attemptNumber, user.username);
      if (!attempt) {
        return new Response(
          JSON.stringify({ error: 'Execution attempt not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({
        desireId: id,
        attempt: attemptNumber,
        execution: attempt,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Return all attempts
    const executions = await loadExecutionAttempts(id, user.username);
    console.log(`${LOG_PREFIX} Loaded ${executions.length} execution attempts for ${id}`);

    return new Response(JSON.stringify({
      desireId: id,
      total: executions.length,
      executions,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
