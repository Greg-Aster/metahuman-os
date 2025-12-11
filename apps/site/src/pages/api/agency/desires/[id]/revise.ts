import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire, type DesireStatus } from '@metahuman/core';

/**
 * POST /api/agency/desires/:id/revise
 * Request plan revision with user critique
 * Body: { critique: string }
 *
 * This endpoint:
 * 1. Moves the current plan to planHistory
 * 2. Stores the user critique on the desire
 * 3. Moves the desire back to 'planning' status
 * 4. The planner agent will pick it up and generate a revised plan
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to revise desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to revise desires.' }),
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
    const { critique } = body;

    if (!critique || typeof critique !== 'string' || critique.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Critique text is required' }),
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

    // Allow critique/revision for desires that can be planned or re-planned
    const revisableStatuses = ['nascent', 'pending', 'planning', 'reviewing', 'approved', 'awaiting_approval'];
    if (!revisableStatuses.includes(desire.status)) {
      return new Response(
        JSON.stringify({
          error: `Cannot add instructions to a desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const hasPlan = !!desire.plan;

    // Move current plan to history if it exists
    const planHistory = desire.planHistory || [];
    if (hasPlan && desire.plan) {
      planHistory.push(desire.plan);
    }

    // Determine target status:
    // - If has plan: move to planning for revision
    // - If no plan yet: stay in pending/nascent (user can then click Generate Plan)
    const targetStatus = hasPlan ? 'planning' : (desire.status === 'nascent' ? 'pending' : desire.status);

    // Update the desire
    const updatedDesire = {
      ...desire,
      status: targetStatus as DesireStatus,
      updatedAt: now,
      // Keep plan history
      planHistory,
      // Store the critique/instructions
      userCritique: critique.trim(),
      critiqueAt: now,
      // Clear any previous review since we're (re-)planning
      review: hasPlan ? undefined : desire.review,
    };

    // Move to target status if changed
    if (oldStatus !== targetStatus) {
      await moveDesire(updatedDesire, oldStatus, targetStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: hasPlan ? 'desire_revision_requested' : 'desire_instructions_added',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        toStatus: targetStatus,
        critique: critique.substring(0, 200), // Truncate for audit log
        hadPlan: hasPlan,
        planVersion: hasPlan ? (desire.plan?.version || 1) : 0,
        historyCount: planHistory.length,
      },
    });

    // Build appropriate message
    const message = hasPlan
      ? `Plan revision requested. The planner will generate a new plan based on your critique.`
      : `Instructions saved. Click "Generate Plan" to create a plan using your feedback.`;

    return new Response(
      JSON.stringify({
        success: true,
        desire: updatedDesire,
        message,
        planVersion: hasPlan ? ((desire.plan?.version || 1) + 1) : 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
