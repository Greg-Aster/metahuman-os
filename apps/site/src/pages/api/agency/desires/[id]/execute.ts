import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/execute]';

/**
 * POST /api/agency/desires/:id/execute
 * Mark a desire as executing and trigger the executor
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
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
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
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

    console.log(`${LOG_PREFIX} 🚀 Execute requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Only allow executing desires in 'approved' status
    if (desire.status !== 'approved') {
      console.log(`${LOG_PREFIX} ❌ Wrong status: ${desire.status} (needs: approved)`);
      return new Response(
        JSON.stringify({ error: `Cannot execute desire in '${desire.status}' status. Must be 'approved'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire has a plan attached
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      console.log(`${LOG_PREFIX} ❌ No plan attached to desire`);
      return new Response(
        JSON.stringify({
          error: 'Cannot execute desire without a plan. Use the planning stage first.',
          suggestion: 'Move the desire back to "planning" status to generate a plan.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} ✅ Plan found with ${desire.plan.steps.length} steps`);

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

    console.log(`${LOG_PREFIX} ⚡ Moving to executing status...`);
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
        planSteps: desire.plan?.steps?.length || 0,
      },
    });

    // TODO: Actually trigger the executor/operator here
    // For now, just mark as executing - the desire-executor agent will pick it up

    console.log(`${LOG_PREFIX} ✅ Success: "${desire.title}" now executing (${desire.plan?.steps?.length || 0} steps)`);
    console.log(`${LOG_PREFIX}    Goal: ${desire.plan?.operatorGoal || 'No goal specified'}`);

    return new Response(JSON.stringify({
      desire: updatedDesire,
      success: true,
      message: 'Desire marked as executing. The executor will process it shortly.',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
