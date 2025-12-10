/**
 * Drift Config API Handlers
 *
 * GET/PUT drift detection configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Import drift functions from core - these may need to be created/exported
let loadDriftConfig: (username: string) => Promise<any>;
let saveDriftConfig: (username: string, updates: any) => Promise<void>;

// Dynamic import to handle module availability
async function ensureDriftFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    if (core.loadDriftConfig && core.saveDriftConfig) {
      loadDriftConfig = core.loadDriftConfig;
      saveDriftConfig = core.saveDriftConfig;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * GET /api/drift/config - Get drift configuration
 */
export async function handleGetDriftConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to view drift config',
    };
  }

  try {
    const available = await ensureDriftFunctions();
    if (!available) {
      return {
        status: 501,
        error: 'Drift detection not available',
      };
    }

    const config = await loadDriftConfig(user.username);

    return successResponse(config);
  } catch (error) {
    console.error('[drift/config] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * PUT /api/drift/config - Update drift configuration
 */
export async function handleSetDriftConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required to update drift config',
    };
  }

  try {
    const available = await ensureDriftFunctions();
    if (!available) {
      return {
        status: 501,
        error: 'Drift detection not available',
      };
    }

    // Validate updates
    if (typeof body !== 'object' || body === null) {
      return {
        status: 400,
        error: 'Invalid configuration object',
      };
    }

    await saveDriftConfig(user.username, body);
    const config = await loadDriftConfig(user.username);

    return successResponse({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[drift/config] PUT error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
