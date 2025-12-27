import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  audit,
  loadDesire,
  moveDesire,
  addScratchpadEntryToFolder,
  // Graph-based execution (single source of truth)
  executeDesireViaGraph,
  type Desire,
} from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

const LOG_PREFIX = '[API:agency/run]';

/**
 * POST /api/agency/desires/:id/run
 * Execute a desire's plan via the graph pipeline.
 * Uses the same execution path as the autonomous agent.
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
    } catch {
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

    console.log(`${LOG_PREFIX} 🚀 Run requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Only allow running desires in 'approved' or 'executing' status
    if (!['approved', 'executing'].includes(desire.status)) {
      return new Response(
        JSON.stringify({ error: `Cannot run desire in '${desire.status}' status. Must be 'approved' or 'executing'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire has a plan attached
    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Cannot run desire without a plan. Generate a plan first.',
          suggestion: 'Use the "Generate Plan" button first.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Move to executing status if not already
    const now = new Date().toISOString();
    let executingDesire: Desire = desire;

    if (desire.status === 'approved') {
      executingDesire = {
        ...desire,
        status: 'executing',
        updatedAt: now,
        execution: {
          startedAt: now,
          status: 'in_progress',
          stepsCompleted: 0,
          stepsTotal: desire.plan?.steps?.length || 1,
        },
      };
      await moveDesire(executingDesire, 'approved', 'executing', user.username);
      console.log(`${LOG_PREFIX} ⚡ Moved to executing status`);
    }

    // Execute via graph pipeline (handles execution + inner dialogue + TTS)
    console.log(`${LOG_PREFIX} 🏃 Executing via graph pipeline...`);
    const graphResult = await executeDesireViaGraph(executingDesire, user.username);
    const execution = graphResult.execution;

    // Audit the execution
    audit({
      category: 'agent',
      level: graphResult.success ? 'info' : 'warn',
      event: 'desire_executed',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        executionStatus: execution?.status || 'failed',
        stepsCompleted: execution?.stepsCompleted || 0,
        totalSteps: desire.plan?.steps.length || 0,
        error: graphResult.error,
        triggeredBy: 'api',
      },
    });

    // Move to awaiting_review status
    const nowFinal = new Date().toISOString();
    const newStatus: Desire['status'] = 'awaiting_review';

    const finalDesire: Desire = {
      ...executingDesire,
      status: newStatus,
      currentStage: 'outcome_review',
      execution: execution || {
        startedAt: now,
        status: 'failed',
        error: graphResult.error || 'Execution failed',
      },
      updatedAt: nowFinal,
      ...(desire.metrics && {
        metrics: {
          ...desire.metrics,
          executionAttemptCount: desire.metrics.executionAttemptCount + 1,
          lastActivityAt: nowFinal,
        },
      }),
    };

    await moveDesire(finalDesire, 'executing', newStatus, user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: nowFinal,
      type: 'execution_completed',
      description: `Execution ${execution?.status || 'failed'}: ${execution?.stepsCompleted || 0}/${desire.plan?.steps.length || 0} steps completed`,
      actor: 'user',
      data: {
        executionStatus: execution?.status,
        stepsCompleted: execution?.stepsCompleted,
        totalSteps: desire.plan?.steps.length || 0,
        error: graphResult.error,
        newStatus,
      },
    }, user.username);

    const message = graphResult.success
      ? `✅ Execution complete! "${desire.title}" - ${execution?.stepsCompleted}/${desire.plan?.steps.length || 0} steps completed. Status: awaiting_review`
      : `⚠️ Execution had issues: "${desire.title}" - ${graphResult.error || 'Unknown error'}. Status: awaiting_review`;

    console.log(`${LOG_PREFIX} ✅ Execution complete - awaiting outcome review`);

    return new Response(JSON.stringify({
      success: graphResult.success,
      desire: finalDesire,
      execution,
      message,
      awaitingReview: true,
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
