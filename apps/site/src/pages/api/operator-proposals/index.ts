/**
 * Operator Proposals API
 *
 * GET: List pending proposals + post-execution feedback requests
 * Human-in-the-Loop approval system for autonomous operator decisions
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthRequiredError } from '@metahuman/core';
import {
  getOperatorPendingProposals,
  getPendingPostFeedback,
  getProposalStats,
  getUserTrustLevel,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Get pending proposals awaiting approval
    const proposals = getOperatorPendingProposals(user.username);

    // Get pending post-execution feedback requests
    const postFeedbackRequests = getPendingPostFeedback(user.username);

    // Get approval stats for context
    const stats = getProposalStats(user.username);

    // Get current trust level
    const trustLevel = getUserTrustLevel(user.username);

    return new Response(
      JSON.stringify({
        proposals,
        postFeedbackRequests,
        stats,
        trustLevel,
        counts: {
          pendingApprovals: proposals.length,
          pendingFeedback: postFeedbackRequests.length,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({
          proposals: [],
          postFeedbackRequests: [],
          stats: [],
          trustLevel: 'suggest',
          counts: { pendingApprovals: 0, pendingFeedback: 0 },
          message: 'Login required',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[API] operator-proposals error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
