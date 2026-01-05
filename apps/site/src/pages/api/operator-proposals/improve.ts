/**
 * Submit Improvement Request API
 *
 * POST: Submit user improvement suggestion that triggers System Coder
 * Body: { proposalId: string, userInput: string, rating?: string, bigBrotherAnalysis?: string }
 *
 * Creates a coding request that Big Brother + System Coder can work on.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { submitImprovementRequest, getProposal } from '@metahuman/core';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { proposalId, userInput, rating, bigBrotherAnalysis } = body;

    if (!proposalId) {
      return new Response(
        JSON.stringify({ error: 'proposalId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!userInput || userInput.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'userInput is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get proposal to verify it exists
    const proposal = getProposal(user.username, proposalId);
    if (!proposal) {
      return new Response(
        JSON.stringify({ error: 'Proposal not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[API] Submitting improvement request for proposal ${proposalId}`);

    // Submit the improvement request
    const result = await submitImprovementRequest(
      user.username,
      proposalId,
      userInput,
      {
        rating: rating as 'good' | 'neutral' | 'bad' | undefined,
        bigBrotherAnalysis,
      }
    );

    audit({
      category: 'action',
      level: 'info',
      event: 'improvement_request_submitted',
      actor: user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        success: result.success,
        requestId: result.requestId,
      },
    });

    return new Response(
      JSON.stringify({
        success: result.success,
        requestId: result.requestId,
        error: result.error,
        message: result.success
          ? 'Improvement request created. System Coder will process it.'
          : 'Failed to create improvement request',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API] operator-proposals/improve error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireWriteMode(handler);
