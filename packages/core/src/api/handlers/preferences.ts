/**
 * Preference Learning API Handlers
 *
 * Endpoints for managing learned user preferences.
 * Part of Phase 4: Continual Learning
 *
 * POST /api/preferences/learn - Learn preferences from recent events
 * GET /api/preferences - List all preferences
 * GET /api/preferences/stats - Get preference statistics
 * GET /api/preferences/active - Get active preferences for decision-making
 * GET /api/preferences/by-category - Get preferences grouped by category
 * GET /api/preferences/:id - Get a specific preference
 * POST /api/preferences/:id/confirm - Confirm a preference
 * POST /api/preferences/:id/reject - Reject a preference
 * POST /api/preferences/:id/modify - Modify a preference
 * POST /api/preferences/contradictions - Find contradicting preferences
 * POST /api/preferences/cleanup - Clean up old rejected preferences
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  learnPreferences,
  getPreferences,
  getPreference,
  confirmPreference,
  rejectPreference,
  modifyPreference,
  getPreferenceStats,
  getPreferencesByCategory,
  getActivePreferences,
  findContradictions,
  cleanupPreferences,
  type LearningOptions,
  type LearnedPreference,
} from '../../preference-learner.js';
import { audit } from '../../audit.js';

/**
 * POST /api/preferences/learn
 * Learn preferences from recent events
 */
export async function handleLearnPreferences(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as LearningOptions | undefined;

    const options: LearningOptions = {
      maxEvents: body?.maxEvents ?? 100,
      daysBack: body?.daysBack ?? 14,
      minConfidence: body?.minConfidence ?? 0.5,
      categories: body?.categories,
    };

    const result = await learnPreferences(options);

    audit({
      category: 'action',
      level: 'info',
      event: 'preferences_learning_api',
      actor: req.user.username,
      details: {
        eventsProcessed: result.eventsProcessed,
        newPreferences: result.newPreferences,
        updatedPreferences: result.updatedPreferences,
      },
    });

    return successResponse({
      success: true,
      eventsProcessed: result.eventsProcessed,
      newPreferences: result.newPreferences,
      updatedPreferences: result.updatedPreferences,
      totalPreferences: result.preferences.length,
      preferences: result.preferences,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/preferences
 * List all preferences
 */
export async function handleListPreferences(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = req.query?.status as LearnedPreference['validationStatus'] | undefined;
    const preferences = getPreferences(status);

    return successResponse({
      success: true,
      preferences,
      count: preferences.length,
      byStatus: {
        pending: preferences.filter((p) => p.validationStatus === 'pending').length,
        confirmed: preferences.filter((p) => p.validationStatus === 'confirmed').length,
        rejected: preferences.filter((p) => p.validationStatus === 'rejected').length,
        modified: preferences.filter((p) => p.validationStatus === 'modified').length,
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/preferences/stats
 * Get preference statistics
 */
export async function handleGetPreferenceStats(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const stats = getPreferenceStats();

    return successResponse({
      success: true,
      stats,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/preferences/active
 * Get active preferences for decision-making
 */
export async function handleGetActivePreferences(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const preferences = getActivePreferences();

    return successResponse({
      success: true,
      preferences,
      count: preferences.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/preferences/by-category
 * Get preferences grouped by category
 */
export async function handleGetPreferencesByCategory(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const byCategory = getPreferencesByCategory();

    // Calculate counts per category
    const counts: Record<string, number> = {};
    for (const [category, prefs] of Object.entries(byCategory)) {
      counts[category] = prefs.length;
    }

    return successResponse({
      success: true,
      byCategory,
      counts,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/preferences/:id
 * Get a specific preference
 */
export async function handleGetPreference(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('preference ID is required');
    }

    const preference = getPreference(id);
    if (!preference) {
      return errorResponse('Preference not found', 404);
    }

    return successResponse({
      success: true,
      preference,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/preferences/:id/confirm
 * Confirm a preference
 */
export async function handleConfirmPreference(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('preference ID is required');
    }

    const success = confirmPreference(id);
    if (!success) {
      return errorResponse('Preference not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'preference_confirmed_api',
      actor: req.user.username,
      details: { preferenceId: id },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/preferences/:id/reject
 * Reject a preference
 */
export async function handleRejectPreference(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('preference ID is required');
    }

    const success = rejectPreference(id);
    if (!success) {
      return errorResponse('Preference not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'preference_rejected_api',
      actor: req.user.username,
      details: { preferenceId: id },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/preferences/:id/modify
 * Modify a preference
 */
export async function handleModifyPreference(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const id = req.params?.id;
    if (!id) {
      return badRequestResponse('preference ID is required');
    }

    const body = req.body as { behavior?: string; description?: string } | undefined;
    if (!body || (!body.behavior && !body.description)) {
      return badRequestResponse('behavior or description is required');
    }

    const success = modifyPreference(id, body);
    if (!success) {
      return errorResponse('Preference not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'preference_modified_api',
      actor: req.user.username,
      details: { preferenceId: id, modification: body },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/preferences/contradictions
 * Find contradicting preferences
 */
export async function handleFindContradictions(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const contradictions = await findContradictions();

    audit({
      category: 'action',
      level: 'info',
      event: 'preferences_contradictions_checked',
      actor: req.user.username,
      details: { contradictionsFound: contradictions.length },
    });

    return successResponse({
      success: true,
      contradictions: contradictions.map((c) => ({
        preference1: {
          id: c.pref1.id,
          description: c.pref1.description,
          behavior: c.pref1.behavior,
        },
        preference2: {
          id: c.pref2.id,
          description: c.pref2.description,
          behavior: c.pref2.behavior,
        },
        explanation: c.explanation,
      })),
      count: contradictions.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/preferences/cleanup
 * Clean up old rejected preferences
 */
export async function handleCleanupPreferences(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as { daysOld?: number } | undefined;
    const daysOld = body?.daysOld ?? 30;

    const removed = cleanupPreferences(daysOld);

    return successResponse({
      success: true,
      removed,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}
