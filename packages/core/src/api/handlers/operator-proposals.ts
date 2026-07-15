/**
 * Operator Proposal API Handlers
 *
 * Human-in-the-loop approval and feedback endpoints for autonomous operator
 * decisions.
 */

import {
  getOperatorPendingProposals,
  getPendingPostFeedback,
  getProposal,
  getProposalStats,
  getUserTrustLevel,
  proposalEvents,
  respondToProposal,
  submitImprovementRequest,
  submitPostFeedback,
  triggerBigBrotherExecutionReview,
} from '../../active-operator/index.js';
import { audit } from '../../audit.js';
import { DEFAULT_HANDLERS, ensureQueueSystemStarted } from '../../queue/index.js';
import type { TaskType } from '../../queue/types.js';
import { getSecurityPolicy, SecurityError } from '../../security-policy.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';

type ProposalResponseBody = {
  proposalId?: string;
  response?: 'approved' | 'rejected' | 'modified';
  userInput?: string;
};

const COORDINATED_PROPOSAL_TYPES = new Set<TaskType>([
  'reflect',
  'dream',
  'curiosity',
  'inner_curiosity',
  'memory_curate',
  'training_curate',
  'index_build',
  'desire_generate',
  'desire_execute',
  'psychoanalyze',
  'code_analyze',
  'custom',
]);

function json(data: Record<string, unknown>, status = 200, headers?: Record<string, string>): UnifiedResponse {
  return { status, data, headers };
}

function errorData(error: string, status: number): UnifiedResponse {
  return json({ error }, status);
}

function serverError(scope: string, error: unknown): UnifiedResponse {
  console.error(`[${scope}] error:`, error);
  return errorData((error as Error).message, 500);
}

function requireWrite(scope: string): UnifiedResponse | null {
  try {
    getSecurityPolicy().requireWrite();
    return null;
  } catch (error) {
    if (error instanceof SecurityError) {
      audit({
        level: 'warn',
        category: 'security',
        event: 'write_attempt_blocked',
        details: {
          endpoint: `/api/${scope}`,
          method: 'POST',
          ...error.details,
        },
        actor: 'security_middleware',
      });

      return {
        status: 403,
        data: {
          error: error.message,
          ...error.details,
          hint: error.details.reason === 'read_only_mode'
            ? 'Switch to dual or agent mode to enable write operations'
            : 'Insufficient permissions for this operation',
        },
        headers: { 'X-Security-Blocked': 'true' },
      };
    }

    throw error;
  }
}

function sseEvent(eventType: string, data: object): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * GET /api/operator-proposals
 */
export async function handleGetOperatorProposals(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return json({
        proposals: [],
        postFeedbackRequests: [],
        stats: [],
        trustLevel: 'suggest',
        counts: { pendingApprovals: 0, pendingFeedback: 0 },
        message: 'Login required',
      });
    }

    const proposals = getOperatorPendingProposals(req.user.username);
    const postFeedbackRequests = getPendingPostFeedback(req.user.username);
    const stats = getProposalStats(req.user.username);
    const trustLevel = getUserTrustLevel(req.user.username);

    return json({
      proposals,
      postFeedbackRequests,
      stats,
      trustLevel,
      counts: {
        pendingApprovals: proposals.length,
        pendingFeedback: postFeedbackRequests.length,
      },
    });
  } catch (error) {
    return serverError('operator-proposals', error);
  }
}

/**
 * POST /api/operator-proposals/respond
 */
export async function handleRespondToOperatorProposal(req: UnifiedRequest): Promise<UnifiedResponse> {
  const writeError = requireWrite('operator-proposals/respond');
  if (writeError) return writeError;

  try {
    if (!req.user.isAuthenticated) {
      return errorData('Authentication required', 403);
    }

    const { proposalId, response, userInput } = (req.body || {}) as ProposalResponseBody;

    if (!proposalId || !response) {
      return errorData('proposalId and response are required', 400);
    }

    if (!['approved', 'rejected', 'modified'].includes(response)) {
      return errorData('response must be approved, rejected, or modified', 400);
    }

    const proposal = getProposal(req.user.username, proposalId);
    if (!proposal) {
      return errorData('Proposal not found', 404);
    }

    if (response === 'approved' && !COORDINATED_PROPOSAL_TYPES.has(proposal.taskType as TaskType)) {
      return errorData(`Proposal task type is not supported by the work coordinator: ${proposal.taskType}`, 409);
    }

    const updatedProposal = respondToProposal(req.user.username, proposalId, response, userInput);
    if (!updatedProposal) {
      return errorData('Failed to respond to proposal', 500);
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'operator_proposal_user_response',
      actor: req.user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        response,
        hasUserInput: !!userInput,
      },
    });

    let executionResult: { success: boolean; summary?: string; error?: string; taskId?: string } | null = null;
    if (response === 'approved') {
      try {
        const type = proposal.taskType as TaskType;
        const system = await ensureQueueSystemStarted();
        const task = system.enqueue({
          type,
          handler: DEFAULT_HANDLERS[type],
          source: 'user',
          priority: 'normal',
          input: {
            reasoning: proposal.reasoning,
            userApproved: true,
            proposalId,
          },
          username: req.user.username,
          idempotencyKey: `approved-proposal:${proposalId}`,
          metadata: { producer: 'operator-proposal-approval' },
        });
        executionResult = {
          success: true,
          taskId: task.id,
          summary: `Queued as coordinator work ${task.id}`,
        };

        audit({
          category: 'action',
          level: 'info',
          event: 'operator_proposal_enqueued',
          actor: req.user.username,
          details: {
            proposalId,
            taskType: proposal.taskType,
            taskId: task.id,
          },
        });
      } catch (execError) {
        console.error('[operator-proposals/respond] Work enqueue error:', execError);
        executionResult = {
          success: false,
          error: (execError as Error).message,
        };
      }
    }

    return json({
      success: true,
      proposal: updatedProposal,
      message: `Proposal ${response}`,
      executionResult,
    });
  } catch (error) {
    return serverError('operator-proposals/respond', error);
  }
}

/**
 * POST /api/operator-proposals/post-feedback
 */
export async function handlePostOperatorProposalFeedback(req: UnifiedRequest): Promise<UnifiedResponse> {
  const writeError = requireWrite('operator-proposals/post-feedback');
  if (writeError) return writeError;

  try {
    if (!req.user.isAuthenticated) {
      return errorData('Authentication required', 403);
    }

    const { proposalId, rating, comment } = (req.body || {}) as {
      proposalId?: string;
      rating?: 'good' | 'neutral' | 'bad';
      comment?: string;
    };

    if (!proposalId || !rating) {
      return errorData('proposalId and rating are required', 400);
    }

    if (!['good', 'neutral', 'bad'].includes(rating)) {
      return errorData('rating must be good, neutral, or bad', 400);
    }

    const proposal = getProposal(req.user.username, proposalId);
    if (!proposal) {
      return errorData('Proposal not found', 404);
    }

    const success = submitPostFeedback(req.user.username, proposalId, rating, comment);
    if (!success) {
      return errorData('Failed to submit feedback', 500);
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'operator_post_feedback_submitted',
      actor: req.user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        rating,
        hasComment: !!comment,
      },
    });

    return json({
      success: true,
      message: `Feedback recorded: ${rating}`,
    });
  } catch (error) {
    return serverError('operator-proposals/post-feedback', error);
  }
}

/**
 * POST /api/operator-proposals/review
 */
export async function handleReviewOperatorProposal(req: UnifiedRequest): Promise<UnifiedResponse> {
  const writeError = requireWrite('operator-proposals/review');
  if (writeError) return writeError;

  try {
    if (!req.user.isAuthenticated) {
      return errorData('Authentication required', 403);
    }

    const { proposalId } = (req.body || {}) as { proposalId?: string };

    if (!proposalId) {
      return errorData('proposalId is required', 400);
    }

    const proposal = getProposal(req.user.username, proposalId);
    if (!proposal) {
      return errorData('Proposal not found', 404);
    }

    if (proposal.status !== 'executed') {
      return errorData('Proposal has not been executed yet', 400);
    }

    console.log(`[operator-proposals/review] Triggering Big Brother review for proposal ${proposalId}`);
    const result = await triggerBigBrotherExecutionReview(req.user.username, proposalId);

    audit({
      category: 'action',
      level: 'info',
      event: 'big_brother_review_requested',
      actor: req.user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        success: result.success,
      },
    });

    return json({
      success: result.success,
      analysis: result.analysis,
      suggestions: result.suggestions,
      improvementOpportunities: result.improvementOpportunities,
      codeChangeRecommended: result.codeChangeRecommended,
      error: result.error,
    });
  } catch (error) {
    return serverError('operator-proposals/review', error);
  }
}

/**
 * POST /api/operator-proposals/improve
 */
export async function handleImproveOperatorProposal(req: UnifiedRequest): Promise<UnifiedResponse> {
  const writeError = requireWrite('operator-proposals/improve');
  if (writeError) return writeError;

  try {
    if (!req.user.isAuthenticated) {
      return errorData('Authentication required', 403);
    }

    const { proposalId, userInput, rating, bigBrotherAnalysis } = (req.body || {}) as {
      proposalId?: string;
      userInput?: string;
      rating?: 'good' | 'neutral' | 'bad';
      bigBrotherAnalysis?: string;
    };

    if (!proposalId) {
      return errorData('proposalId is required', 400);
    }

    if (!userInput || userInput.trim().length === 0) {
      return errorData('userInput is required', 400);
    }

    const proposal = getProposal(req.user.username, proposalId);
    if (!proposal) {
      return errorData('Proposal not found', 404);
    }

    console.log(`[operator-proposals/improve] Submitting improvement request for proposal ${proposalId}`);
    const result = await submitImprovementRequest(
      req.user.username,
      proposalId,
      userInput,
      {
        rating,
        bigBrotherAnalysis,
      },
    );

    audit({
      category: 'action',
      level: 'info',
      event: 'improvement_request_submitted',
      actor: req.user.username,
      details: {
        proposalId,
        taskType: proposal.taskType,
        success: result.success,
        requestId: result.requestId,
      },
    });

    return json({
      success: result.success,
      requestId: result.requestId,
      error: result.error,
      message: result.success
        ? 'Improvement request created. System Coder will process it.'
        : 'Failed to create improvement request',
    });
  } catch (error) {
    return serverError('operator-proposals/improve', error);
  }
}

/**
 * GET /api/operator-proposals/stream
 */
export async function handleOperatorProposalsStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return errorData('Authentication required', 401);
  }

  const username = req.user.username;

  async function* generateStream(): AsyncIterable<string> {
    let isClosed = false;
    const eventQueue: string[] = [];

    const queueEvent = (eventType: string, data: object) => {
      if (isClosed) return;
      eventQueue.push(sseEvent(eventType, data));
    };

    const sendCurrentState = () => {
      if (isClosed) return;
      try {
        const proposals = getOperatorPendingProposals(username);
        const postFeedbackRequests = getPendingPostFeedback(username);

        queueEvent('state', {
          proposals,
          postFeedbackRequests,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('[proposals-stream] Error fetching state:', error);
      }
    };

    const onProposalCreated = (event: {
      username: string;
      proposalId: string;
      taskType: string;
      proposal: unknown;
    }) => {
      if (event.username !== username) return;
      queueEvent('proposal-created', {
        proposalId: event.proposalId,
        taskType: event.taskType,
        proposal: event.proposal,
        timestamp: new Date().toISOString(),
      });
    };

    const onProposalResolved = (event: {
      username: string;
      proposalId: string;
      response: string;
      taskType: string;
    }) => {
      if (event.username !== username) return;
      queueEvent('proposal-resolved', {
        proposalId: event.proposalId,
        taskType: event.taskType,
        response: event.response,
        timestamp: new Date().toISOString(),
      });
      sendCurrentState();
    };

    proposalEvents.on('proposal-created', onProposalCreated);
    proposalEvents.on('proposal-resolved', onProposalResolved);

    try {
      yield sseEvent('connected', { timestamp: new Date().toISOString() });
      sendCurrentState();

      while (!isClosed) {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }

        if (req.signal?.aborted) {
          isClosed = true;
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally {
      isClosed = true;
      proposalEvents.off('proposal-created', onProposalCreated);
      proposalEvents.off('proposal-resolved', onProposalResolved);
    }
  }

  return {
    status: 200,
    stream: generateStream(),
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  };
}
