/**
 * RunPod Config API Handlers
 *
 * Returns the existing RunPod configuration for owner users.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadRunpodConfig } from '../../runpod-config.js';

/**
 * GET /api/runpod/config - Get RunPod configuration (owner only)
 */
export async function handleGetRunpodConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required',
      };
    }

    // Only owner can access RunPod config
    if (user.role !== 'owner') {
      return {
        status: 403,
        error: 'Owner role required',
      };
    }

    return successResponse(loadRunpodConfig(user.username));
  } catch (error) {
    console.error('[runpod-config] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
