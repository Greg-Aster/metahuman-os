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
  generateDesireId,
  initializeDesireMetrics,
  initializeScratchpadSummary,
  type Desire,
  type DesireStatus,
} from '../../agency/index.js';
import { audit } from '../../audit.js';

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

  const { title, description, reason, risk = 'low', source = 'persona_goal' } = (body || {}) as {
    title?: string;
    description?: string;
    reason?: string;
    risk?: Desire['risk'];
    source?: Desire['source'];
  };

  if (!title || !description) {
    return {
      status: 400,
      error: 'Missing required fields: title, description',
    };
  }

  try {
    const now = new Date().toISOString();
    const desire: Desire = {
      id: generateDesireId(),
      title,
      description,
      reason: reason || 'User-created desire',
      source,
      sourceId: `manual-${Date.now()}`,
      status: 'pending',
      strength: 0.8,
      baseWeight: 1.0,
      threshold: 0.7,
      decayRate: 0.03,
      lastReviewedAt: now,
      reinforcements: 0,
      runCount: 1,
      risk,
      requiredTrustLevel: risk === 'high' || risk === 'critical' ? 'bounded_auto' : 'supervised_auto',
      metrics: initializeDesireMetrics(),
      scratchpad: initializeScratchpadSummary(),
      createdAt: now,
      updatedAt: now,
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
      error: 'Authentication required to approve desire',
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

    // Can only approve desires in 'reviewing' status
    if (desire.status !== 'reviewing') {
      return {
        status: 400,
        error: `Cannot approve desire in '${desire.status}' status. Must be in 'reviewing' status.`,
      };
    }

    const now = new Date().toISOString();
    const updatedDesire: Desire = {
      ...desire,
      status: 'approved',
      updatedAt: now,
    };

    await moveDesire(updatedDesire, 'reviewing', 'approved', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'status_change',
      description: `Desire approved by ${user.username}`,
      actor: 'user',
      data: { approvedBy: user.username, from: 'reviewing', to: 'approved' },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_approved',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
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
 * POST /api/agency/desires/:id/reject - Reject a desire
 */
export async function handleRejectDesire(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to reject desire',
    };
  }

  const id = params?.id;
  if (!id) {
    return {
      status: 400,
      error: 'Desire ID is required',
    };
  }

  const { reason } = (body || {}) as { reason?: string };

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
    const updatedDesire: Desire = {
      ...desire,
      status: 'rejected',
      updatedAt: now,
    };

    await moveDesire(updatedDesire, oldStatus, 'rejected', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'status_change',
      description: `Desire rejected by ${user.username}${reason ? `: ${reason}` : ''}`,
      actor: 'user',
      data: { rejectedBy: user.username, reason, from: oldStatus, to: 'rejected' },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_rejected',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
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
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to reset desire',
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
    const updatedDesire: Desire = {
      ...desire,
      status: 'pending',
      updatedAt: now,
    };

    await moveDesire(updatedDesire, oldStatus, 'pending', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'status_change',
      description: `Desire reset to pending by ${user.username}`,
      actor: 'user',
      data: { resetBy: user.username, from: oldStatus, to: 'pending' },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_reset',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        previousStatus: oldStatus,
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
      error: 'Authentication required to retry desire',
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

    // Build critique from existing outcome review and previous failures
    let critique = desire.userCritique || '';
    if (desire.outcomeReview) {
      const review = desire.outcomeReview;
      critique = [
        `RETRY REQUESTED BY USER`,
        '',
        `Previous Outcome:`,
        `- Verdict: ${review.verdict}`,
        `- Success Score: ${(review.successScore * 100).toFixed(0)}%`,
        `- Failure Category: ${review.failureCategory || 'unknown'}`,
        `- Reasoning: ${review.reasoning}`,
        '',
        `Lessons Learned:`,
        ...(review.lessonsLearned?.map(l => `- ${l}`) || ['- None recorded']),
        '',
        `Suggestions for Next Attempt:`,
        ...(review.nextAttemptSuggestions?.map(s => `- ${s}`) || ['- None provided']),
      ].join('\n');
    }

    // Move current plan to history if exists
    const planHistory = desire.planHistory || [];
    if (desire.plan) {
      planHistory.push(desire.plan);
    }

    // Update the desire for retry
    const updatedDesire: Desire = {
      ...desire,
      status: 'planning',  // Go back to planning phase
      userCritique: critique,
      critiqueAt: now,
      plan: undefined,  // Clear current plan so planner creates new one
      planHistory,
      execution: undefined,  // Clear execution data
      updatedAt: now,
      metrics: {
        ...desire.metrics!,
        planRevisionCount: (desire.metrics?.planRevisionCount || 0) + 1,
        lastActivityAt: now,
      },
    };

    await moveDesire(updatedDesire, oldStatus, 'planning', user.username);

    // Add scratchpad entry
    await addScratchpadEntryToFolder(id, {
      timestamp: now,
      type: 'retry_requested',
      description: `User requested retry - sending back to planning with failure context`,
      actor: 'user',
      data: {
        requestedBy: user.username,
        fromStatus: oldStatus,
        toStatus: 'planning',
        hadOutcomeReview: !!desire.outcomeReview,
        failureCategory: desire.outcomeReview?.failureCategory,
      },
    }, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_retry_requested',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        previousStatus: oldStatus,
        hadFailureContext: !!desire.outcomeReview,
        planRevisionCount: updatedDesire.metrics?.planRevisionCount,
      },
    });

    return successResponse({
      desire: updatedDesire,
      success: true,
      message: 'Desire sent back to planning with failure context',
    });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
