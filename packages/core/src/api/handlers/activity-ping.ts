/**
 * Activity Ping API Handlers
 *
 * Updates activity timestamp for sleep/boredom tracking.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getQueueSystem } from '../../queue/queue-system.js';

/**
 * POST /api/activity-ping - Update activity timestamp
 */
export async function handleActivityPing(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Get username for activity tracking (enables user-specific agent triggers)
    const username = user.isAuthenticated ? user.username : undefined;

    // The coordinator owns both idle-trigger activity and interrupting an
    // active sleep pipeline. Recording directly to disk would leave sleep work
    // running after the user returned.
    getQueueSystem().recordActivity(username);

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
