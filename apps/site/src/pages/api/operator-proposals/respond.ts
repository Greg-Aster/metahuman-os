/**
 * Respond to Operator Proposal API
 *
 * POST: Approve, reject, or modify a proposal
 * Body: { proposalId: string, response: 'approved' | 'rejected' | 'modified', userInput?: string }
 *
 * When a proposal is approved, the task is executed immediately.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { respondToProposal, getProposal, markProposalExecuted } from '@metahuman/core';
import { executeTask, type QueuedTask, type TaskType } from '@metahuman/core';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { proposalId, response, userInput } = body;

    if (!proposalId || !response) {
      return new Response(
        JSON.stringify({ error: 'proposalId and response are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['approved', 'rejected', 'modified'].includes(response)) {
      return new Response(
        JSON.stringify({ error: 'response must be approved, rejected, or modified' }),
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

    // Respond to the proposal
    const updatedProposal = respondToProposal(
      user.username,
      proposalId,
      response,
      userInput
    );

    if (!updatedProposal) {
      return new Response(
        JSON.stringify({ error: 'Failed to respond to proposal' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'operator_proposal_user_response',
      actor: user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        response,
        hasUserInput: !!userInput,
      },
    });

    // If approved, execute the task immediately
    let executionResult = null;
    if (response === 'approved') {
      try {
        console.log(`[API] Executing approved task: ${proposal.taskType}`);

        // Create a queued task object for the executor
        const queuedTask: QueuedTask = {
          id: `proposal-${proposalId}`,
          type: proposal.taskType as TaskType,
          priority: 'normal',
          queuedAt: new Date().toISOString(),
          payload: {
            type: proposal.taskType,
            _reasoning: proposal.reasoning,
            _userApproved: true,
            _proposalId: proposalId,
          } as any,
          username: user.username,
        };

        // Execute the task
        const result = await executeTask(queuedTask);
        executionResult = {
          success: result.success,
          summary: result.data ? JSON.stringify(result.data).slice(0, 200) : undefined,
          error: result.error,
        };

        // Mark proposal as executed with result
        markProposalExecuted(user.username, proposalId, executionResult);

        audit({
          category: 'action',
          level: result.success ? 'info' : 'warn',
          event: 'operator_proposal_executed',
          actor: user.username,
          details: {
            proposalId,
            taskType: proposal.taskType,
            success: result.success,
            error: result.error,
          },
        });

        console.log(`[API] Task ${proposal.taskType} execution: success=${result.success}`);
      } catch (execError) {
        console.error(`[API] Task execution error:`, execError);
        executionResult = {
          success: false,
          error: (execError as Error).message,
        };
        markProposalExecuted(user.username, proposalId, executionResult);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        proposal: updatedProposal,
        message: `Proposal ${response}`,
        executionResult,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API] operator-proposals/respond error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = requireWriteMode(handler);
