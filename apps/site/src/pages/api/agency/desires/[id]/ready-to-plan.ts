import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, loadDesire, saveDesireManifest, proposalEvents } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/ready-to-plan]';

/**
 * POST /api/agency/desires/:id/ready-to-plan
 * Mark a desire as ready to proceed from questioning to planning phase.
 *
 * This endpoint is used when the user has discussed the desire in the chat
 * and is ready to proceed with plan generation. The conversation context
 * (messages with replyToDesireId metadata) will be gathered by the planner.
 */
export const POST: APIRoute = async ({ params, cookies }) => {
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

    console.log(`${LOG_PREFIX} 📋 Ready to plan requested for desire: ${id}`);

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire is in questioning status
    if (desire.status !== 'questioning') {
      console.log(`${LOG_PREFIX} ⚠️ Desire not in questioning status: ${desire.status}`);
      return new Response(
        JSON.stringify({ error: `Cannot proceed from '${desire.status}' status. Expected 'questioning'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();

    // Update desire - mark questions as complete and transition to planning
    const updatedDesire = {
      ...desire,
      clarifyingQuestions: desire.clarifyingQuestions ? {
        ...desire.clarifyingQuestions,
        completedAt: now,
      } : undefined,
      status: 'planning' as const,
      currentStage: 'planning' as const,
      updatedAt: now,
    };

    console.log(`${LOG_PREFIX} ✅ Transitioning desire: questioning → planning`);
    await saveDesireManifest(updatedDesire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_ready_to_plan',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        hadQuestions: !!desire.clarifyingQuestions?.questions?.length,
      },
    });

    // Emit event to wake up the planning agent
    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'ready_to_plan',
      taskType: 'desire_plan',
    });
    console.log(`${LOG_PREFIX} 📢 Emitted proposal-resolved event to trigger planning`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      message: `Ready for planning. Generating plan for "${desire.title}"...`,
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
