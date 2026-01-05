/**
 * Big Brother Execution Review API
 *
 * POST: Trigger Big Brother review of a task execution
 * Body: { proposalId: string }
 *
 * Returns analysis and suggestions that can lead to code improvements.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { triggerBigBrotherExecutionReview, getProposal } from '@metahuman/core';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { proposalId } = body;

    if (!proposalId) {
      return new Response(
        JSON.stringify({ error: 'proposalId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get proposal to verify it exists and is executed
    const proposal = getProposal(user.username, proposalId);
    if (!proposal) {
      return new Response(
        JSON.stringify({ error: 'Proposal not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (proposal.status !== 'executed') {
      return new Response(
        JSON.stringify({ error: 'Proposal has not been executed yet' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[API] Triggering Big Brother review for proposal ${proposalId}`);

    // Trigger the review
    const result = await triggerBigBrotherExecutionReview(user.username, proposalId);

    audit({
      category: 'action',
      level: 'info',
      event: 'big_brother_review_requested',
      actor: user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        success: result.success,
      },
    });

    return new Response(
      JSON.stringify({
        success: result.success,
        analysis: result.analysis,
        suggestions: result.suggestions,
        improvementOpportunities: result.improvementOpportunities,
        codeChangeRecommended: result.codeChangeRecommended,
        error: result.error,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API] operator-proposals/review error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireWriteMode(handler);
