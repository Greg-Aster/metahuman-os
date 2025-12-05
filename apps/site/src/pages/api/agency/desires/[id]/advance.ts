import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire, type DesireStatus } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/advance]';

// Valid stage transitions
// NOTE: 'approved' can go back to 'planning' if no plan exists (edge case recovery)
const VALID_TRANSITIONS: Record<string, string[]> = {
  nascent: ['pending', 'planning', 'reviewing', 'approved'],
  pending: ['planning', 'reviewing', 'approved'],
  evaluating: ['planning', 'reviewing', 'approved'],
  planning: ['reviewing', 'approved'],
  reviewing: ['planning', 'approved'], // Allow re-planning from review
  approved: ['executing', 'planning'],  // Allow re-planning if no plan exists
  awaiting_approval: ['approved', 'planning'], // Allow re-planning
};

/**
 * POST /api/agency/desires/:id/advance
 * Advance a desire to the next stage
 * Body: { newStatus: string }
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to advance desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to advance desires.' }),
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

    const body = await request.json();
    const { newStatus } = body;

    if (!newStatus) {
      return new Response(
        JSON.stringify({ error: 'newStatus is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} Loading desire: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (${desire.status} → ${newStatus})`);
    console.log(`${LOG_PREFIX}    Has plan: ${desire.plan ? 'yes' : 'NO'}`);

    // Check if transition is valid
    const allowedTransitions = VALID_TRANSITIONS[desire.status] || [];
    if (!allowedTransitions.includes(newStatus)) {
      console.log(`${LOG_PREFIX} ❌ Invalid transition: ${desire.status} → ${newStatus}`);
      console.log(`${LOG_PREFIX}    Allowed: ${allowedTransitions.join(', ') || 'none'}`);
      return new Response(
        JSON.stringify({
          error: `Cannot transition from '${desire.status}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Special case: going to 'executing' requires a plan
    if (newStatus === 'executing' && !desire.plan) {
      console.log(`${LOG_PREFIX} ⚠️ Cannot execute without a plan - redirecting to planning`);
      return new Response(
        JSON.stringify({
          error: `Cannot execute desire without a plan. Use the planning stage first.`,
          suggestion: 'planning'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Special case: going to 'reviewing' requires a plan
    if (newStatus === 'reviewing' && !desire.plan) {
      console.log(`${LOG_PREFIX} ⚠️ Cannot review without a plan - wait for planner agent`);
      return new Response(
        JSON.stringify({
          error: `Cannot review desire without a plan. The desire-planner agent will generate a plan automatically (runs every 5 minutes), or you can run it manually with: ./bin/mh agent run desire-planner`,
          suggestion: 'Wait for the planner agent to run, or trigger it manually.'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Special case: going to 'approved' without a plan - warn but allow (for testing)
    if (newStatus === 'approved' && !desire.plan) {
      console.log(`${LOG_PREFIX} ⚠️ WARNING: Approving without a plan - will need planning before execution`);
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = {
      ...desire,
      status: newStatus as DesireStatus,
      updatedAt: now,
      activatedAt: desire.activatedAt || now,
    };

    console.log(`${LOG_PREFIX} ✅ Advancing: ${oldStatus} → ${newStatus}`);
    await moveDesire(updatedDesire, oldStatus, newStatus, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_advanced',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        toStatus: newStatus,
        hasPlan: !!desire.plan,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Success: "${desire.title}" now in ${newStatus}`);
    return new Response(JSON.stringify({ desire: updatedDesire, success: true }), {
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
