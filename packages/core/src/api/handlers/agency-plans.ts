/**
 * Agency Plans API Handlers
 *
 * GET/PUT plan versions for desires.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';

// Dynamic imports for agency functions
let listPlanVersions: any;
let loadPlanFromFolder: any;
let savePlanToFolder: any;
let loadDesire: any;
let saveDesire: any;

async function ensureAgencyFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    listPlanVersions = core.listPlanVersions;
    loadPlanFromFolder = core.loadPlanFromFolder;
    savePlanToFolder = core.savePlanToFolder;
    loadDesire = core.loadDesire;
    saveDesire = core.saveDesire;
    return !!(listPlanVersions && loadDesire && saveDesire);
  } catch {
    return false;
  }
}

/**
 * GET /api/agency/plans - Get plan versions for a desire
 */
export async function handleGetAgencyPlans(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to view plans' };
  }

  try {
    const available = await ensureAgencyFunctions();
    if (!available) {
      return { status: 501, error: 'Agency plans not available' };
    }

    const desireId = query?.desireId;
    const version = query?.version;

    if (!desireId) {
      return { status: 400, error: 'Missing required parameter: desireId' };
    }

    // Verify desire exists
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    // If version is specified, return single plan
    if (version) {
      const plan = await loadPlanFromFolder(desireId, parseInt(version, 10), user.username);
      if (!plan) {
        return { status: 404, error: 'Plan version not found' };
      }
      return successResponse({ plan });
    }

    // Get list of plan versions
    const versions = await listPlanVersions(desireId, user.username);
    const currentPlan = desire.plan;
    const planHistory = desire.planHistory || [];

    return successResponse({
      versions,
      currentPlan,
      planHistory,
      desireId,
      desireTitle: desire.title,
    });
  } catch (error) {
    console.error('[agency/plans] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/agency/plans - Update plan for a desire
 */
export async function handleUpdateAgencyPlan(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to update plans' };
  }

  try {
    const available = await ensureAgencyFunctions();
    if (!available) {
      return { status: 501, error: 'Agency plans not available' };
    }

    const { desireId, plan } = body || {};

    if (!desireId || !plan) {
      return { status: 400, error: 'Missing required fields: desireId, plan' };
    }

    // Load desire
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    // Move current plan to history if it exists
    if (desire.plan) {
      if (!desire.planHistory) {
        desire.planHistory = [];
      }
      desire.planHistory.push(desire.plan);
    }

    // Set new plan
    desire.plan = plan;
    desire.updatedAt = new Date().toISOString();

    // Update metrics
    if (desire.metrics) {
      desire.metrics.planVersionCount++;
      desire.metrics.lastActivityAt = desire.updatedAt;
    }

    // Save desire with new plan
    await saveDesire(desire, user.username);

    // Also save to folder structure if enabled
    if (savePlanToFolder) {
      await savePlanToFolder(desireId, plan, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'plan_updated',
      actor: user.username,
      details: {
        desireId,
        planId: plan.id,
        version: plan.version,
      },
    });

    return successResponse({ success: true, desire });
  } catch (error) {
    console.error('[agency/plans] PUT error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
