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

const ALL_STATUSES: DesireStatus[] = [
  'nascent', 'pending', 'evaluating', 'planning', 'reviewing',
  'approved', 'executing', 'awaiting_review', 'completed', 'rejected', 'abandoned', 'failed'
];

/**
 * GET /api/agency/desires - List desires
 *
 * Query params:
 *   - status: filter by status ('all', 'active', 'pending', or specific status)
 */
export async function handleListDesires(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view desires',
    };
  }

  try {
    const status = params?.status || 'all';
    let desires: Desire[];

    if (status === 'all') {
      desires = [];
      for (const s of ALL_STATUSES) {
        const d = await listDesiresByStatus(s, user.username);
        desires.push(...d);
      }
    } else if (status === 'active') {
      desires = await listActiveDesires(user.username);
    } else if (status === 'pending') {
      desires = await listPendingDesires(user.username);
    } else {
      desires = await listDesiresByStatus(status as DesireStatus, user.username);
    }

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

    // Only allow deletion of certain statuses
    const deletableStatuses: DesireStatus[] = ['nascent', 'pending', 'rejected', 'abandoned', 'failed', 'completed'];
    if (!deletableStatuses.includes(desire.status)) {
      return {
        status: 400,
        error: `Cannot delete desire in '${desire.status}' status`,
      };
    }

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
