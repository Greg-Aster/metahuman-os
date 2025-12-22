/**
 * Code Proposals API for Self-Healing
 *
 * GET: List pending code fix proposals
 * POST: Update proposal status (approve/reject)
 */

import type { APIRoute } from 'astro';
import {
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getAuthenticatedUser,
  AuthRequiredError,
  audit,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const proposals = loadPendingProposals(user.username);

    return new Response(JSON.stringify({ proposals }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ proposals: [], message: 'Login required to view proposals' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[active-operator/proposals] GET error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    // Require authentication for proposal actions
    const user = getAuthenticatedUser(cookies);

    // Only owner can manage proposals
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owner can manage code proposals' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { action, proposalId } = body;

    if (!action || !['approve', 'reject', 'scan'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use: approve, reject, scan' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let result: { success: boolean; message: string; data?: unknown };

    switch (action) {
      case 'approve':
        if (!proposalId) {
          return new Response(
            JSON.stringify({ error: 'proposalId required for approve action' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const approved = updateProposalStatus(proposalId, 'approved', user.username);
        result = {
          success: approved,
          message: approved ? `Proposal ${proposalId} approved` : 'Proposal not found',
        };
        break;

      case 'reject':
        if (!proposalId) {
          return new Response(
            JSON.stringify({ error: 'proposalId required for reject action' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const rejected = updateProposalStatus(proposalId, 'rejected', user.username);
        result = {
          success: rejected,
          message: rejected ? `Proposal ${proposalId} rejected` : 'Proposal not found',
        };
        break;

      case 'scan':
        // Trigger a new self-healing scan
        const scanResult = await runSelfHealing(user.username, body.maxErrors || 5);
        result = {
          success: true,
          message: `Found ${scanResult.errorsFound} errors, created ${scanResult.proposalsCreated} proposals`,
          data: {
            errorsFound: scanResult.errorsFound,
            proposalsCreated: scanResult.proposalsCreated,
          },
        };
        break;

      default:
        result = { success: false, message: 'Unknown action' };
    }

    audit({
      category: 'system',
      level: 'info',
      event: 'code_proposal_action',
      actor: user.username,
      details: {
        action,
        proposalId,
        result: result.success,
      },
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[active-operator/proposals] POST error:', error);

    if ((error as Error).message.includes('Not authenticated')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
