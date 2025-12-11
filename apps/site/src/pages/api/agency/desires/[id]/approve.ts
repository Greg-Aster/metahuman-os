import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire } from '@metahuman/core';

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
    return new Response(JSON.stringify({ desire: updatedDesire, success: true }), {
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
