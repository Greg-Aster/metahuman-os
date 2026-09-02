/**
 * Training Dataset Stats API Handler
 *
 * GET statistics about available training data.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { inspectTrainingDataset } from '../../training-dataset.js';

/**
 * GET /api/training/dataset-stats - Get training dataset statistics
 */
export async function handleGetTrainingDatasetStats(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    return successResponse(inspectTrainingDataset(user.username).stats);
  } catch (error) {
    console.error('[training-dataset-stats] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
