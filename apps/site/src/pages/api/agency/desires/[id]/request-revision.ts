import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, captureEvent, queueTTS } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire, addScratchpadEntryToFolder, type DesireStatus } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/request-revision]';

/**
 * POST /api/agency/desires/:id/request-revision
 * User requests revision of the outcome with feedback.
 * Used in the outcome review flow when the user wants changes.
 * Body: { feedback: string }
 *
 * This moves the desire back to 'planning' status with user feedback,
 * so it can be re-planned and re-executed.
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to request revision.' }),
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
        JSON.stringify({ error: 'Owner role required to request revision.' }),
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

    // Parse request body
    const body = await request.json();
    const { feedback } = body;

    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Feedback text is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 🔄 Revision requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Allow revision for desires that have been executed or are in review
    const revisableStatuses = ['executing', 'awaiting_review', 'outcome_review', 'completed'];
    if (!revisableStatuses.includes(desire.status)) {
      console.log(`${LOG_PREFIX} ❌ Wrong status: ${desire.status}`);
      return new Response(
        JSON.stringify({
          error: `Cannot request revision for desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;

    // Archive current plan to history if it exists
    const planHistory = desire.planHistory || [];
    if (desire.plan) {
      planHistory.push({
        ...desire.plan,
        archivedAt: now,
        archiveReason: 'user_revision_request',
      });
    }

    // Archive execution data to history
    const executionHistory = desire.executionHistory || [];
    if (desire.execution) {
      executionHistory.push({
        ...desire.execution,
        archivedAt: now,
        archiveReason: 'user_revision_request',
        userFeedback: feedback.trim(),
      });
    }

    // Update the desire
    const updatedDesire = {
      ...desire,
      status: 'planning' as DesireStatus,
      updatedAt: now,
      // Store feedback for the planner
      userCritique: feedback.trim(),
      critiqueAt: now,
      // Archive plan and execution
      planHistory,
      executionHistory,
      // Clear current execution since we're re-planning
      execution: undefined,
      // Update metrics
      metrics: desire.metrics ? {
        ...desire.metrics,
        userCritiqueCount: desire.metrics.userCritiqueCount + 1,
        cycleCount: desire.metrics.cycleCount + 1,
      } : undefined,
      // Update outcome review if it exists
      outcomeReview: desire.outcomeReview ? {
        ...desire.outcomeReview,
        verdict: 'retry' as const,
        userRequestedRevision: true,
        userRevisionFeedback: feedback.trim(),
        userRevisionAt: now,
      } : {
        id: `outcome-${desire.id}-${Date.now()}`,
        verdict: 'retry' as const,
        reasoning: 'User requested revision',
        successScore: 0.5,
        lessonsLearned: [feedback.trim()],
        reviewedAt: now,
        notifyUser: false,
        userRequestedRevision: true,
        userRevisionFeedback: feedback.trim(),
        userRevisionAt: now,
      },
    };

    // Move to planning status
    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_revision_requested',
      description: `User requested revision: ${feedback.trim().substring(0, 100)}${feedback.length > 100 ? '...' : ''}`,
      actor: user.username,
      data: {
        fromStatus: oldStatus,
        feedback: feedback.trim(),
        planVersion: desire.plan?.version || 1,
        executionAttempt: executionHistory.length,
      },
    }, user.username);

    // Audit the revision request
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_revision_requested',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        feedback: feedback.substring(0, 200),
        planVersion: desire.plan?.version || 1,
        executionAttemptCount: executionHistory.length,
      },
    });

    // Log to inner dialogue
    captureEvent(`The user wants me to revise "${desire.title}". Their feedback: "${feedback.trim()}"`, {
      type: 'inner_dialogue',
      tags: ['agency', 'revision', 'feedback', 'inner'],
      metadata: {
        source: 'user-revision-request',
        desireId: id,
        feedback: feedback.trim(),
      },
    });

    // Queue TTS
    queueTTS(
      user.username,
      `I'll revise my approach to "${desire.title}". Let me create a new plan based on your feedback.`,
      'inner',
      'outcome-review'
    );

    console.log(`${LOG_PREFIX} ✅ Desire moved to planning for revision`);

    return new Response(
      JSON.stringify({
        success: true,
        desire: updatedDesire,
        message: `Revision requested for "${desire.title}". A new plan will be generated incorporating your feedback.`,
        nextStep: 'The planner will automatically create a new plan. You can also manually trigger plan generation.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
