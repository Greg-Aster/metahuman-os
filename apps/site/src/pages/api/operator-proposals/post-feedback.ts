/**
 * Post-Execution Feedback API
 *
 * POST: Submit feedback after a task completes
 * Body: { proposalId: string, rating: 'good' | 'neutral' | 'bad', comment?: string }
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { submitPostFeedback, getProposal } from '@metahuman/core';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { proposalId, rating, comment } = body;

    if (!proposalId || !rating) {
      return new Response(
        JSON.stringify({ error: 'proposalId and rating are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['good', 'neutral', 'bad'].includes(rating)) {
      return new Response(
        JSON.stringify({ error: 'rating must be good, neutral, or bad' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get proposal for context
    const proposal = getProposal(user.username, proposalId);
    if (!proposal) {
      return new Response(
        JSON.stringify({ error: 'Proposal not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Submit the feedback
    const success = submitPostFeedback(user.username, proposalId, rating, comment);

    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Failed to submit feedback' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'operator_post_feedback_submitted',
      actor: user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        rating,
        hasComment: !!comment,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Feedback recorded: ${rating}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API] operator-proposals/post-feedback error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireWriteMode(handler);
