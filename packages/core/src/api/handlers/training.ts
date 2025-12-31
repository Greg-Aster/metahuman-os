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

    // All users are authenticated (no anonymous access)
    // Get their profile-specific config
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
 * NOTE: Now reads from unified etc/training.json and extracts data section
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');

    // Return default config if file doesn't exist
    if (!fs.existsSync(trainingConfigPath)) {
      return successResponse({
        success: true,
        config: getDefaultTrainingDataConfig(),
      });
    }

    const content = fs.readFileSync(trainingConfigPath, 'utf-8');
    const unified = JSON.parse(content);

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
 * NOTE: Now writes to unified etc/training.json, preserving other sections
 */
export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');

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
        monthly_training: true,
        days_recent: 30,
        old_samples: 3000,
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

    // Ensure directory exists
    fs.mkdirSync(path.dirname(trainingConfigPath), { recursive: true });

    // Save updated unified config
    fs.writeFileSync(trainingConfigPath, JSON.stringify(unified, null, 2), 'utf-8');

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
