import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, captureEvent, queueTTS } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire, addScratchpadEntryToFolder } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/confirm-complete]';

/**
 * POST /api/agency/desires/:id/confirm-complete
 * User confirms the outcome is satisfactory and marks the desire as completed.
 * Used in the outcome review flow when the user approves the results.
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to confirm completion.' }),
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
        JSON.stringify({ error: 'Owner role required to confirm completion.' }),
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

    console.log(`${LOG_PREFIX} ✅ Confirming completion for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${desire.status})`);

    // Allow confirmation for desires that have been executed or are awaiting review
    const confirmableStatuses = ['executing', 'awaiting_review', 'outcome_review'];
    if (!confirmableStatuses.includes(desire.status)) {
      console.log(`${LOG_PREFIX} ❌ Wrong status: ${desire.status}`);
      return new Response(
        JSON.stringify({
          error: `Cannot confirm completion for desire in '${desire.status}' status. Must be in: ${confirmableStatuses.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;

    // Update the desire to completed status
    const updatedDesire = {
      ...desire,
      status: 'completed' as const,
      updatedAt: now,
      completedAt: now,
      // Update metrics to track user confirmation
      metrics: desire.metrics ? {
        ...desire.metrics,
        userApprovalCount: desire.metrics.userApprovalCount + 1,
        completionCount: desire.metrics.completionCount + 1,
      } : undefined,
      // Mark as user-confirmed completion
      outcomeReview: desire.outcomeReview ? {
        ...desire.outcomeReview,
        userConfirmed: true,
        userConfirmedAt: now,
        verdict: 'completed' as const,
      } : {
        id: `outcome-${desire.id}-${Date.now()}`,
        verdict: 'completed' as const,
        reasoning: 'User confirmed outcome is satisfactory',
        successScore: 1.0,
        lessonsLearned: [],
        reviewedAt: now,
        notifyUser: false,
        userConfirmed: true,
        userConfirmedAt: now,
      },
    };

    // Move to completed status
    await moveDesire(updatedDesire, oldStatus, 'completed', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_confirmed_complete',
      description: 'User confirmed the outcome is satisfactory',
      actor: user.username,
      data: { fromStatus: oldStatus },
    }, user.username);

    // Audit the confirmation
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_user_confirmed_complete',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
      },
    });

    // Log to inner dialogue
    captureEvent(`My desire "${desire.title}" has been confirmed complete by the user!`, {
      type: 'inner_dialogue',
      tags: ['agency', 'outcome', 'confirmed', 'inner'],
      metadata: {
        source: 'user-confirmation',
        desireId: id,
      },
    });

    // Queue TTS
    queueTTS(user.username, `My desire "${desire.title}" is complete!`, 'inner', 'outcome-review');

    console.log(`${LOG_PREFIX} ✅ Desire marked as completed`);

    return new Response(
      JSON.stringify({
        success: true,
        desire: updatedDesire,
        message: `"${desire.title}" marked as complete. Great work!`,
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
