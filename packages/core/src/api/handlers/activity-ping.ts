/**
 * Activity Ping API Handlers
 *
 * Updates activity timestamp for sleep/boredom tracking.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { recordSystemActivity } from '../../system-activity.js';

/**
 * POST /api/activity-ping - Update activity timestamp
 */
export async function handleActivityPing(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Get username for activity tracking (enables user-specific agent triggers)
    const username = user.isAuthenticated ? user.username : undefined;

    recordSystemActivity(Date.now(), username);

    return successResponse({
      message: 'Activity updated',
    });
  } catch (error) {
    console.error('[activity-ping] Error:', error);
    return {
      status: 500,
      error: 'Failed to update activity',
    };
  }
}
