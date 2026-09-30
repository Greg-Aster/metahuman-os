/**
 * Training Running API Handler
 *
 * GET whether a training process is currently running.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { listTrainingProcesses } from '../../training-process.js';

/**
 * GET /api/training/running - Check if any training is running
 */
export async function handleGetTrainingRunning(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
    const running = listTrainingProcesses().find(item => item.username === req.user.username);
    if (running) {
      return successResponse({
        success: true,
        running: true,
        pid: running.pid,
        method: running.name,
        runLabel: running.runLabel,
        logFile: running.logFile,
        cancelling: Boolean(running.cancelRequestedAt),
      });
    }

    // No running training found
    return successResponse({
      success: true,
      running: false,
      pid: null,
    });
  } catch (error) {
    console.error('[training-running] GET failed:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to check training status',
    };
  }
}
