/**
 * System Status API Handlers
 *
 * Unified handlers for system configuration status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getSystemStatus } from '../../env-config.js';

/**
 * GET /api/system-status - Get system configuration status
 */
export async function handleGetSystemStatus(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const status = getSystemStatus();

    return successResponse({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('[system-status] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
