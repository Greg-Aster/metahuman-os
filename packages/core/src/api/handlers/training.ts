/**
 * Training API Handlers
 *
 * Unified handlers for training configuration endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';
import { safeWriteJSON } from '../../safe-file.js';
import { stopTrainingProcesses } from '../../training-process.js';
import {
  ensureProfileTrainingConfig,
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from '../../training-config.js';
import { launchTrainingJob, type TrainingLaunchRequest } from '../../training-launch.js';

/**
 * GET /api/training-config - Get training configuration
 */
export async function handleGetTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // All users are authenticated (no anonymous access)
    // Get their profile-specific config
    const config = readProfileTrainingConfig(user.username);

    return successResponse(config);
  } catch (error) {
    console.error('[training-config-handler] Error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to load training configuration',
    };
  }
}

/**
 * POST /api/training-config - Update training configuration
 */
export async function handleUpdateTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'automatic')) {
    return { status: 400, error: 'Use /api/training/automatic to update automatic training policy' };
  }

  try {
    const updatedConfig = updateProfileTrainingConfig(user.username, {
      ...(body as Record<string, unknown>),
      lastUpdated: new Date().toISOString(),
    });

    return successResponse({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    console.error('[training-config-handler] Update error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to update training configuration',
    };
  }
}

/**
 * GET /api/training-data - Get training data configuration
 * Returns the authenticated profile's unified training-data settings.
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const unified = readProfileTrainingConfig(req.user.username) as Record<string, any>;

    // Convert unified format to legacy format for backwards compatibility
    const config = {
      curator: unified.curator || getDefaultTrainingDataConfig().curator,
      collection: {
        maxDays: unified.data?.maxDays || 999999,
        maxSamplesPerSource: unified.data?.maxSamplesPerSource || 3000,
        includePersona: unified.data?.includePersona ?? true,
      },
      memoryTypes: unified.data?.memoryTypes || getDefaultTrainingDataConfig().memoryTypes,
      phases: unified.phases || getDefaultTrainingDataConfig().phases,
    };

    return successResponse({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[training-data-handler] Error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to load training data configuration',
    };
  }
}

/**
 * POST /api/training-data - Update training data configuration (owner only)
 * Updates the authenticated profile's unified training-data settings.
 */
export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const trainingConfigPath = ensureProfileTrainingConfig(req.user.username);

    // Load current unified config or create empty
    let unified: Record<string, any> = {};
    if (fs.existsSync(trainingConfigPath)) {
      unified = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
    }

    // Initialize data section if missing
    if (!unified.data) {
      unified.data = {
        maxDays: 999999,
        maxSamplesPerSource: 3000,
        max_samples: 3000,
        includePersona: true,
        memoryTypes: getDefaultTrainingDataConfig().memoryTypes,
      };
    }

    // Update curator settings if provided
    if (body.curator) {
      unified.curator = unified.curator || {};
      if (typeof body.curator.batchSize === 'number' && body.curator.batchSize > 0) {
        unified.curator.batchSize = body.curator.batchSize;
      }
      if (typeof body.curator.qualityThreshold === 'number') {
        unified.curator.qualityThreshold = Math.max(0, Math.min(10, body.curator.qualityThreshold));
      }
      if (typeof body.curator.temperature === 'number') {
        unified.curator.temperature = Math.max(0, Math.min(2, body.curator.temperature));
      }
    }

    // Update collection settings (mapped to data section)
    if (body.collection) {
      if (typeof body.collection.maxDays === 'number' && body.collection.maxDays > 0) {
        unified.data.maxDays = body.collection.maxDays;
      }
      if (typeof body.collection.maxSamplesPerSource === 'number' && body.collection.maxSamplesPerSource > 0) {
        unified.data.maxSamplesPerSource = body.collection.maxSamplesPerSource;
      }
      if (typeof body.collection.includePersona === 'boolean') {
        unified.data.includePersona = body.collection.includePersona;
      }
    }

    // Update memory types (mapped to data.memoryTypes)
    if (body.memoryTypes?.enabled && Array.isArray(body.memoryTypes.enabled)) {
      unified.data.memoryTypes = unified.data.memoryTypes || {};
      unified.data.memoryTypes.enabled = body.memoryTypes.enabled;
    }

    if (body.memoryTypes?.percentages && typeof body.memoryTypes.percentages === 'object') {
      unified.data.memoryTypes = unified.data.memoryTypes || {};
      unified.data.memoryTypes.percentages = unified.data.memoryTypes.percentages || {};
      for (const [type, value] of Object.entries(body.memoryTypes.percentages)) {
        if (typeof value === 'number') {
          unified.data.memoryTypes.percentages[type] = Math.max(0, Math.min(100, value));
        }
      }
    }

    safeWriteJSON(trainingConfigPath, unified);

    // Return legacy format for backwards compatibility
    const config = {
      curator: unified.curator || getDefaultTrainingDataConfig().curator,
      collection: {
        maxDays: unified.data?.maxDays || 999999,
        maxSamplesPerSource: unified.data?.maxSamplesPerSource || 3000,
        includePersona: unified.data?.includePersona ?? true,
      },
      memoryTypes: unified.data?.memoryTypes || getDefaultTrainingDataConfig().memoryTypes,
      phases: unified.phases || getDefaultTrainingDataConfig().phases,
    };

    return successResponse({
      success: true,
      config,
      message: 'Training data configuration updated successfully',
    });
  } catch (error) {
    console.error('[training-data-handler] Update error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to update training data configuration',
    };
  }
}

function getDefaultTrainingDataConfig() {
  return {
    curator: {
      batchSize: 100,
      qualityThreshold: 6.0,
      temperature: 0.3,
    },
    collection: {
      maxDays: 999999,
      maxSamplesPerSource: 3000,
      includePersona: true,
    },
    memoryTypes: {
      enabled: [
        'conversation',
        'observation',
        'reflection',
        'reflection_summary',
        'inner_dialogue',
        'decision',
        'dream',
        'journal',
        'curiosity_question',
        'summary',
      ],
      priorities: {
        therapy_session: 10,
        conversation: 9,
        inner_dialogue: 8,
        reflection: 7,
        reflection_summary: 7,
        decision: 6,
        observation: 5,
        curiosity_question: 4,
        dream: 3,
        journal: 3,
        summary: 2,
      },
      percentages: {
        conversation: 40,
        observation: 25,
        therapy_session: 15,
        reflection: 5,
        reflection_summary: 3,
        inner_dialogue: 3,
        dream: 3,
        curiosity_question: 3,
        decision: 2,
        journal: 1,
        summary: 0,
      },
    },
    phases: {
      description: 'Recommended configurations for different training phases',
      phase1_conservative: {
        curator: { batchSize: 50, maxSamplesPerSource: 1000 },
        expectedSamples: '~800-1200',
        processingTime: '~15 mins',
      },
      phase2_optimal: {
        curator: { batchSize: 100, maxSamplesPerSource: 3000 },
        expectedSamples: '~2500-3000',
        processingTime: '~30 mins',
      },
      phase3_maximum: {
        curator: { batchSize: 150, maxSamplesPerSource: 5000 },
        expectedSamples: '~4000-5000',
        processingTime: '~45-60 mins',
      },
    },
  };
}

/**
 * GET /api/training/[operation] - Read training operation status file.
 */
export async function handleGetTrainingOperation(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const operation = req.params?.operation || req.params?.id;
    const statusFile = path.join(process.cwd(), 'logs/status', `${operation}.json`);

    if (!operation || !fs.existsSync(statusFile)) {
      return { status: 404, error: 'Training operation not found' };
    }

    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    const lastHeartbeat = new Date(status.lastHeartbeat);
    const now = new Date();
    const minutesSinceHeartbeat = (now.getTime() - lastHeartbeat.getTime()) / 60000;
    status.isHung = minutesSinceHeartbeat > 2 && status.overallStatus === 'running';

    if (status.startedAt) {
      const started = new Date(status.startedAt);
      status.elapsedSeconds = Math.floor((now.getTime() - started.getTime()) / 1000);
    }

    return successResponse(status);
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/training/launch - Launch a brain/training job.
 */
export async function handleLaunchTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, data: { success: false, error: 'Authentication required' } };
  }

  try {
    const result = launchTrainingJob(req.user.username, req.body as TrainingLaunchRequest);
    if (!result.success) {
      return { status: result.status, data: { success: false, error: result.error } };
    }
    const { status: _status, ...data } = result;
    return successResponse(data);
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * POST /api/training/cancel - Stop the tracked training job.
 */
export async function handleCancelTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const stopped = stopTrainingProcesses();
    if (stopped.length === 0) {
      return { status: 404, data: { success: false, error: 'No training process is running' } };
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'training_cancelled',
      details: { processes: stopped },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      message: `Cancellation requested for ${stopped.map(({ name }) => name).join(', ')}`,
      processes: stopped,
    });
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel training',
      },
    };
  }
}
