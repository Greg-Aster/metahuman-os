import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, executeDesireViaGraph } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, proposalEvents } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/approve]';

/**
 * POST /api/agency/desires/:id/approve
 * Approve a desire that's waiting for approval
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to approve desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role for approvals
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to approve desires.' }),
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

    console.log(`${LOG_PREFIX} 👍 Approve requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);
    console.log(`${LOG_PREFIX}    Has plan: ${desire.plan ? `yes (${desire.plan.steps?.length} steps)` : '⚠️ NO'}`);

    // Allow approving desires in any pre-execution status (for manual approval/testing)
    const approvableStatuses = ['nascent', 'pending', 'evaluating', 'planning', 'reviewing', 'awaiting_approval'];
    if (!approvableStatuses.includes(desire.status)) {
      console.log(`${LOG_PREFIX} ❌ Cannot approve: wrong status ${desire.status}`);
      return new Response(
        JSON.stringify({ error: `Cannot approve desire in '${desire.status}' status. Must be one of: ${approvableStatuses.join(', ')}.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Warn if approving without a plan
    if (!desire.plan) {
      console.log(`${LOG_PREFIX} ⚠️ WARNING: Approving desire WITHOUT a plan - will need to generate plan before execution`);
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = {
      ...desire,
      status: 'approved' as const,
      updatedAt: now,
      activatedAt: desire.activatedAt || now, // Set activation time if not already set
    };

    console.log(`${LOG_PREFIX} ✅ Moving ${oldStatus} → approved`);
    await moveDesire(updatedDesire, oldStatus, 'approved', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_approved',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        approvedBy: user.username,
        hadPlan: !!desire.plan,
        fromStatus: oldStatus,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Success: "${desire.title}" now approved`);

    // Wake up the Active Operator to process the approved desire
    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'approved',
      taskType: 'desire_execute',
    });
    console.log(`${LOG_PREFIX} 📢 Emitted proposal-resolved event to wake Active Operator`);

    // Auto-execute after approval if desire has a plan
    // This makes approval = execution for a seamless flow
    let autoExecuted = false;
    if (desire.plan && desire.plan.steps && desire.plan.steps.length > 0) {
      console.log(`${LOG_PREFIX} 🚀 Auto-executing approved desire with ${desire.plan.steps.length} steps...`);

      // Mark as executing and trigger execution
      const executingDesire = {
        ...updatedDesire,
        status: 'executing' as const,
        updatedAt: new Date().toISOString(),
      };

      await moveDesire(executingDesire, 'approved', 'executing', user.username);

      // Execute in background
      executeDesireViaGraph(executingDesire, user.username)
        .then((result) => {
          console.log(`${LOG_PREFIX} 🎉 Auto-execution complete for "${desire.title}": success=${result.success}`);
          if (result.error) {
            console.error(`${LOG_PREFIX} ⚠️ Execution error: ${result.error}`);
          }
        })
        .catch((err) => {
          console.error(`${LOG_PREFIX} ❌ Auto-execution failed for "${desire.title}":`, err);
        });

      autoExecuted = true;
      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_auto_executed',
        actor: user.username,
        details: {
          desireId: id,
          title: desire.title,
          planSteps: desire.plan.steps.length,
        },
      });
    } else {
      console.log(`${LOG_PREFIX} ℹ️ No plan to execute - desire remains in approved state`);
    }

    return new Response(JSON.stringify({
      desire: autoExecuted ? { ...updatedDesire, status: 'executing' } : updatedDesire,
      success: true,
      autoExecuted,
      message: autoExecuted
        ? `Approved and executing "${desire.title}" (${desire.plan?.steps?.length || 0} steps). Check inner dialogue for progress.`
        : `Approved "${desire.title}". Click Execute to run when ready.`,
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
