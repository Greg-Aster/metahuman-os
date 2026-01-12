import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { loadDesire, recordDesireCheckin } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/checkin]';

/**
 * POST /api/agency/desires/:id/checkin
 * Request a check-in for a long-running desire.
 * This queues a desire_checkin task for the active operator to evaluate progress.
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
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

    // Parse request body for options
    let force = false;
    try {
      const body = await request.json();
      force = body.force === true;
    } catch {
      // No body or invalid JSON - use defaults
    }

    console.log(`${LOG_PREFIX} 🔄 Check-in requested for: ${id} (force: ${force})`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify this is a long-running desire
    if (desire.goalType !== 'long_running') {
      console.log(`${LOG_PREFIX} ❌ Not a long-running desire: ${desire.goalType}`);
      return new Response(
        JSON.stringify({ error: 'Check-ins are only available for long-running goals.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);
    console.log(`${LOG_PREFIX}    Progress: ${desire.goalProgress?.progressPercent || 0}%`);
    console.log(`${LOG_PREFIX}    Current milestone: ${desire.goalProgress?.currentMilestone || 0}`);

    // Record that a check-in was requested
    await recordDesireCheckin(id, user.username, 'User-requested check-in');

    // Queue a desire_checkin task via the active operator API
    try {
      const operatorResponse = await fetch(`http://localhost:4321/api/active-operator/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': request.headers.get('Cookie') || '',
        },
        body: JSON.stringify({
          taskType: 'desire_checkin',
          payload: {
            type: 'desire_checkin',
            desireId: id,
            checkProgress: true,
            force: true,
          },
          priority: 'high',
        }),
      });

      if (!operatorResponse.ok) {
        console.warn(`${LOG_PREFIX} ⚠️ Failed to queue check-in task, but recorded the request`);
      } else {
        console.log(`${LOG_PREFIX} ✅ Check-in task queued`);
      }
    } catch (queueError) {
      console.warn(`${LOG_PREFIX} ⚠️ Could not queue check-in task:`, queueError);
      // Continue - we still recorded the check-in request
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_checkin_requested',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        progress: desire.goalProgress?.progressPercent || 0,
        currentMilestone: desire.goalProgress?.currentMilestone || 0,
        force,
      },
    });

    console.log(`${LOG_PREFIX} ✅ Check-in requested for "${desire.title}"`);

    return new Response(JSON.stringify({
      success: true,
      desireId: id,
      title: desire.title,
      message: `Check-in requested for "${desire.title}". The system will evaluate progress shortly.`,
      currentProgress: {
        percent: desire.goalProgress?.progressPercent || 0,
        currentMilestone: desire.goalProgress?.currentMilestone || 0,
        totalMilestones: desire.goalProgress?.totalMilestones || 0,
      },
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
