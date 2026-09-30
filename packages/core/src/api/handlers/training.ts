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
import { stopTrainingProcesses, readTrainingOperations } from '../../training-process.js';
import {
  readTrainingDataSettings,
  updateTrainingDataSettings,
  readProfileTrainingConfig,
  updateProfileTrainingConfig,
} from '../../training-config.js';
import { launchTrainingJob, validateTrainingLaunchConfig, type TrainingLaunchRequest } from '../../training-launch.js';
import { parseTrainingDataSettings } from '../../training-schema.js';

/**
 * GET /api/training-config - Get training configuration
 */
export async function handleGetTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
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
  if (Object.prototype.hasOwnProperty.call(body, 'data')) {
    return { status: 400, error: 'Use /api/training-data to update training data settings' };
  }

  try {
    const allowed = ['base_model', 'num_train_epochs', 'max_samples', 'monthly_training', 'days_recent', 'old_samples', 'lora_rank', 'lora_alpha', 'learning_rate', 'per_device_train_batch_size', 'gradient_accumulation_steps', 'max_seq_length', 'quantization', 'skipGguf', 'load_in_4bit', 'mode_filter', 'trainingTarget'];
    if (Object.keys(body).some(key => !allowed.includes(key))) return { status: 400, error: 'Unsupported training setting' };
    const validation = validateTrainingLaunchConfig({ ...readProfileTrainingConfig(user.username), ...body });
    if (validation) return { status: 400, error: validation };
    if (body.trainingTarget !== undefined && !['ollama', 'vllm'].includes(body.trainingTarget)) return { status: 400, error: 'Invalid training target' };
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
 * The connected controls and training pipeline share one validated data contract.
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
  try {
    return successResponse({ success: true, config: readTrainingDataSettings(req.user.username) });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return { status: 400, error: 'Invalid training data settings' };
  if (Object.keys(req.body).some(key => !['objective', 'includePersona', 'memoryTypes', 'maxSyntheticPercent', 'evaluationPercent', 'seed'].includes(key))) {
    return { status: 400, error: 'Unsupported training data setting' };
  }
  let validated;
  try {
    validated = parseTrainingDataSettings(req.body);
  } catch (error) {
    return { status: 400, error: (error as Error).message };
  }
  try {
    const config = updateTrainingDataSettings(req.user.username, validated);
    return successResponse({ success: true, config, message: 'Training data settings saved' });
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * GET /api/training/[operation] - Read training operation status file.
 */
export async function handleGetTrainingOperation(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
  try {
    const operation = req.params?.operation || req.params?.id;
    const status = readTrainingOperations(req.user.username).find(item => item.operation === operation);
    if (!status) return { status: 404, error: 'Training operation not found' };
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
    const stopped = stopTrainingProcesses(req.user.username);
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
