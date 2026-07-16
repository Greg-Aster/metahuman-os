/**
 * Config API Handlers
 *
 * Unified handlers for configuration endpoints (boredom, curiosity, etc.)
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';
import { loadCuriosityConfig, saveCuriosityConfig } from '../../config.js';
import { getTriggerConfigService } from '../../queue/index.js';

// Boredom interval mapping (in seconds)
const BOREDOM_INTERVALS = {
  high: 60,      // ~1 minute
  medium: 300,   // ~5 minutes
  low: 900,      // ~15 minutes
  off: -1        // disabled
} as const;

/**
 * Derives the boredom level from agents.json configuration
 */
function getBoredomLevelFromConfig(agentsConfig: any): string {
  const reflectorAgent = agentsConfig.agents?.reflector;
  if (!reflectorAgent || !reflectorAgent.enabled) {
    return 'off';
  }

  const threshold = reflectorAgent.inactivityThreshold;
  if (threshold <= 60) return 'high';
  if (threshold <= 300) return 'medium';
  return 'low';
}

/**
 * GET /api/boredom - Get current boredom level
 */
export async function handleGetBoredom(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const agentsConfig = getTriggerConfigService().load(false).config;
    const level = getBoredomLevelFromConfig(agentsConfig);

    return successResponse({ level });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/boredom - Set boredom level
 *
 * Body: { level: 'high' | 'medium' | 'low' | 'off' }
 */
export async function handleSetBoredom(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const { level } = (body || {}) as { level?: keyof typeof BOREDOM_INTERVALS };

  if (!level || !BOREDOM_INTERVALS[level]) {
    return {
      status: 400,
      error: 'Invalid level. Must be one of: high, medium, low, off',
    };
  }

  try {
    const intervalSeconds = BOREDOM_INTERVALS[level];
    const enabled = intervalSeconds > 0;
    const threshold = enabled ? intervalSeconds : 900;
    getTriggerConfigService().update({
      agents: { reflector: { enabled, inactivityThreshold: threshold } },
    }, req.user.username || 'boredom-api');

    audit({
      category: 'system',
      level: 'info',
      event: 'boredom_level_changed',
      actor: 'boredom-api',
      details: {
        level,
        intervalSeconds,
        enabled,
        note: 'Reflections are now inner_dialogue only (never show in chat)'
      }
    });

    console.log(`[boredom-handler] Updated to ${level} (${enabled ? `${intervalSeconds}s` : 'disabled'})`);

    return successResponse({ success: true, level });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * GET /api/curiosity-config - Get curiosity configuration
 */
export async function handleGetCuriosityConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to access system configuration',
    };
  }

  try {
    const config = loadCuriosityConfig(user.username);
    return successResponse(config);
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/curiosity-config - Update curiosity configuration
 *
 * Body: Partial curiosity config
 */
export async function handleSetCuriosityConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  if (user.role !== 'owner') {
    return {
      status: 403,
      error: 'Owner role required to modify system configuration',
    };
  }

  const updates = body || {};

  try {
    const current = loadCuriosityConfig(user.username);

    // Merge updates with validation
    const newConfig = {
      ...current,
      ...updates,
      // Clamp maxOpenQuestions to 0-5 range
      maxOpenQuestions: Math.max(0, Math.min(5, (updates as any).maxOpenQuestions ?? current.maxOpenQuestions))
    };

    saveCuriosityConfig(newConfig, user.username);

    // Update the same canonical trigger transaction used by Trigger Manager Settings.
    if ((updates as any).questionIntervalSeconds !== undefined) {
      getTriggerConfigService().update({
        agents: { curiosity: { inactivityThreshold: (updates as any).questionIntervalSeconds } },
      }, user.username);
    }

    return successResponse({ success: true, config: newConfig });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
