/**
 * Agency API Handlers
 *
 * Unified handlers for the agency system (desires, plans, etc.)
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  listDesiresByStatus,
  listActiveDesires,
  listPendingDesires,
  listAllDesires,
  loadDesire,
  saveDesire,
  deleteDesire,
  moveDesire,
  createDesireFolder,
  saveDesireManifest,
  addScratchpadEntryToFolder,
  loadExecutionAttempts,
  loadExecutionAttempt,
  generateDesireId,
  initializeDesireMetrics,
  initializeScratchpadSummary,
  initializeStageIterations,
  getSourceWeight,
  executeDesireViaGraph,
  recordDesireCheckin,
  type Desire,
  type DesireExecution,
  type DesireStatus,
  type DesireGoalType,
  type DesireStage,
  type ClarifyingAnswer,
} from '../../agency/index.js';
import { proposalEvents } from '../../active-operator/index.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import { queueTTS } from '../../nodes/output/tts.node.js';
import { appendAgencyMessageToConversation } from '../../conversation-buffer.js';

// Valid DesireStatus values from types.ts
const ALL_STATUSES: DesireStatus[] = [
  'nascent', 'pending', 'evaluating', 'planning', 'reviewing', 'awaiting_approval',
  'approved', 'executing', 'awaiting_review', 'completed', 'rejected', 'abandoned', 'failed'
];

// Legacy/invalid statuses that might exist in old data - map them to valid statuses
const LEGACY_STATUS_MAP: Record<string, DesireStatus> = {
  'executed': 'completed',  // "executed" was used before, should be "completed"
  'active': 'executing',    // "active" was used before, should be "executing"
};

const VALID_ADVANCE_TRANSITIONS: Record<string, string[]> = {
  nascent: ['pending', 'planning', 'reviewing', 'approved', 'abandoned'],
  pending: ['planning', 'reviewing', 'approved', 'abandoned'],
  evaluating: ['planning', 'reviewing', 'approved', 'abandoned'],
  planning: ['reviewing', 'approved', 'abandoned'],
  reviewing: ['planning', 'approved', 'abandoned'],
  approved: ['executing', 'planning', 'abandoned'],
  awaiting_approval: ['approved', 'planning', 'abandoned'],
  executing: ['abandoned'],
  awaiting_review: ['abandoned'],
  completed: ['abandoned'],
  failed: ['pending', 'abandoned'],
  rejected: ['pending'],
  abandoned: ['pending'],
};

function stageForResetTarget(status: DesireStatus): DesireStage {
  switch (status) {
    case 'nascent':
      return 'nascent';
    case 'pending':
      return 'strengthening';
    case 'planning':
      return 'planning';
    case 'reviewing':
      return 'plan_review';
    case 'approved':
      return 'user_approval';
    default:
      return 'planning';
  }
}

/**
 * Normalize a desire's status if it has a legacy/invalid value.
 * Also auto-saves the fix to prevent future issues.
 */
async function normalizeDesireStatus(desire: Desire, username?: string): Promise<Desire> {
  const currentStatus = desire.status as string;

  // Check if this is a legacy status that needs fixing
  if (LEGACY_STATUS_MAP[currentStatus]) {
    const newStatus = LEGACY_STATUS_MAP[currentStatus];
    console.log(`[agency-handler] Fixing legacy status: ${desire.id} "${currentStatus}" → "${newStatus}"`);

    desire.status = newStatus;
    desire.updatedAt = new Date().toISOString();

    // Save the fixed desire
    try {
      await saveDesire(desire, username);
    } catch (err) {
      console.warn(`[agency-handler] Could not auto-save fixed status for ${desire.id}:`, err);
    }
  }

  return desire;
}

/**
 * GET /api/agency/desires - List desires
 *
 * Query params:
 *   - status: filter by status ('all', 'active', 'pending', or comma-separated list)
 */
export async function handleListDesires(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view desires',
    };
  }

  try {
    const statusParam = query?.status || 'all';
    let desires: Desire[];

    if (statusParam === 'all') {
      // Use listAllDesires which includes desires from both folder-based storage
      // AND legacy status directories (handles desires with invalid/old statuses)
      desires = await listAllDesires(user.username);
    } else if (statusParam.includes(',')) {
      // Comma-separated list of statuses
      const statuses = statusParam.split(',').map(s => s.trim()) as DesireStatus[];
      desires = [];
      for (const s of statuses) {
        if (ALL_STATUSES.includes(s)) {
          const d = await listDesiresByStatus(s, user.username);
          desires.push(...d);
        }
      }
    } else if (statusParam === 'active') {
      desires = await listActiveDesires(user.username);
    } else if (statusParam === 'pending') {
      desires = await listPendingDesires(user.username);
    } else {
      desires = await listDesiresByStatus(statusParam as DesireStatus, user.username);
    }

    // Normalize any desires with legacy statuses
    desires = await Promise.all(
      desires.map(d => normalizeDesireStatus(d, user.username))
    );

    // Sort by createdAt descending
    desires.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return successResponse({
      desires,
      count: desires.length,
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * GET /api/agency/desires/:id - Get a single desire
 */
export async function handleGetDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view desire',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    return successResponse({ desire });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires - Create a new desire
 *
 * Body: { title, description, reason?, risk?, source? }
 */
export async function handleCreateDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to create desires',
    };
  }

  const {
    title,
    description,
    reason,
    risk = 'low',
    source = 'persona_goal',
    // Advanced options
    goalType = 'one_time',
    strength: initialStrength = 0.8,
    status: initialStatus = 'pending',
    decayRate: customDecayRate = 0.03,
    completionCriteria,
    tags = [],
  } = (body || {}) as {
    title?: string;
    description?: string;
    reason?: string;
    risk?: Desire['risk'];
    source?: Desire['source'];
    // Advanced options
    goalType?: DesireGoalType;
    strength?: number;
    status?: 'nascent' | 'pending';
    decayRate?: number;
    completionCriteria?: string;
    tags?: string[];
  };

  if (!title || !description) {
    return {
      status: 400,
      error: 'Missing required fields: title, description',
    };
  }

  // Validate and clamp strength to valid range
  const strength = Math.max(0, Math.min(1, initialStrength));

  // Validate status - only allow nascent or pending for new desires
  const status: DesireStatus = initialStatus === 'nascent' ? 'nascent' : 'pending';

  // Map status to stage
  const currentStage: DesireStage = status === 'nascent' ? 'nascent' : 'strengthening';

  try {
    const now = new Date().toISOString();
    const desire: Desire = {
      id: generateDesireId(),
      title,
      description,
      reason: reason || 'User-created desire',
      source,
      sourceId: `manual-${Date.now()}`,
      status,
      currentStage,
      stageIterations: initializeStageIterations(),
      strength,
      baseWeight: await getSourceWeight(source),
      threshold: 0.7,
      decayRate: Math.max(0.001, Math.min(0.1, customDecayRate)), // Clamp decay rate
      lastReviewedAt: now,
      reinforcements: 0,
      runCount: status === 'nascent' ? 0 : 1,
      risk,
      requiredTrustLevel: risk === 'high' || risk === 'critical' ? 'bounded_auto' : 'supervised_auto',
      metrics: {
        ...initializeDesireMetrics(),
        peakStrength: strength,
        lastActivityAt: now,
      },
      scratchpad: initializeScratchpadSummary(),
      createdAt: now,
      updatedAt: now,
      // Advanced options
      goalType,
      completionCriteria: completionCriteria || (goalType === 'recurring'
        ? 'This is a recurring desire - it cycles continuously and is never fully complete.'
        : undefined),
      tags: tags.length > 0 ? tags : undefined,
      userId: user.username,
    };

    // Save to flat-file storage
    await saveDesire(desire, user.username);

    // Create folder-based storage structure
    await createDesireFolder(desire.id, user.username);
    await saveDesireManifest(desire, user.username);

    // Add initial scratchpad entry
    await addScratchpadEntryToFolder(desire.id, {
      timestamp: now,
      type: 'origin',
      description: `Desire "${title}" created manually by ${user.username}`,
      actor: 'user',
      data: {
        source,
        risk,
        initialStrength: desire.strength,
        initialStatus: desire.status,
        goalType: desire.goalType,
        decayRate: desire.decayRate,
        username: user.username,
      },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_created_manually',
      actor: user.username,
      details: {
        desireId: desire.id,
        title: desire.title,
      },
    });

    console.log(`[agency-handler] Desire created: "${desire.title}" (${desire.id})`);

    return {
      status: 201,
      data: { desire, success: true },
    };
  } catch (error) {
    console.error('[agency-handler] Error creating desire:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * PUT /api/agency/desires/:id - Update a desire
 *
 * Body: Partial desire fields
 */
export async function handleUpdateDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to update desire',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const updates = (body || {}) as Partial<Desire>;
    const now = new Date().toISOString();
    const oldStatus = desire.status;

    const updatedDesire: Desire = {
      ...desire,
      ...updates,
      id: desire.id, // Don't allow changing ID
      updatedAt: now,
    };

    // If status changed, use moveDesire
    if (updates.status && updates.status !== oldStatus) {
      await moveDesire(updatedDesire, oldStatus, updates.status as DesireStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_updated',
      actor: user.username,
      details: {
        desireId: id,
        updates: Object.keys(updates),
      },
    });

    return successResponse({ desire: updatedDesire, success: true });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * DELETE /api/agency/desires/:id - Delete a desire
 *
 * Only allowed for certain statuses
 */
export async function handleDeleteDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to delete desire',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    // All desires can be deleted at any stage - user has full control
    // (Previously restricted to certain statuses but user requested all deletable)

    await deleteDesire(desire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_deleted',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        status: desire.status,
      },
    });

    return successResponse({ success: true });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires/:id/approve - Approve a desire for execution
 */
export async function handleApproveDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to approve desires.',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to approve desires.',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const approvableStatuses: DesireStatus[] = [
      'nascent',
      'pending',
      'evaluating',
      'planning',
      'reviewing',
      'awaiting_approval',
    ];
    if (!approvableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot approve desire in '${desire.status}' status. Must be one of: ${approvableStatuses.join(', ')}.`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      status: 'approved',
      activatedAt: desire.activatedAt || now,
      updatedAt: now,
    };

    await moveDesire(updatedDesire, oldStatus, 'approved', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_approved',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        approvedBy: user.username,
        hadPlan: !!desire.plan,
        fromStatus: oldStatus,
      },
    });

    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'approved',
      taskType: 'desire_execute',
    });

    let autoExecuted = false;
    if (desire.plan?.steps?.length) {
      const executingDesire: Desire = {
        ...updatedDesire,
        status: 'executing',
        updatedAt: new Date().toISOString(),
      };

      await moveDesire(executingDesire, 'approved', 'executing', user.username);

      executeDesireViaGraph(executingDesire, user.username)
        .then((result) => {
          console.log(`[agency-handler] Auto-execution complete for "${desire.title}": success=${result.success}`);
          if (result.error) {
            console.error(`[agency-handler] Auto-execution error for "${desire.title}": ${result.error}`);
          }
        })
        .catch((err) => {
          console.error(`[agency-handler] Auto-execution failed for "${desire.title}":`, err);
        });

      autoExecuted = true;
      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_auto_executed',
        actor: user.username,
        details: {
          desireId: id,
          title: desire.title,
          planSteps: desire.plan.steps.length,
        },
      });
    }

    return successResponse({
      desire: autoExecuted ? { ...updatedDesire, status: 'executing' } : updatedDesire,
      success: true,
      autoExecuted,
      message: autoExecuted
        ? `Approved and executing "${desire.title}" (${desire.plan?.steps?.length || 0} steps). Check inner dialogue for progress.`
        : `Approved "${desire.title}". Click Execute to run when ready.`,
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires/:id/reject - Reject a desire
 */
export async function handleRejectDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to reject desires.',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to reject desires.',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  const { reason: bodyReason } = (body || {}) as { reason?: string };
  const reason = bodyReason || 'User rejected';

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const rejectableStatuses: DesireStatus[] = [
      'reviewing',
      'awaiting_approval',
      'approved',
      'pending',
      'evaluating',
      'planning',
      'nascent',
    ];
    if (!rejectableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot reject desire in '${desire.status}' status.`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      status: 'rejected',
      completedAt: now,
      updatedAt: now,
      rejectionHistory: [
        ...(desire.rejectionHistory || []),
        {
          rejectedAt: now,
          rejectedBy: 'user',
          reason,
          canRetry: true,
        },
      ],
    };

    await moveDesire(updatedDesire, oldStatus, 'rejected', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_rejected',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        rejectedBy: user.username,
        reason,
      },
    });

    return successResponse({ desire: updatedDesire, success: true });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires/:id/reset - Reset a desire back to pending
 */
export async function handleResetDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to reset desires.',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to reset desires.',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  const targetStatus = (query?.target || 'planning') as DesireStatus;
  const validTargets: DesireStatus[] = ['nascent', 'pending', 'planning', 'reviewing', 'approved'];
  if (!validTargets.includes(targetStatus)) {
    return {
      status: 400,
      error: `Invalid target status: ${targetStatus}. Valid options: ${validTargets.join(', ')}`,
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const isStuck = desire.status === 'executing' && !!desire.execution?.startedAt;
    let stuckDuration = 0;
    if (isStuck) {
      const startedAt = new Date(desire.execution!.startedAt).getTime();
      stuckDuration = Math.floor((Date.now() - startedAt) / 1000 / 60);
    }

    const updatedDesire: Desire = {
      ...desire,
      status: targetStatus,
      currentStage: stageForResetTarget(targetStatus),
      updatedAt: now,
      execution: isStuck && desire.execution ? {
        ...desire.execution,
        // Preserve the legacy reset route payload until the execution status union is reconciled.
        status: 'aborted' as DesireExecution['status'],
        error: `Reset by user after ${stuckDuration} minutes`,
        completedAt: now,
      } : desire.execution,
      clarifyingQuestions: targetStatus === 'planning' ? undefined : desire.clarifyingQuestions,
    };

    await moveDesire(updatedDesire, oldStatus, targetStatus, user.username);

    audit({
      category: 'agent',
      level: 'warn',
      event: 'desire_reset',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        oldStatus,
        newStatus: targetStatus,
        wasStuck: isStuck,
        stuckDuration: isStuck ? stuckDuration : undefined,
        reason: 'manual_reset',
      },
    });

    const message = isStuck
      ? `Unstuck "${desire.title}" from executing (was stuck for ${stuckDuration}m). Moved to ${targetStatus}.`
      : `Reset "${desire.title}" from ${oldStatus} to ${targetStatus}.`;

    return successResponse({
      success: true,
      desire: updatedDesire,
      message,
      wasStuck: isStuck,
      stuckDuration,
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * GET /api/agency/desires/:id/executions - Get execution attempts for a desire.
 *
 * Query params:
 *   - attempt: specific attempt number (optional)
 */
export async function handleGetDesireExecutions(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required.',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const attemptParam = query?.attempt;
    if (attemptParam) {
      const attemptNumber = parseInt(attemptParam, 10);
      if (Number.isNaN(attemptNumber) || attemptNumber < 1) {
        return {
          status: 400,
          error: 'Invalid attempt number',
        };
      }

      const attempt = await loadExecutionAttempt(id, attemptNumber, user.username);
      if (!attempt) {
        return {
          status: 404,
          error: 'Execution attempt not found',
        };
      }

      return successResponse({
        desireId: id,
        attempt: attemptNumber,
        execution: attempt,
      });
    }

    const executions = await loadExecutionAttempts(id, user.username);
    return successResponse({
      desireId: id,
      total: executions.length,
      executions,
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires/:id/retry - Retry a failed desire
 *
 * This triggers the iterative refinement flow:
 * 1. Moves desire to 'planning' status
 * 2. Preserves failure context (outcomeReview, lessons learned)
 * 3. Planner will see the failure context and create an improved plan
 */
export async function handleRetryDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to retry desires.',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to retry desires.',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return {
        status: 404,
        error: 'Desire not found',
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;

    const retryableStatuses: DesireStatus[] = ['failed', 'completed', 'rejected', 'abandoned', 'executing'];
    if (!retryableStatuses.includes(oldStatus)) {
      return {
        status: 400,
        error: `Cannot retry desire in '${oldStatus}' status. Retryable statuses: ${retryableStatuses.join(', ')}`,
      };
    }

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
        review.lessonsLearned.forEach(lesson => critiqueParts.push(`  - ${lesson}`));
      }
      if (review.nextAttemptSuggestions?.length) {
        critiqueParts.push('', 'Suggestions for Next Attempt:');
        review.nextAttemptSuggestions.forEach(suggestion => critiqueParts.push(`  - ${suggestion}`));
      }
      if (review.isFixableBug && review.suggestedFix) {
        critiqueParts.push('', `SYSTEM BUG DETECTED: ${review.suggestedFix}`);
      }

      critique = critiqueParts.join('\n');
    }

    const failCount = (desire.metrics?.executionFailCount || 0) + 1;
    const updatedDesire: Desire = {
      ...desire,
      status: 'planning',
      userCritique: critique,
      execution: undefined,
      outcomeReview: review,
      updatedAt: now,
      currentStage: 'planning',
      metrics: {
        ...desire.metrics,
        executionFailCount: failCount,
        lastActivityAt: now,
      },
    };

    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);

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

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `Retrying "${desire.title}" (attempt #${failCount + 1}). Moved to planning with failure context.`,
      attemptNumber: failCount + 1,
      failureCategory: review?.failureCategory,
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/agency/desires/:id/advance - Advance a desire to a requested status.
 */
export async function handleAdvanceDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to advance desires.' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to advance desires.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  const { newStatus } = body || {};
  if (!newStatus) {
    return { status: 400, error: 'newStatus is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    const allowedTransitions = VALID_ADVANCE_TRANSITIONS[desire.status] || [];
    if (!allowedTransitions.includes(newStatus)) {
      return {
        status: 400,
        error: `Cannot transition from '${desire.status}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      };
    }

    if (newStatus === 'executing' && !desire.plan) {
      return {
        status: 400,
        data: {
          error: 'Cannot execute desire without a plan. Use the planning stage first.',
          suggestion: 'planning',
        },
      };
    }

    if (newStatus === 'reviewing' && !desire.plan) {
      return {
        status: 400,
        data: {
          error: 'Cannot review desire without a plan. The desire-planner agent will generate a plan automatically (runs every 5 minutes), or you can run it manually with: ./bin/mh agent run desire-planner',
          suggestion: 'Wait for the planner agent to run, or trigger it manually.',
        },
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...desire,
      status: newStatus as DesireStatus,
      updatedAt: now,
      activatedAt: desire.activatedAt || now,
    };

    await moveDesire(updatedDesire, oldStatus, newStatus, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_advanced',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        toStatus: newStatus,
        hasPlan: !!desire.plan,
      },
    });

    return successResponse({ desire: updatedDesire, success: true });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/answer - Submit clarifying question answers.
 */
export async function handleAnswerDesireQuestions(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to answer questions.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  if (!body) {
    return { status: 400, error: 'Invalid JSON body' };
  }

  const { answers } = body as { answers?: Array<{ questionId: string; answer: string }> };
  if (!answers || !Array.isArray(answers)) {
    return { status: 400, error: 'answers array is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    if (desire.status !== 'questioning') {
      return {
        status: 400,
        error: `Cannot answer questions for desire in '${desire.status}' status. Expected 'questioning'.`,
      };
    }

    if (!desire.clarifyingQuestions?.questions?.length) {
      return { status: 400, error: 'No clarifying questions found for this desire.' };
    }

    const now = new Date().toISOString();
    const formattedAnswers: ClarifyingAnswer[] = answers.map((answer) => ({
      questionId: answer.questionId,
      answer: answer.answer,
      answeredAt: now,
    }));

    const requiredQuestionIds = desire.clarifyingQuestions.questions
      .filter((question) => question.required)
      .map((question) => question.id);
    const answeredQuestionIds = new Set(formattedAnswers.map((answer) => answer.questionId));
    const missingRequired = requiredQuestionIds.filter((questionId) => !answeredQuestionIds.has(questionId));

    if (missingRequired.length > 0) {
      return {
        status: 400,
        data: {
          error: 'Missing required answers',
          missingQuestionIds: missingRequired,
        },
      };
    }

    const updatedDesire: Desire = {
      ...desire,
      clarifyingQuestions: {
        ...desire.clarifyingQuestions,
        answers: formattedAnswers,
        completedAt: now,
      },
      status: 'planning',
      currentStage: 'planning',
      updatedAt: now,
    };

    await saveDesireManifest(updatedDesire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_questions_answered',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        answerCount: formattedAnswers.length,
        questionsCount: desire.clarifyingQuestions.questions.length,
      },
    });

    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'questions_answered',
      taskType: 'desire_plan',
    });

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `Answers submitted. Generating plan for "${desire.title}"...`,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/checkin - Request a long-running desire check-in.
 */
export async function handleCheckinDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body, headers } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  const force = !!(body as { force?: boolean } | undefined)?.force;

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    if (desire.goalType !== 'long_running') {
      return { status: 400, error: 'Check-ins are only available for long-running goals.' };
    }

    await recordDesireCheckin(id, user.username, 'User-requested check-in');

    try {
      const operatorResponse = await fetch('http://localhost:4321/api/active-operator/queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': headers?.cookie || '',
        },
        body: JSON.stringify({
          taskType: 'desire_checkin',
          payload: {
            type: 'desire_checkin',
            desireId: id,
            checkProgress: true,
            force: true,
          },
          priority: 'high',
        }),
      });

      if (!operatorResponse.ok) {
        console.warn('[agency-handler] Failed to queue check-in task, but recorded the request');
      }
    } catch (queueError) {
      console.warn('[agency-handler] Could not queue check-in task:', queueError);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_checkin_requested',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        progress: desire.goalProgress?.progressPercent || 0,
        currentMilestone: desire.goalProgress?.currentMilestone || 0,
        force,
      },
    });

    return successResponse({
      success: true,
      desireId: id,
      title: desire.title,
      message: `Check-in requested for "${desire.title}". The system will evaluate progress shortly.`,
      currentProgress: {
        percent: desire.goalProgress?.progressPercent || 0,
        currentMilestone: desire.goalProgress?.currentMilestone || 0,
        totalMilestones: desire.goalProgress?.totalMilestones || 0,
      },
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/confirm-complete - Confirm outcome completion.
 */
export async function handleConfirmCompleteDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to confirm completion.' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to confirm completion.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    const confirmableStatuses = ['executing', 'awaiting_review', 'outcome_review'];
    if (!confirmableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot confirm completion for desire in '${desire.status}' status. Must be in: ${confirmableStatuses.join(', ')}`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = {
      ...desire,
      status: 'completed' as const,
      updatedAt: now,
      completedAt: now,
      metrics: desire.metrics ? {
        ...desire.metrics,
        userApprovalCount: desire.metrics.userApprovalCount + 1,
        completionCount: desire.metrics.completionCount + 1,
      } : undefined,
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
    } as Desire;

    await moveDesire(updatedDesire, oldStatus, 'completed', user.username);

    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'completed',
      description: 'User confirmed the outcome is satisfactory',
      actor: 'user',
      data: { fromStatus: oldStatus },
    }, user.username);

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

    captureEvent(`My desire "${desire.title}" has been confirmed complete by the user!`, {
      type: 'inner_dialogue',
      tags: ['agency', 'outcome', 'confirmed', 'inner'],
      metadata: {
        source: 'user-confirmation',
        desireId: id,
      },
    });

    queueTTS(user.username, `My desire "${desire.title}" is complete!`, 'inner', 'outcome-review');

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `"${desire.title}" marked as complete. Great work!`,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/execute - Start graph execution.
 */
export async function handleExecuteDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to execute desires.' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to execute desires.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    if (desire.status !== 'approved') {
      return {
        status: 400,
        error: `Cannot execute desire in '${desire.status}' status. Must be 'approved'.`,
      };
    }

    if (!desire.plan || !desire.plan.steps || desire.plan.steps.length === 0) {
      return {
        status: 400,
        data: {
          error: 'Cannot execute desire without a plan. Use the planning stage first.',
          suggestion: 'Move the desire back to "planning" status to generate a plan.',
        },
      };
    }

    const now = new Date().toISOString();
    const updatedDesire: Desire = {
      ...desire,
      status: 'executing',
      updatedAt: now,
      execution: {
        startedAt: now,
        status: 'running',
        stepsCompleted: 0,
        stepsTotal: desire.plan?.steps?.length || 1,
      },
    };

    await moveDesire(updatedDesire, 'approved', 'executing', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_execution_started',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        manual: true,
        planSteps: desire.plan?.steps?.length || 0,
      },
    });

    executeDesireViaGraph(updatedDesire, user.username)
      .then((result) => {
        console.log(`[agency-handler] Execution complete for "${desire.title}": success=${result.success}`);
        if (result.error) {
          console.error(`[agency-handler] Execution error for "${desire.title}": ${result.error}`);
        }
      })
      .catch((err) => {
        console.error(`[agency-handler] Execution failed for "${desire.title}":`, err);
      });

    return successResponse({
      desire: updatedDesire,
      success: true,
      message: `Execution started for "${desire.title}" (${desire.plan?.steps?.length || 0} steps). Check inner dialogue for progress.`,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/feedback - Submit feedback at any desire stage.
 */
export async function handleDesireFeedback(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  if (!body) {
    return { status: 400, error: 'Invalid JSON body' };
  }

  const { message, action = 'revise' } = body as {
    message?: string;
    action?: 'revise' | 'continue' | 'question';
  };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { status: 400, error: 'Message is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    const now = new Date().toISOString();
    const trimmedMessage = message.trim();
    let nextStatus: DesireStatus = desire.status;
    let responseMessage = '';
    let shouldTriggerPipeline = false;

    const existingCritique = desire.userCritique || '';
    const newCritique = existingCritique
      ? `${existingCritique}\n\n---\n[${now}] User feedback:\n${trimmedMessage}`
      : `[${now}] User feedback:\n${trimmedMessage}`;

    switch (desire.status) {
      case 'planning':
      case 'reviewing':
        nextStatus = 'planning';
        responseMessage = 'Feedback added. Regenerating plan with your input.';
        shouldTriggerPipeline = true;
        break;
      case 'awaiting_approval':
        nextStatus = 'planning';
        responseMessage = 'Got it. Going back to planning to address your concerns.';
        shouldTriggerPipeline = true;
        break;
      case 'approved':
      case 'executing':
      case 'awaiting_review':
        nextStatus = 'planning';
        responseMessage = 'Feedback received. Revising the plan based on your input.';
        shouldTriggerPipeline = true;
        break;
      case 'completed':
        nextStatus = 'planning';
        responseMessage = 'Starting a new iteration based on your feedback.';
        shouldTriggerPipeline = true;
        break;
      case 'questioning':
        nextStatus = 'questioning';
        responseMessage = 'Added your input to the context. You can continue answering questions or submit answers.';
        shouldTriggerPipeline = false;
        break;
      default:
        nextStatus = 'planning';
        responseMessage = 'Feedback received. Processing...';
        shouldTriggerPipeline = true;
    }

    const updatedDesire = {
      ...desire,
      status: nextStatus,
      currentStage: nextStatus as DesireStage,
      userCritique: newCritique,
      critiqueAt: now,
      updatedAt: now,
      metrics: desire.metrics ? {
        ...desire.metrics,
        userInputCount: desire.metrics.userInputCount + 1,
        userCritiqueCount: desire.metrics.userCritiqueCount + (nextStatus === 'planning' ? 1 : 0),
      } : desire.metrics,
    } as Desire;

    await saveDesireManifest(updatedDesire, user.username);

    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_critique',
      description: `User feedback: ${trimmedMessage.substring(0, 100)}${trimmedMessage.length > 100 ? '...' : ''}`,
      actor: 'user',
      data: {
        username: user.username,
        message: trimmedMessage,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
        triggerPipeline: shouldTriggerPipeline,
      },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_user_feedback',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
        messagePreview: trimmedMessage.substring(0, 100),
      },
    });

    captureEvent(`User provided feedback on "${desire.title}": "${trimmedMessage}"`, {
      type: 'inner_dialogue',
      tags: ['agency', 'feedback', 'user-input', 'inner'],
      metadata: {
        source: 'user-feedback',
        desireId: id,
        action,
      },
    });

    queueTTS(
      user.username,
      `Got your feedback on "${desire.title}". ${responseMessage}`,
      'inner',
      'agency-feedback'
    );

    await appendAgencyMessageToConversation(
      user.username,
      `📝 **Feedback Received:** "${desire.title}"\n\n` +
      `Your input: "${trimmedMessage.length > 200 ? trimmedMessage.substring(0, 200) + '...' : trimmedMessage}"\n\n` +
      `${responseMessage}`,
      {
        dialogueSource: 'agency-system',
        displayColor: '#8b5cf6',
        type: 'desire_feedback_received',
        desireId: id,
        desireTitle: desire.title,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
      }
    );

    if (shouldTriggerPipeline) {
      proposalEvents.emit('proposal-resolved', {
        username: user.username,
        proposalId: id,
        response: 'feedback_provided',
        taskType: 'desire_plan',
      });
    }

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: responseMessage,
      previousStatus: desire.status,
      newStatus: nextStatus,
      pipelineTriggered: shouldTriggerPipeline,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/ready-to-plan - Continue from questioning to planning.
 */
export async function handleReadyToPlanDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    if (desire.status !== 'questioning') {
      return {
        status: 400,
        error: `Cannot proceed from '${desire.status}' status. Expected 'questioning'.`,
      };
    }

    const now = new Date().toISOString();
    const updatedDesire: Desire = {
      ...desire,
      clarifyingQuestions: desire.clarifyingQuestions ? {
        ...desire.clarifyingQuestions,
        completedAt: now,
      } : undefined,
      status: 'planning',
      currentStage: 'planning',
      updatedAt: now,
    };

    await saveDesireManifest(updatedDesire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_ready_to_plan',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        hadQuestions: !!desire.clarifyingQuestions?.questions?.length,
      },
    });

    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'ready_to_plan',
      taskType: 'desire_plan',
    });

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `Ready for planning. Generating plan for "${desire.title}"...`,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/request-revision - Request outcome revision.
 */
export async function handleRequestDesireRevision(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to request revision.' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to request revision.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  const { feedback } = body || {};
  if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
    return { status: 400, error: 'Feedback text is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    const revisableStatuses = ['executing', 'awaiting_review', 'outcome_review', 'completed'];
    if (!revisableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot request revision for desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const trimmedFeedback = feedback.trim();
    const planHistory = [...(desire.planHistory || [])] as Array<NonNullable<Desire['plan']> & Record<string, unknown>>;
    if (desire.plan) {
      planHistory.push({
        ...desire.plan,
        archivedAt: now,
        archiveReason: 'user_revision_request',
      });
    }

    const desireWithExecutionHistory = desire as Desire & {
      executionHistory?: Array<DesireExecution & Record<string, unknown>>;
    };
    const executionHistory = [...(desireWithExecutionHistory.executionHistory || [])];
    if (desire.execution) {
      executionHistory.push({
        ...desire.execution,
        archivedAt: now,
        archiveReason: 'user_revision_request',
        userFeedback: trimmedFeedback,
      });
    }

    const updatedDesire = {
      ...desire,
      status: 'planning' as DesireStatus,
      updatedAt: now,
      userCritique: trimmedFeedback,
      critiqueAt: now,
      planHistory,
      executionHistory,
      execution: undefined,
      metrics: desire.metrics ? {
        ...desire.metrics,
        userCritiqueCount: desire.metrics.userCritiqueCount + 1,
        cycleCount: desire.metrics.cycleCount + 1,
      } : undefined,
      outcomeReview: desire.outcomeReview ? {
        ...desire.outcomeReview,
        verdict: 'retry' as const,
        userRequestedRevision: true,
        userRevisionFeedback: trimmedFeedback,
        userRevisionAt: now,
      } : {
        id: `outcome-${desire.id}-${Date.now()}`,
        verdict: 'retry' as const,
        reasoning: 'User requested revision',
        successScore: 0.5,
        lessonsLearned: [trimmedFeedback],
        reviewedAt: now,
        notifyUser: false,
        userRequestedRevision: true,
        userRevisionFeedback: trimmedFeedback,
        userRevisionAt: now,
      },
    } as Desire & { executionHistory?: Array<DesireExecution & Record<string, unknown>> };

    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);

    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_input',
      description: `User requested revision: ${trimmedFeedback.substring(0, 100)}${trimmedFeedback.length > 100 ? '...' : ''}`,
      actor: 'user',
      data: {
        fromStatus: oldStatus,
        feedback: trimmedFeedback,
        planVersion: desire.plan?.version || 1,
        executionAttempt: executionHistory.length,
      },
    }, user.username);

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

    captureEvent(`The user wants me to revise "${desire.title}". Their feedback: "${trimmedFeedback}"`, {
      type: 'inner_dialogue',
      tags: ['agency', 'revision', 'feedback', 'inner'],
      metadata: {
        source: 'user-revision-request',
        desireId: id,
        feedback: trimmedFeedback,
      },
    });

    queueTTS(
      user.username,
      `I'll revise my approach to "${desire.title}". Let me create a new plan based on your feedback.`,
      'inner',
      'outcome-review'
    );

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `Revision requested for "${desire.title}". A new plan will be generated incorporating your feedback.`,
      nextStep: 'The planner will automatically create a new plan. You can also manually trigger plan generation.',
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agency/desires/:id/revise - Request plan revision with critique.
 */
export async function handleReviseDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to revise desires.' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to revise desires.' };
  }

  const id = params?.id;
  if (!id) {
    return { status: 400, error: 'Desire ID is required' };
  }

  const { critique } = body || {};
  if (!critique || typeof critique !== 'string' || critique.trim().length === 0) {
    return { status: 400, error: 'Critique text is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    const revisableStatuses = ['nascent', 'pending', 'planning', 'reviewing', 'approved', 'awaiting_approval'];
    if (!revisableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot add instructions to a desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const hasPlan = !!desire.plan;
    const planHistory = [...(desire.planHistory || [])];
    if (hasPlan && desire.plan) {
      planHistory.push(desire.plan);
    }

    const targetStatus: DesireStatus = hasPlan
      ? 'planning'
      : (desire.status === 'nascent' ? 'pending' : desire.status);

    const updatedDesire: Desire = {
      ...desire,
      status: targetStatus,
      updatedAt: now,
      planHistory,
      userCritique: critique.trim(),
      critiqueAt: now,
      review: hasPlan ? undefined : desire.review,
    };

    if (oldStatus !== targetStatus) {
      await moveDesire(updatedDesire, oldStatus, targetStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: hasPlan ? 'desire_revision_requested' : 'desire_instructions_added',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        toStatus: targetStatus,
        critique: critique.substring(0, 200),
        hadPlan: hasPlan,
        planVersion: hasPlan ? (desire.plan?.version || 1) : 0,
        historyCount: planHistory.length,
      },
    });

    const message = hasPlan
      ? 'Plan revision requested. The planner will generate a new plan based on your critique.'
      : 'Instructions saved. Click "Generate Plan" to create a plan using your feedback.';

    return successResponse({
      success: true,
      desire: updatedDesire,
      message,
      planVersion: hasPlan ? ((desire.plan?.version || 1) + 1) : 1,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}
