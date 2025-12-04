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

    // Can only revise desires that have a plan and are in reviewing/approved status
    const revisableStatuses = ['reviewing', 'approved', 'awaiting_approval', 'planning'];
    if (!revisableStatuses.includes(desire.status)) {
      return new Response(
        JSON.stringify({
          error: `Cannot revise a desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!desire.plan) {
      return new Response(
        JSON.stringify({ error: 'No plan to revise. The desire must have a plan first.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;

    // Move current plan to history
    const planHistory = desire.planHistory || [];
    planHistory.push(desire.plan);

    // Update the desire
    const updatedDesire = {
      ...desire,
      status: 'planning' as DesireStatus,
      updatedAt: now,
      // Keep the current plan (planner will use it for context)
      planHistory,
      // Store the critique
      userCritique: critique.trim(),
      critiqueAt: now,
      // Clear any previous review since we're re-planning
      review: undefined,
    };

    // Move to planning status
    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_revision_requested',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        critique: critique.substring(0, 200), // Truncate for audit log
        planVersion: desire.plan.version || 1,
        historyCount: planHistory.length,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        desire: updatedDesire,
        message: `Plan revision requested. The planner will generate a new plan based on your critique.`,
        planVersion: (desire.plan.version || 1) + 1,
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
