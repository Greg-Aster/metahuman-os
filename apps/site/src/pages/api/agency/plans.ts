import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getUserOrAnonymous,
  audit,
} from '@metahuman/core';
import {
  listPlanVersions,
  loadPlanFromFolder,
  savePlanToFolder,
  loadDesire,
  saveDesire,
  type DesirePlan,
} from '@metahuman/core';

/**
 * GET /api/agency/plans
 * Returns plan versions for a desire
 * Query params:
 *   - desireId: string (required)
 *   - version: number (optional, for single plan)
 */
export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view plans.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    const desireId = url.searchParams.get('desireId');
    const version = url.searchParams.get('version');

    if (!desireId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: desireId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify desire exists
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If version is specified, return single plan
    if (version) {
      const plan = await loadPlanFromFolder(desireId, parseInt(version, 10), user.username);
      if (!plan) {
        return new Response(
          JSON.stringify({ error: 'Plan version not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ plan }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get list of plan versions
    const versions = await listPlanVersions(desireId, user.username);

    // Also include current plan from desire
    const currentPlan = desire.plan;
    const planHistory = desire.planHistory || [];

    return new Response(
      JSON.stringify({
        versions,
        currentPlan,
        planHistory,
        desireId,
        desireTitle: desire.title,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API] Plans error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * PUT /api/agency/plans
 * Update a plan for a desire (select a different version or edit)
 * Body: { desireId: string, plan: DesirePlan }
 */
export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to update plans.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { desireId, plan } = body as { desireId: string; plan: DesirePlan };

    if (!desireId || !plan) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: desireId, plan' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load desire
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Move current plan to history if it exists
    if (desire.plan) {
      if (!desire.planHistory) {
        desire.planHistory = [];
      }
      desire.planHistory.push(desire.plan);
    }

    // Set new plan
    desire.plan = plan;
    desire.updatedAt = new Date().toISOString();

    // Update metrics
    if (desire.metrics) {
      desire.metrics.planVersionCount++;
      desire.metrics.lastActivityAt = desire.updatedAt;
    }

    // Save desire with new plan
    await saveDesire(desire, user.username);

    // Also save to folder structure if enabled
    await savePlanToFolder(desireId, plan, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'plan_updated',
      actor: user.username,
      details: {
        desireId,
        planId: plan.id,
        version: plan.version,
      },
    });

    return new Response(JSON.stringify({ success: true, desire }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API] Plans update error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
