/**
 * Training Dataset Stats API Handler
 *
 * GET statistics about available training data.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { inspectTrainingDataset, selectPersonalizationDataset, trainingPersonaContext, readTrainingDatasetHistory } from '../../training-dataset.js';
import { readTrainingDataSettings } from '../../training-config.js';

/**
 * GET /api/training/dataset-stats - Get training dataset statistics
 */
export async function handleGetTrainingDatasetStats(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const inspection = inspectTrainingDataset(user.username);
    const settings = readTrainingDataSettings(user.username);
    const selected = selectPersonalizationDataset(inspection, settings, {
      maxSamples: req.query?.maxSamples === 'all' ? null : req.query?.maxSamples ? Number(req.query.maxSamples) : undefined,
      recentDays: req.query?.recentDays ? Number(req.query.recentDays) : undefined,
      olderSamples: req.query?.olderSamples ? Number(req.query.olderSamples) : undefined,
      personaContext: trainingPersonaContext(user.username, settings),
      history: readTrainingDatasetHistory(user.username),
    });
    return successResponse({
      ...inspection.stats,
      selection: {
        trainingSamples: selected.train.length, evaluationSamples: selected.evaluation.length,
        objective: settings.objective, cutoff: selected.cutoff, excluded: selected.excluded,
      },
      errors: inspection.errors,
    });
  } catch (error) {
    console.error('[training-dataset-stats] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
