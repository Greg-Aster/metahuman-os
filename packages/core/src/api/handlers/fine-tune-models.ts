/**
 * Fine-Tune Models API Handlers
 *
 * GET list of fine-tuned models.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

interface FineTuneModel {
  runId: string;
  runLabel: string;
  username: string;
  baseModel: string;
  totalSamples: number;
  datasetSizeKB: number;
  createdAt: string;
  status: 'training_complete' | 'training_failed' | 'active';
  trainingSuccess: boolean;
  modelPath?: string;
  error?: string;
  isActive?: boolean;
}

function listFineTuneModels(username: string): FineTuneModel[] {
  const models: FineTuneModel[] = [];
  const profilePath = path.join(systemPaths.root, 'persona', username);
  const fineTuneBasePath = path.join(profilePath, 'out', 'fine-tuned-models');

  if (!existsSync(fineTuneBasePath)) {
    return models;
  }

  // Iterate through date directories (YYYY-MM-DD)
  const dateDirs = readdirSync(fineTuneBasePath)
    .filter(name => statSync(path.join(fineTuneBasePath, name)).isDirectory());

  for (const dateDir of dateDirs) {
    const datePath = path.join(fineTuneBasePath, dateDir);

    // Iterate through run label directories
    const runDirs = readdirSync(datePath)
      .filter(name => statSync(path.join(datePath, name)).isDirectory());

    for (const runDir of runDirs) {
      try {
        const runPath = path.join(datePath, runDir);
        const summaryPath = path.join(runPath, 'run-summary.json');

        if (!existsSync(summaryPath)) {
          continue;
        }

        const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));

        // Check if model actually exists
        const modelPath = summary.modelPath || path.join(runPath, 'model');
        const hasModel = existsSync(modelPath);

        if (hasModel && summary.trainingSuccess) {
          models.push({
            runId: summary.runId,
            runLabel: summary.runLabel || runDir,
            username: summary.username || username,
            baseModel: summary.baseModel || 'unknown',
            totalSamples: summary.totalSamples || 0,
            datasetSizeKB: summary.datasetSizeKB || 0,
            createdAt: summary.createdAt || new Date().toISOString(),
            status: summary.status || 'training_complete',
            trainingSuccess: summary.trainingSuccess,
            modelPath: modelPath,
            error: summary.error,
            isActive: false,
          });
        }
      } catch (err) {
        console.warn(`[fine-tune-models] Failed to read ${dateDir}/${runDir}:`, err);
      }
    }
  }

  // Sort by creation date (newest first)
  models.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return models;
}

/**
 * GET /api/fine-tune/models - List fine-tuned models
 */
export async function handleGetFineTuneModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to access fine-tune models' };
    }

    const models = listFineTuneModels(user.username);

    return successResponse({
      success: true,
      models,
      count: models.length,
    });
  } catch (error) {
    console.error('[fine-tune-models] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
