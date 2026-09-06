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
  listAllDesires,
  loadDesire,
  saveDesire,
  deleteDesire,
  moveDesire,
  saveDesireManifest,
  addScratchpadEntryToFolder,
  loadExecutionAttempts,
  loadExecutionAttempt,
  generateDesireId,
  initializeDesireMetrics,
  initializeScratchpadSummary,
  initializeStageIterations,
  loadConfig,
  statusToStage,
  allowedOwnerAdvanceTargets,
  canOwnerAdvanceDesire,
  allowedOwnerResetTargets,
  canOwnerResetDesireTo,
  validateDesireForUserApproval,
  statusesForDesireGroup,
  isDesireStatus,
  isActiveDesire,
  isOpenDesire,
  approveDesireForExecution,
  archiveCurrentDesireCycle,
  applyDesireOutcomeReview,
  generateOutcomeReviewId,
  type Desire,
  type DesireExecution,
  type DesireOutcomeReview,
  type DesireStatus,
  type DesireGoalType,
  type DesireStage,
  type ClarifyingAnswer,
  type DesireStatusGroup,
} from '../../agency/index.js';
import { proposalEvents } from '../../active-operator/index.js';
import { audit } from '../../audit.js';
import {
  submitInnerDialogue,
  submitInnerReflection,
  submitSystemEvent,
} from '../../buffer-admission.js';
import { submitDesireAgent } from '../../queue/index.js';
import { assertDesireExecutable } from '../../agency/desire-execution-service.js';

// Legacy/invalid statuses that might exist in old data - map them to valid statuses
const LEGACY_STATUS_MAP: Record<string, DesireStatus> = {
  'executed': 'completed',  // "executed" was used before, should be "completed"
  'active': 'executing',    // "active" was used before, should be "executing"
};

/**
 * Normalize legacy status values in the response without turning a GET into a
 * hidden migration write. The explicit Agency migration owns persistence.
 */
function normalizeDesireStatus(desire: Desire): Desire {
  const currentStatus = desire.status as string;

  // Check if this is a legacy status that needs fixing
  if (LEGACY_STATUS_MAP[currentStatus]) {
    const newStatus = LEGACY_STATUS_MAP[currentStatus];
    return { ...desire, status: newStatus, currentStage: statusToStage(newStatus) };
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

    const semanticGroups = new Set<DesireStatusGroup>([
      'all', 'open', 'active', 'waiting', 'needs_action', 'completed', 'archived',
    ]);
    if (semanticGroups.has(statusParam as DesireStatusGroup)) {
      // Use listAllDesires which includes desires from both folder-based storage
      // AND legacy status directories (handles desires with invalid/old statuses)
      desires = await listAllDesires(user.username);
      if (statusParam !== 'all') {
        const accepted = statusesForDesireGroup(statusParam as DesireStatusGroup);
        desires = desires.filter(desire => accepted.includes(desire.status));
      }
    } else if (statusParam.includes(',')) {
      // Comma-separated list of statuses
      const statuses = statusParam.split(',').map(s => s.trim()) as DesireStatus[];
      desires = [];
      for (const s of statuses) {
        if (isDesireStatus(s)) {
          const d = await listDesiresByStatus(s, user.username);
          desires.push(...d);
        }
      }
    } else if (isDesireStatus(statusParam)) {
      desires = await listDesiresByStatus(statusParam, user.username);
    } else {
      return { status: 400, error: `Unknown desire status filter: ${statusParam}` };
    }

    // Normalize any desires with legacy statuses
    desires = desires.map(normalizeDesireStatus);

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
    source = 'user_request',
    // Advanced options
    goalType = 'one_time',
    strength: initialStrength = 0.8,
    status: initialStatus = 'pending',
    decayRate: customDecayRate,
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

  if (typeof title !== 'string' || !title.trim()
    || typeof description !== 'string' || !description.trim()) {
    return {
      status: 400,
      error: 'Missing required fields: title, description',
    };
  }
  if (reason !== undefined && typeof reason !== 'string') {
    return { status: 400, error: 'reason must be a string.' };
  }
  if (!['none', 'low', 'medium', 'high', 'critical'].includes(risk)) {
    return { status: 400, error: 'risk is invalid.' };
  }
  if (typeof source !== 'string') {
    return { status: 400, error: 'source must be a string.' };
  }
  if (!['one_time', 'recurring', 'long_running'].includes(goalType)) {
    return { status: 400, error: 'goalType must be one_time, recurring, or long_running.' };
  }
  if (typeof initialStrength !== 'number' || !Number.isFinite(initialStrength)) {
    return { status: 400, error: 'strength must be a finite number.' };
  }
  if (!['nascent', 'pending'].includes(initialStatus)) {
    return { status: 400, error: 'status must be nascent or pending.' };
  }
  if (customDecayRate !== undefined
    && (typeof customDecayRate !== 'number' || !Number.isFinite(customDecayRate)
      || customDecayRate < 0 || customDecayRate > 1)) {
    return { status: 400, error: 'decayRate must be between 0 and 1.' };
  }
  if (completionCriteria !== undefined && typeof completionCriteria !== 'string') {
    return { status: 400, error: 'completionCriteria must be a string.' };
  }
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    return { status: 400, error: 'tags must be an array of strings.' };
  }

  // Validate and clamp strength to valid range
  const strength = Math.max(0, Math.min(1, initialStrength));

  // Validate status - only allow nascent or pending for new desires
  const status: DesireStatus = initialStatus === 'nascent' ? 'nascent' : 'pending';

  // Map status to stage
  const currentStage: DesireStage = status === 'nascent' ? 'nascent' : 'strengthening';

  try {
    const now = new Date().toISOString();
    const config = await loadConfig(user.username);
    const sourceConfig = config.sources[source];
    if (!sourceConfig?.enabled) {
      return { status: 400, error: `Desire source '${source}' is not enabled.` };
    }
    if (status === 'pending' && strength < config.thresholds.activation) {
      return {
        status: 400,
        error: `A pending desire must meet the configured activation strength (${config.thresholds.activation}). Create it as nascent or increase its strength.`,
      };
    }
    const existingDesires = await listAllDesires(user.username);
    const openCount = existingDesires.filter(desire =>
      isOpenDesire(desire) && desire.status !== 'paused').length;
    if (openCount >= config.limits.maxActiveDesires + config.limits.maxPendingDesires) {
      return { status: 409, error: 'Agency desire capacity is full. Archive an open desire or increase the configured limits.' };
    }
    if (status === 'pending'
      && existingDesires.filter(isActiveDesire).length >= config.limits.maxActiveDesires) {
      return { status: 409, error: 'Agency operational capacity is full. Create this desire as nascent or increase Maximum operational desires.' };
    }
    const desireId = generateDesireId();
    const desire: Desire = {
      id: desireId,
      title: title.trim(),
      description: description.trim(),
      reason: reason?.trim() || 'User-created desire',
      source,
      sourceId: `manual-${desireId}`,
      evidence: [{
        id: `manual:${desireId}`,
        kind: 'origin',
        source,
        sourceId: `manual-${desireId}`,
        summary: reason?.trim() || 'User-created desire',
        observedAt: now,
      }],
      status,
      currentStage,
      stageIterations: initializeStageIterations(),
      strength,
      baseWeight: sourceConfig.weight,
      threshold: config.thresholds.activation,
      decayRate: customDecayRate ?? config.thresholds.decay.ratePerDay,
      lastReviewedAt: now,
      lastDecayAt: now,
      reinforcements: 0,
      runCount: status === 'nascent' ? 0 : 1,
      risk,
      requiredTrustLevel: risk === 'none' || risk === 'low'
        ? 'suggest'
        : risk === 'medium' ? 'supervised_auto' : 'bounded_auto',
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
      tags: tags.length > 0 ? [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].slice(0, 20) : undefined,
      userId: user.username,
    };

    // The folder manifest is the one canonical desire record.
    await saveDesire(desire, user.username);

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

    const planningTask = desire.status === 'pending'
      ? await submitDesireAgent({
          operation: 'plan',
          username: user.username,
          desireId: desire.id,
          source: 'user',
          idempotencyKey: `desire-plan:${desire.id}:manual-create`,
          metadata: { producer: 'desire-manual-create' },
        })
      : undefined;

    return {
      status: 201,
      data: { desire, taskId: planningTask?.id, success: true },
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
  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required to update desires.' };
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

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, error: 'A desire update object is required.' };
    }
    const editableFields = new Set([
      'title', 'description', 'reason', 'goalType', 'completionCriteria', 'tags', 'decayRate',
    ]);
    const unsupported = Object.keys(body).filter(key => !editableFields.has(key));
    if (unsupported.length > 0) {
      return { status: 400, error: `Lifecycle and execution fields cannot be edited here: ${unsupported.join(', ')}` };
    }
    const updates = body as Partial<Pick<Desire,
      'title' | 'description' | 'reason' | 'goalType' | 'completionCriteria' | 'tags' | 'decayRate'>>;
    if (updates.title !== undefined && (typeof updates.title !== 'string' || !updates.title.trim())) {
      return { status: 400, error: 'title must be a non-empty string.' };
    }
    if (updates.description !== undefined && (typeof updates.description !== 'string' || !updates.description.trim())) {
      return { status: 400, error: 'description must be a non-empty string.' };
    }
    if (updates.reason !== undefined && (typeof updates.reason !== 'string' || !updates.reason.trim())) {
      return { status: 400, error: 'reason must be a non-empty string.' };
    }
    if (updates.goalType !== undefined && !['one_time', 'recurring', 'long_running'].includes(updates.goalType)) {
      return { status: 400, error: 'goalType must be one_time, recurring, or long_running.' };
    }
    if (updates.completionCriteria !== undefined && typeof updates.completionCriteria !== 'string') {
      return { status: 400, error: 'completionCriteria must be a string.' };
    }
    if (updates.tags !== undefined
      && (!Array.isArray(updates.tags) || updates.tags.some(tag => typeof tag !== 'string'))) {
      return { status: 400, error: 'tags must be an array of strings.' };
    }
    if (updates.decayRate !== undefined
      && (typeof updates.decayRate !== 'number' || !Number.isFinite(updates.decayRate)
        || updates.decayRate < 0 || updates.decayRate > 1)) {
      return { status: 400, error: 'decayRate must be between 0 and 1.' };
    }
    const now = new Date().toISOString();

    const updatedDesire: Desire = {
      ...desire,
      ...updates,
      title: updates.title?.trim() || desire.title,
      description: updates.description?.trim() || desire.description,
      reason: updates.reason?.trim() || desire.reason,
      updatedAt: now,
      metrics: {
        ...(desire.metrics || initializeDesireMetrics()),
        lastActivityAt: now,
      },
    };

    await saveDesire(updatedDesire, user.username);

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

    const approvalError = validateDesireForUserApproval(desire);
    if (approvalError) {
      return {
        status: 400,
        error: approvalError,
      };
    }

    const oldStatus = desire.status;
    const updatedDesire = await approveDesireForExecution(desire, user.username);

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

    let executionTaskId: string | undefined;
    if (desire.plan?.steps?.length) {
      const task = await submitDesireAgent({
        operation: 'execute',
        username: user.username,
        desireId: id,
        source: 'user',
        metadata: { producer: 'agency-approval' },
      });
      executionTaskId = task.id;
      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_execution_queued',
        actor: user.username,
        details: {
          desireId: id,
          title: desire.title,
          planSteps: desire.plan.steps.length,
          taskId: task.id,
        },
      });
    }

    return successResponse({
      desire: updatedDesire,
      success: true,
      executionQueued: Boolean(executionTaskId),
      taskId: executionTaskId,
      message: executionTaskId
        ? `Approved and queued "${desire.title}" for execution (${desire.plan?.steps?.length || 0} steps).`
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
      'questioning',
      'needs_attention',
      'paused',
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
      ...archiveCurrentDesireCycle(desire),
      status: 'archived',
      currentStage: 'archived',
      dispositionReason: reason,
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

    await moveDesire(updatedDesire, oldStatus, 'archived', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_archived_after_owner_denial',
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
  const validTargets = allowedOwnerResetTargets();
  if (!canOwnerResetDesireTo(targetStatus)) {
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

    if (desire.status === 'executing') {
      return {
        status: 409,
        error: 'Cannot reset a desire while its Work Coordinator execution is active. Cancel that task first, then reset after the desire reaches outcome review.',
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...(targetStatus === 'planning' || targetStatus === 'pending'
        ? archiveCurrentDesireCycle(desire)
        : desire),
      status: targetStatus,
      currentStage: statusToStage(targetStatus),
      updatedAt: now,
      clarifyingQuestions: targetStatus === 'planning' ? undefined : desire.clarifyingQuestions,
    };

    await moveDesire(updatedDesire, oldStatus, targetStatus, user.username);
    const planningTask = targetStatus === 'planning' || targetStatus === 'pending'
      ? await submitDesireAgent({
          operation: 'plan',
          username: user.username,
          desireId: id,
          source: 'user',
          idempotencyKey: `desire-plan:${id}:owner-reset:${now}`,
          metadata: { producer: 'desire-owner-reset' },
        })
      : undefined;

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
        reason: 'manual_reset',
      },
    });

    const message = `Reset "${desire.title}" from ${oldStatus} to ${targetStatus}.`;

    return successResponse({
      success: true,
      desire: updatedDesire,
      message,
      taskId: planningTask?.id,
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

    const retryableStatuses: DesireStatus[] = [
      'awaiting_review', 'needs_attention', 'failed', 'completed', 'rejected', 'abandoned',
    ];
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

    const failCount = desire.metrics?.executionFailCount || 0;
    const updatedDesire: Desire = {
      ...archiveCurrentDesireCycle(desire),
      status: 'planning',
      userCritique: critique,
      updatedAt: now,
      currentStage: 'planning',
      metrics: {
        ...desire.metrics,
        userCritiqueCount: (desire.metrics?.userCritiqueCount || 0) + 1,
        lastActivityAt: now,
      },
    };

    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);
    const planningTask = await submitDesireAgent({
      operation: 'plan',
      username: user.username,
      desireId: id,
      source: 'user',
      idempotencyKey: `desire-plan:${id}:owner-retry:${now}`,
      metadata: { producer: 'desire-owner-retry' },
    });

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
      taskId: planningTask.id,
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

  const { newStatus, reason } = body || {};
  if (!newStatus) {
    return { status: 400, error: 'newStatus is required' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    if (typeof newStatus !== 'string' || !isDesireStatus(newStatus)) {
      return { status: 400, error: `Unknown desire status '${String(newStatus)}'.` };
    }
    const allowedTransitions = allowedOwnerAdvanceTargets(desire.status);
    if (!canOwnerAdvanceDesire(desire.status, newStatus)) {
      return {
        status: 400,
        error: `Cannot transition from '${desire.status}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire: Desire = {
      ...(newStatus === 'planning' || newStatus === 'pending' || newStatus === 'nascent'
        ? archiveCurrentDesireCycle(desire)
        : desire),
      status: newStatus,
      currentStage: statusToStage(newStatus),
      updatedAt: now,
      activatedAt: desire.activatedAt || now,
      dispositionReason: newStatus === 'archived' || newStatus === 'paused'
        ? (typeof reason === 'string' && reason.trim() ? reason.trim() : desire.dispositionReason)
        : undefined,
    };

    await moveDesire(updatedDesire, oldStatus, newStatus, user.username);
    const planningTask = newStatus === 'planning' || newStatus === 'pending'
      ? await submitDesireAgent({
          operation: 'plan',
          username: user.username,
          desireId: id,
          source: 'user',
          idempotencyKey: `desire-plan:${id}:owner-advance:${now}`,
          metadata: { producer: 'desire-owner-advance' },
        })
      : undefined;

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

    return successResponse({ desire: updatedDesire, taskId: planningTask?.id, success: true });
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
    const declaredQuestionIds = new Set(desire.clarifyingQuestions.questions.map(question => question.id));
    const incomingIds = new Set<string>();
    for (const answer of answers) {
      if (!answer || typeof answer.questionId !== 'string' || typeof answer.answer !== 'string') {
        return { status: 400, error: 'Each answer requires a questionId and answer string.' };
      }
      if (!declaredQuestionIds.has(answer.questionId)) {
        return { status: 400, error: `Unknown clarifying question '${answer.questionId}'.` };
      }
      if (incomingIds.has(answer.questionId)) {
        return { status: 400, error: `Duplicate answer for clarifying question '${answer.questionId}'.` };
      }
      incomingIds.add(answer.questionId);
    }
    const answerMap = new Map(
      (desire.clarifyingQuestions.answers || [])
        .filter(answer => declaredQuestionIds.has(answer.questionId))
        .map(answer => [answer.questionId, answer] as const),
    );
    for (const answer of answers) {
      const value = answer.answer.trim();
      if (value) {
        answerMap.set(answer.questionId, { questionId: answer.questionId, answer: value, answeredAt: now });
      } else {
        answerMap.delete(answer.questionId);
      }
    }
    const formattedAnswers: ClarifyingAnswer[] = [...answerMap.values()];

    const requiredQuestionIds = desire.clarifyingQuestions.questions
      .filter((question) => question.required)
      .map((question) => question.id);
    const answeredQuestionIds = new Set(
      formattedAnswers.filter(answer => answer.answer.trim()).map((answer) => answer.questionId),
    );
    const missingRequired = requiredQuestionIds.filter((questionId) => !answeredQuestionIds.has(questionId));

    if (missingRequired.length > 0) {
      return {
        status: 400,
        error: 'Missing required answers',
        data: {
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
      metrics: {
        ...(desire.metrics || initializeDesireMetrics()),
        userInputCount: (desire.metrics?.userInputCount || 0) + 1,
        lastActivityAt: now,
      },
    };

    await saveDesireManifest(updatedDesire, user.username);
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'questions_answered',
      description: `Owner answered ${formattedAnswers.length} clarifying question(s).`,
      actor: 'user',
      data: {
        questionIds: formattedAnswers.map(answer => answer.questionId),
        idempotencyKey: `desire-questions:${id}:${desire.clarifyingQuestions.askedAt || 'unknown'}`,
      },
    }, user.username);
    const planningTask = await submitDesireAgent({
      operation: 'plan',
      username: user.username,
      desireId: id,
      source: 'user',
      idempotencyKey: `desire-plan:${id}:${now}`,
      metadata: { producer: 'desire-questions-answered' },
    });

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
      taskId: planningTask.id,
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
  const { user, params, body } = req;

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

    const task = await submitDesireAgent({
      operation: 'checkin',
      source: 'user',
      priority: 'high',
      desireId: id,
      force,
      username: user.username,
      idempotencyKey: `desire-checkin:${id}:${force ? 'force' : 'manual'}:${desire.goalProgress?.lastCheckinAt || 'initial'}`,
      metadata: { producer: 'agency-api', desireId: id },
    });

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
        taskId: task.id,
        taskState: task.state,
      },
    });

    return successResponse({
      success: true,
      desireId: id,
      title: desire.title,
      taskId: task.id,
      taskState: task.state,
      message: `Check-in queued for "${desire.title}".`,
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

    const confirmableStatuses: DesireStatus[] = ['awaiting_review'];
    if (!confirmableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot confirm completion for desire in '${desire.status}' status. Must be in: ${confirmableStatuses.join(', ')}`,
      };
    }

    const now = new Date().toISOString();
    const review: DesireOutcomeReview = {
      ...(desire.outcomeReview || {} as DesireOutcomeReview),
      id: desire.outcomeReview?.id || generateOutcomeReviewId(desire.id),
      verdict: 'completed',
      reasoning: 'Installation owner explicitly confirmed that the outcome is satisfactory.',
      successScore: 1,
      failureCategory: 'none',
      isFixableBug: false,
      lessonsLearned: desire.outcomeReview?.lessonsLearned || [],
      reviewedAt: now,
      notifyUser: false,
      completionCriteriaMet: true,
      userConfirmed: true,
      userConfirmedAt: now,
    };
    const applied = await applyDesireOutcomeReview(desire, review, user.username);
    const updatedDesire = applied.desire;

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_user_confirmed_complete',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: desire.status,
        action: applied.action,
      },
    });

    await submitInnerReflection(user.username, `My desire "${desire.title}" has been confirmed complete by the user!`, {
      type: 'desire_completion_confirmed',
      tags: ['agency', 'outcome', 'confirmed', 'inner'],
      source: 'user-confirmation',
      desireId: id,
    });

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: applied.summary,
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

    try {
      assertDesireExecutable(desire);
    } catch (error) {
      return {
        status: 400,
        error: (error as Error).message,
      };
    }

    const task = await submitDesireAgent({
      operation: 'execute',
      username: user.username,
      desireId: id,
      source: 'user',
      metadata: { producer: 'agency-execute-api' },
    });

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_execution_queued',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        manual: true,
        planSteps: desire.plan?.steps?.length || 0,
        taskId: task.id,
      },
    });

    return successResponse({
      desire,
      success: true,
      executionQueued: true,
      taskId: task.id,
      message: `Execution queued for "${desire.title}" (${desire.plan?.steps?.length || 0} steps).`,
    }, 202);
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
  if (!['revise', 'continue', 'question'].includes(action)) {
    return { status: 400, error: 'action must be revise, continue, or question.' };
  }

  try {
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }
    if (desire.status === 'executing') {
      return {
        status: 409,
        error: 'Cannot revise feedback while the Work Coordinator execution is active. Cancel that task first and wait for outcome review.',
      };
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
      ...(nextStatus === 'planning' ? archiveCurrentDesireCycle(desire) : desire),
      status: nextStatus,
      currentStage: statusToStage(nextStatus),
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

    await submitInnerDialogue(user.username, {
      role: 'thought',
      content: `User provided feedback on "${desire.title}": "${trimmedMessage}"`,
      meta: {
        type: 'agency_feedback',
        tags: ['agency', 'feedback', 'user-input', 'inner'],
        source: 'user',
        dialogueSource: 'user-feedback',
        desireId: id,
        action,
      },
    });

    await submitSystemEvent(
      user.username,
      `📝 **Feedback Received:** "${desire.title}"\n\n` +
      `Your input: "${trimmedMessage.length > 200 ? trimmedMessage.substring(0, 200) + '...' : trimmedMessage}"\n\n` +
      `${responseMessage}`,
      {
        dialogueSource: 'agency-system',
        source: 'agency',
        displayColor: '#8b5cf6',
        type: 'desire_feedback_received',
        desireId: id,
        desireTitle: desire.title,
        action,
        fromStatus: desire.status,
        toStatus: nextStatus,
      }
    );

    const planningTask = shouldTriggerPipeline
      ? await submitDesireAgent({
          operation: 'plan',
          username: user.username,
          desireId: id,
          source: 'user',
          idempotencyKey: `desire-plan:${id}:feedback:${now}`,
          metadata: { producer: 'desire-feedback' },
        })
      : undefined;

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
      taskId: planningTask?.id,
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

    const requiredQuestions = desire.clarifyingQuestions?.questions
      .filter(question => question.required) || [];
    const answeredQuestionIds = new Set(
      (desire.clarifyingQuestions?.answers || [])
        .filter(answer => answer.answer.trim())
        .map(answer => answer.questionId),
    );
    const missingRequired = requiredQuestions
      .map(question => question.id)
      .filter(questionId => !answeredQuestionIds.has(questionId));
    if (missingRequired.length > 0) {
      return {
        status: 400,
        error: 'Required clarifying questions must be answered first',
        data: { missingQuestionIds: missingRequired },
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
    const planningTask = await submitDesireAgent({
      operation: 'plan',
      username: user.username,
      desireId: id,
      source: 'user',
      idempotencyKey: `desire-plan:${id}:${now}`,
      metadata: { producer: 'desire-ready-to-plan' },
    });

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
      taskId: planningTask.id,
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

    const revisableStatuses: DesireStatus[] = ['awaiting_review', 'needs_attention', 'completed'];
    if (!revisableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot request revision for desire in '${desire.status}' status. Must be in: ${revisableStatuses.join(', ')}`,
      };
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const trimmedFeedback = feedback.trim();
    const archivedDesire = archiveCurrentDesireCycle(desire);

    const updatedDesire = {
      ...archivedDesire,
      status: 'planning' as DesireStatus,
      currentStage: 'planning',
      updatedAt: now,
      userCritique: trimmedFeedback,
      critiqueAt: now,
      metrics: desire.metrics ? {
        ...desire.metrics,
        userCritiqueCount: desire.metrics.userCritiqueCount + 1,
        lastActivityAt: now,
      } : undefined,
    } as Desire;

    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);
    const planningTask = await submitDesireAgent({
      operation: 'plan',
      username: user.username,
      desireId: id,
      source: 'user',
      idempotencyKey: `desire-plan:${id}:owner-outcome-revision:${now}`,
      metadata: { producer: 'desire-owner-outcome-revision' },
    });

    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'user_input',
      description: `User requested revision: ${trimmedFeedback.substring(0, 100)}${trimmedFeedback.length > 100 ? '...' : ''}`,
      actor: 'user',
      data: {
        fromStatus: oldStatus,
        feedback: trimmedFeedback,
        planVersion: desire.plan?.version || 1,
        executionAttempt: archivedDesire.executionHistory?.length || 0,
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
        executionAttemptCount: archivedDesire.executionHistory?.length || 0,
      },
    });

    await submitInnerReflection(user.username, `The user wants me to revise "${desire.title}". Their feedback: "${trimmedFeedback}"`, {
      type: 'desire_revision_requested',
      tags: ['agency', 'revision', 'feedback', 'inner'],
      source: 'user-revision-request',
      desireId: id,
      feedback: trimmedFeedback,
    });

    return successResponse({
      success: true,
      desire: updatedDesire,
      message: `Revision requested for "${desire.title}". A new plan will be generated incorporating your feedback.`,
      nextStep: 'The planner will automatically create a new plan. You can also manually trigger plan generation.',
      taskId: planningTask.id,
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

    const targetStatus: DesireStatus = hasPlan
      ? 'planning'
      : (desire.status === 'nascent' ? 'pending' : desire.status);

    const updatedDesire: Desire = {
      ...(hasPlan ? archiveCurrentDesireCycle(desire) : desire),
      status: targetStatus,
      currentStage: statusToStage(targetStatus),
      updatedAt: now,
      userCritique: critique.trim(),
      critiqueAt: now,
      metrics: {
        ...(desire.metrics || initializeDesireMetrics()),
        userCritiqueCount: (desire.metrics?.userCritiqueCount || 0) + 1,
        lastActivityAt: now,
      },
    };

    if (oldStatus !== targetStatus) {
      await moveDesire(updatedDesire, oldStatus, targetStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }
    const planningTask = targetStatus === 'planning' || targetStatus === 'pending'
      ? await submitDesireAgent({
          operation: 'plan',
          username: user.username,
          desireId: id,
          source: 'user',
          idempotencyKey: `desire-plan:${id}:owner-critique:${now}`,
          metadata: { producer: 'desire-owner-critique' },
        })
      : undefined;

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
        historyCount: updatedDesire.planHistory?.length || 0,
      },
    });

    const message = hasPlan
      ? 'Plan revision requested. The planner will generate a new plan based on your critique.'
      : planningTask
        ? 'Instructions saved and planning queued.'
        : 'Instructions saved.';

    return successResponse({
      success: true,
      desire: updatedDesire,
      message,
      planVersion: hasPlan ? ((desire.plan?.version || 1) + 1) : 1,
      taskId: planningTask?.id,
    });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}
