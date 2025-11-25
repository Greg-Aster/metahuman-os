import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths, getAuthenticatedUser } from '@metahuman/core';

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

/**
 * List all fine-tuned models from run-summary.json files
 */
function listFineTuneModels(username: string): FineTuneModel[] {
  const models: FineTuneModel[] = [];
  const profilePath = path.join(systemPaths.root, 'persona', username);
  const fineTuneBasePath = path.join(profilePath, 'out', 'fine-tuned-models');

  if (!fs.existsSync(fineTuneBasePath)) {
    return models;
  }

  // Iterate through date directories (YYYY-MM-DD)
  const dateDirs = fs.readdirSync(fineTuneBasePath)
    .filter(name => fs.statSync(path.join(fineTuneBasePath, name)).isDirectory());

  for (const dateDir of dateDirs) {
    const datePath = path.join(fineTuneBasePath, dateDir);

    // Iterate through run label directories
    const runDirs = fs.readdirSync(datePath)
      .filter(name => fs.statSync(path.join(datePath, name)).isDirectory());

    for (const runDir of runDirs) {
      try {
        const runPath = path.join(datePath, runDir);
        const summaryPath = path.join(runPath, 'run-summary.json');

        if (!fs.existsSync(summaryPath)) {
          continue;
        }

        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

        // Check if model actually exists
        const modelPath = summary.modelPath || path.join(runPath, 'model');
        const hasModel = fs.existsSync(modelPath);

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
            isActive: false, // Will be set by checking active model
          });
        }
      } catch (err) {
        console.warn(`[fine-tune/models] Failed to read ${dateDir}/${runDir}:`, err);
      }
    }
  }

  // Sort by creation date (newest first)
  models.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return models;
}

/**
 * GET handler - List all fine-tuned models
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner role required to access fine-tune models'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const models = listFineTuneModels(user.username);

    return new Response(
      JSON.stringify({
        success: true,
        models,
        count: models.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Authentication required') ||
      error.message.includes('UNAUTHORIZED')
    )) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        models: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
