import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, type Desire } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/retry]';

/**
 * POST /api/agency/desires/:id/retry
 * Retry a failed desire by moving it back to planning with failure context
 *
 * This endpoint:
 * 1. Preserves the outcome review as critique for the plan generator
 * 2. Keeps the failure context (lessons learned, suggestions)
 * 3. Moves the desire to 'planning' status for a new attempt
 * 4. Increments relevant metrics
 *
 * Use cases:
 * - Failed desire that the user wants to retry with improved plan
 * - Desire stuck after execution failure
 * - Iterative refinement after system or external errors
 */
export const POST: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to retry desires.' }),
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
        JSON.stringify({ error: 'Owner role required to retry desires.' }),
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

    console.log(`${LOG_PREFIX} 🔄 Retry requested for: ${id}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const oldStatus = desire.status;
    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${oldStatus})`);

    // Check if this is actually a failed/completed desire that can be retried
    const retryableStatuses = ['failed', 'completed', 'rejected', 'abandoned', 'executing'];
    if (!retryableStatuses.includes(oldStatus)) {
      console.log(`${LOG_PREFIX} ⚠️ Desire not in retryable status: ${oldStatus}`);
      return new Response(
        JSON.stringify({
          error: `Cannot retry desire in '${oldStatus}' status. Retryable statuses: ${retryableStatuses.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build critique from outcome review if available
    let critique = desire.userCritique || '';
    const review = desire.outcomeReview;
    if (review) {
      const critiqueParts = [
        '=== RETRY REQUESTED BY USER ===',
        '',
        `Previous Outcome (${review.reviewedAt || 'unknown date'}):`,
        `- Verdict: ${review.verdict}`,
        `- Success Score: ${((review.successScore || 0) * 100).toFixed(0)}%`,
        `- Failure Category: ${review.failureCategory || 'unknown'}`,
      ];

      if (review.errorType) {
        critiqueParts.push(`- Error Type: ${review.errorType}`);
      }
      if (review.reasoning) {
        critiqueParts.push('', `Reasoning: ${review.reasoning}`);
      }
      if (review.lessonsLearned?.length) {
        critiqueParts.push('', 'Lessons Learned:');
        review.lessonsLearned.forEach(lesson => critiqueParts.push(`  • ${lesson}`));
      }
      if (review.nextAttemptSuggestions?.length) {
        critiqueParts.push('', 'Suggestions for Next Attempt:');
        review.nextAttemptSuggestions.forEach(s => critiqueParts.push(`  → ${s}`));
      }
      if (review.isFixableBug && review.suggestedFix) {
        critiqueParts.push('', `⚠️ SYSTEM BUG DETECTED: ${review.suggestedFix}`);
      }

      critique = critiqueParts.join('\n');
    }

    // Build the retry desire
    const now = new Date().toISOString();
    const failCount = (desire.metrics?.executionFailCount || 0) + 1;

    const retryDesire: Desire = {
      ...desire,
      status: 'planning' as const,
      userCritique: critique,
      // Clear execution data for fresh attempt
      execution: undefined,
      // Keep the outcome review for reference
      outcomeReview: review,
      // Update metrics
      metrics: {
        ...desire.metrics,
        executionFailCount: failCount,
        lastActivityAt: now,
      },
      // Reset stage tracking
      currentStage: 'planning',
      updatedAt: now,
    };

    // Move the desire back to planning
    console.log(`${LOG_PREFIX} 📦 Moving ${oldStatus} → planning (attempt #${failCount + 1})`);
    await moveDesire(retryDesire, oldStatus, 'planning', user.username);

    // Audit the retry
    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_retry',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        oldStatus,
        newStatus: 'planning',
        attemptNumber: failCount + 1,
        failureCategory: review?.failureCategory,
        wasFixableBug: review?.isFixableBug,
        reason: 'user_retry',
      },
    });

    console.log(`${LOG_PREFIX} ✅ Retry initiated: ${oldStatus} → planning`);

    return new Response(JSON.stringify({
      success: true,
      desire: retryDesire,
      message: `🔄 Retrying "${desire.title}" (attempt #${failCount + 1}). Moved to planning with failure context.`,
      attemptNumber: failCount + 1,
      failureCategory: review?.failureCategory,
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
