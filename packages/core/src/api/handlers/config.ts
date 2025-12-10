/**
 * Config API Handlers
 *
 * Unified handlers for configuration endpoints (boredom, curiosity, etc.)
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';
import { loadCuriosityConfig, saveCuriosityConfig } from '../../config.js';
import fs from 'node:fs';
import path from 'node:path';

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
    const agentsConfigPath = path.join(systemPaths.etc, 'agents.json');
    const configData = fs.readFileSync(agentsConfigPath, 'utf-8');
    const agentsConfig = JSON.parse(configData);
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
    const agentsConfigPath = path.join(systemPaths.etc, 'agents.json');
    const configData = fs.readFileSync(agentsConfigPath, 'utf-8');
    const agentsConfig = JSON.parse(configData);

    const intervalSeconds = BOREDOM_INTERVALS[level];
    const enabled = intervalSeconds > 0;
    const threshold = enabled ? intervalSeconds : 900;

    if (agentsConfig.agents?.reflector) {
      agentsConfig.agents.reflector.enabled = enabled;
      agentsConfig.agents.reflector.inactivityThreshold = threshold;
    }

    fs.writeFileSync(agentsConfigPath, JSON.stringify(agentsConfig, null, 2));

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

    // Also update agents.json to sync the inactivityThreshold
    if ((updates as any).questionIntervalSeconds !== undefined) {
      try {
        const agentsPath = path.join(systemPaths.etc, 'agents.json');
        const agentsData = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));

        if (agentsData.agents.curiosity) {
          agentsData.agents.curiosity.inactivityThreshold = (updates as any).questionIntervalSeconds;
          fs.writeFileSync(agentsPath, JSON.stringify(agentsData, null, 2), 'utf-8');
        }
      } catch (agentError) {
        console.error('[curiosity-config-handler] Failed to update agents.json:', agentError);
        // Don't fail the whole request if agents.json update fails
      }
    }

    return successResponse({ success: true, config: newConfig });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
