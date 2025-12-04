import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire } from '@metahuman/core';

/**
 * POST /api/agency/desires/:id/execute
 * Mark a desire as executing and trigger the executor
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to execute desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to execute desires.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Only allow executing desires in 'approved' status
    if (desire.status !== 'approved') {
      return new Response(
        JSON.stringify({ error: `Cannot execute desire in '${desire.status}' status. Must be 'approved'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire has a plan attached
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Cannot execute desire without a plan. Use the planning stage first.',
          suggestion: 'Move the desire back to "planning" status to generate a plan.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const updatedDesire = {
      ...desire,
      status: 'executing' as const,
      updatedAt: now,
      execution: {
        startedAt: now,
        status: 'running' as const,
        stepsCompleted: 0,
        stepsTotal: desire.plan?.steps?.length || 1,
      },
    };

    await moveDesire(updatedDesire, 'approved', 'executing', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_execution_started',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        manual: true,
      },
    });

    // TODO: Actually trigger the executor/operator here
    // For now, just mark as executing - the desire-executor agent will pick it up

    return new Response(JSON.stringify({
      desire: updatedDesire,
      success: true,
      message: 'Desire marked as executing. The executor will process it shortly.',
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
