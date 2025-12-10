/**
 * Training API Handlers
 *
 * Unified handlers for training configuration endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, notFoundResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { getProfilePaths } from '../../path-builder.js';

/**
 * GET /api/training-config - Get training configuration
 */
export async function handleGetTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // Anonymous users get system-wide config
    if (!user.isAuthenticated || user.role === 'anonymous') {
      const systemConfigPath = path.join(systemPaths.etc, 'training.json');

      if (!fs.existsSync(systemConfigPath)) {
        return notFoundResponse('Training configuration not found');
      }

      const content = fs.readFileSync(systemConfigPath, 'utf-8');
      const config = JSON.parse(content);

      return successResponse(config);
    }

    // Authenticated users get their profile-specific config
    const profilePaths = getProfilePaths(user.username);
    const userConfigPath = path.join(profilePaths.etc, 'training.json');

    // If user doesn't have training.json yet, try to copy from system defaults
    if (!fs.existsSync(userConfigPath)) {
      const systemConfigPath = path.join(systemPaths.etc, 'training.json');

      if (fs.existsSync(systemConfigPath)) {
        // Create user's etc directory if it doesn't exist
        fs.mkdirSync(profilePaths.etc, { recursive: true });

        // Copy system config as starting point
        const systemContent = fs.readFileSync(systemConfigPath, 'utf-8');
        fs.writeFileSync(userConfigPath, systemContent, 'utf-8');
      } else {
        return notFoundResponse('Training configuration not found');
      }
    }

    // Read and parse user's training config
    const content = fs.readFileSync(userConfigPath, 'utf-8');
    const config = JSON.parse(content);

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

  try {
    const profilePaths = getProfilePaths(user.username);
    const userConfigPath = path.join(profilePaths.etc, 'training.json');

    // Load existing config or create new
    let config: Record<string, any> = {};
    if (fs.existsSync(userConfigPath)) {
      config = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
    }

    // Merge updates
    const updatedConfig = {
      ...config,
      ...body,
      lastUpdated: new Date().toISOString(),
    };

    // Ensure directory exists
    fs.mkdirSync(profilePaths.etc, { recursive: true });

    // Write updated config
    fs.writeFileSync(userConfigPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');

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
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const trainingDataPath = path.join(systemPaths.etc, 'training-data.json');

    // Return default config if file doesn't exist
    if (!fs.existsSync(trainingDataPath)) {
      return successResponse({
        success: true,
        config: getDefaultTrainingDataConfig(),
      });
    }

    const content = fs.readFileSync(trainingDataPath, 'utf-8');
    const config = JSON.parse(content);

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
 */
export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const trainingDataPath = path.join(systemPaths.etc, 'training-data.json');
    
    // Load current config or use defaults
    let config = getDefaultTrainingDataConfig();
    if (fs.existsSync(trainingDataPath)) {
      config = JSON.parse(fs.readFileSync(trainingDataPath, 'utf-8'));
    }

    // Update curator settings if provided
    if (body.curator) {
      if (typeof body.curator.batchSize === 'number' && body.curator.batchSize > 0) {
        config.curator.batchSize = body.curator.batchSize;
      }
      if (typeof body.curator.qualityThreshold === 'number') {
        config.curator.qualityThreshold = Math.max(0, Math.min(10, body.curator.qualityThreshold));
      }
      if (typeof body.curator.temperature === 'number') {
        config.curator.temperature = Math.max(0, Math.min(2, body.curator.temperature));
      }
    }

    // Update collection settings if provided
    if (body.collection) {
      if (typeof body.collection.maxDays === 'number' && body.collection.maxDays > 0) {
        config.collection.maxDays = body.collection.maxDays;
      }
      if (typeof body.collection.maxSamplesPerSource === 'number' && body.collection.maxSamplesPerSource > 0) {
        config.collection.maxSamplesPerSource = body.collection.maxSamplesPerSource;
      }
    }

    // Update memory types if provided
    if (body.memoryTypes?.enabled && Array.isArray(body.memoryTypes.enabled)) {
      config.memoryTypes.enabled = body.memoryTypes.enabled;
    }

    // Ensure directory exists
    fs.mkdirSync(path.dirname(trainingDataPath), { recursive: true });
    
    // Save updated config
    fs.writeFileSync(trainingDataPath, JSON.stringify(config, null, 2), 'utf-8');

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
