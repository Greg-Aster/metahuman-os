/**
 * Config API Handlers
 *
 * Unified handlers for configuration endpoints (boredom, curiosity, etc.)
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadCuriosityConfig, parseCuriosityConfig, saveCuriosityConfig } from '../../config.js';

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

  let current;
  try {
    current = loadCuriosityConfig(user.username);
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
  let newConfig;
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Curiosity configuration update must contain an object');
    }
    newConfig = parseCuriosityConfig({ ...current, ...body });
  } catch (error) {
    return {
      status: 400,
      error: (error as Error).message,
    };
  }
  try {
    saveCuriosityConfig(newConfig, user.username);
    return successResponse({ success: true, config: newConfig });
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
