/**
 * API endpoint for managing training data collection configuration
 *
 * GET: Retrieve current training data configuration
 * POST: Update training data configuration
 *
 * NOTE: This endpoint reads from/writes to the unified etc/training.json
 * The data section contains collection settings and memory type configurations
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, systemPaths } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

const CONFIG_PATH = path.join(systemPaths.etc, 'training.json');

/**
 * Full unified training config structure (etc/training.json v2.0)
 */
interface UnifiedTrainingConfig {
  $schema?: string;
  description?: string;
  version?: string;
  model?: {
    base_model: string;
    trainingTarget: string;
    lora_rank: number;
    lora_alpha: number;
    learning_rate: number;
    num_train_epochs: number;
    per_device_train_batch_size: number;
    gradient_accumulation_steps: number;
    max_seq_length: number;
  };
  output?: {
    quantization: string;
    skipGguf: boolean;
    gguf_conversion: {
      enabled: boolean;
      quantization_type: string;
    };
  };
  data?: {
    maxDays: number;
    maxSamplesPerSource: number;
    max_samples: number;
    monthly_training: boolean;
    days_recent: number;
    old_samples: number;
    includePersona: boolean;
    memoryTypes: {
      enabled: string[];
      priorities: Record<string, number>;
      percentages: Record<string, number>;
    };
  };
  curator?: {
    batchSize: number;
    qualityThreshold: number;
    temperature: number;
  };
  phases?: {
    description: string;
    phase1_conservative: any;
    phase2_optimal: any;
    phase3_maximum: any;
  };
}

/**
 * Legacy format for backwards compatibility with existing UI
 */
interface TrainingDataConfig {
  curator: {
    batchSize: number;
    qualityThreshold: number;
    temperature: number;
  };
  collection: {
    maxDays: number;
    maxSamplesPerSource: number;
    includePersona?: boolean;
  };
  memoryTypes: {
    enabled: string[];
    priorities: Record<string, number>;
    percentages?: Record<string, number>;
  };
  phases: {
    description: string;
    phase1_conservative: any;
    phase2_optimal: any;
    phase3_maximum: any;
  };
}

/**
 * Load unified config and convert to legacy format for UI
 */
function loadConfig(): TrainingDataConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return getDefaultConfig();
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const unified = JSON.parse(content) as UnifiedTrainingConfig;

    // Convert unified format to legacy format for UI compatibility
    return {
      curator: unified.curator || getDefaultConfig().curator,
      collection: {
        maxDays: unified.data?.maxDays || 999999,
        maxSamplesPerSource: unified.data?.maxSamplesPerSource || 3000,
        includePersona: unified.data?.includePersona ?? true,
      },
      memoryTypes: unified.data?.memoryTypes || getDefaultConfig().memoryTypes,
      phases: unified.phases || getDefaultConfig().phases,
    };
  } catch (error) {
    console.error('[training-data] Failed to load config:', error);
    return getDefaultConfig();
  }
}

/**
 * Load the full unified config file
 */
function loadUnifiedConfig(): UnifiedTrainingConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return {};
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save updates to unified config (preserves other sections)
 */
function saveConfig(updates: { curator?: any; collection?: any; memoryTypes?: any }): void {
  try {
    // Load existing unified config to preserve other sections (model, output, etc.)
    const unified = loadUnifiedConfig();

    // Update curator section
    if (updates.curator) {
      unified.curator = { ...unified.curator, ...updates.curator };
    }

    // Update data section (collection + memoryTypes in unified format)
    if (updates.collection || updates.memoryTypes) {
      unified.data = unified.data || {
        maxDays: 999999,
        maxSamplesPerSource: 3000,
        max_samples: 3000,
        monthly_training: true,
        days_recent: 30,
        old_samples: 3000,
        includePersona: true,
        memoryTypes: getDefaultConfig().memoryTypes,
      };

      if (updates.collection) {
        if (updates.collection.maxDays !== undefined) unified.data.maxDays = updates.collection.maxDays;
        if (updates.collection.maxSamplesPerSource !== undefined) unified.data.maxSamplesPerSource = updates.collection.maxSamplesPerSource;
        if (updates.collection.includePersona !== undefined) unified.data.includePersona = updates.collection.includePersona;
      }

      if (updates.memoryTypes) {
        unified.data.memoryTypes = { ...unified.data.memoryTypes, ...updates.memoryTypes };
      }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(unified, null, 2), 'utf-8');
  } catch (error) {
    console.error('[training-data] Failed to save config:', error);
    throw new Error('Failed to save training data configuration');
  }
}

/**
 * Get default configuration
 */
function getDefaultConfig(): TrainingDataConfig {
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
 * GET handler - Retrieve training data configuration
 */
const getHandler: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const config = loadConfig();

    return new Response(
      JSON.stringify({
        success: true,
        config,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Failed to load training data configuration',
      }),
      {
        status: error?.status || 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * POST handler - Update training data configuration
 */
const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    // Load current config for response
    let config = loadConfig();
    const updates: { curator?: any; collection?: any; memoryTypes?: any } = {};

    // Update curator settings if provided
    if (body.curator) {
      updates.curator = {};
      if (typeof body.curator.batchSize === 'number' && body.curator.batchSize > 0) {
        updates.curator.batchSize = body.curator.batchSize;
        config.curator.batchSize = body.curator.batchSize;
      }
      if (typeof body.curator.qualityThreshold === 'number') {
        updates.curator.qualityThreshold = Math.max(0, Math.min(10, body.curator.qualityThreshold));
        config.curator.qualityThreshold = updates.curator.qualityThreshold;
      }
      if (typeof body.curator.temperature === 'number') {
        updates.curator.temperature = Math.max(0, Math.min(2, body.curator.temperature));
        config.curator.temperature = updates.curator.temperature;
      }
    }

    // Update collection settings if provided
    if (body.collection) {
      updates.collection = {};
      if (typeof body.collection.maxDays === 'number' && body.collection.maxDays > 0) {
        updates.collection.maxDays = body.collection.maxDays;
        config.collection.maxDays = body.collection.maxDays;
      }
      if (typeof body.collection.maxSamplesPerSource === 'number' && body.collection.maxSamplesPerSource > 0) {
        updates.collection.maxSamplesPerSource = body.collection.maxSamplesPerSource;
        config.collection.maxSamplesPerSource = body.collection.maxSamplesPerSource;
      }
      if (typeof body.collection.includePersona === 'boolean') {
        updates.collection.includePersona = body.collection.includePersona;
        config.collection.includePersona = body.collection.includePersona;
      }
    }

    // Update memory types if provided
    if (body.memoryTypes?.enabled && Array.isArray(body.memoryTypes.enabled)) {
      updates.memoryTypes = updates.memoryTypes || {};
      updates.memoryTypes.enabled = body.memoryTypes.enabled;
      config.memoryTypes.enabled = body.memoryTypes.enabled;
    }

    // Update memory type percentages if provided
    if (body.memoryTypes?.percentages && typeof body.memoryTypes.percentages === 'object') {
      updates.memoryTypes = updates.memoryTypes || {};
      updates.memoryTypes.percentages = {};
      if (!config.memoryTypes.percentages) {
        config.memoryTypes.percentages = {};
      }
      for (const [type, value] of Object.entries(body.memoryTypes.percentages)) {
        if (typeof value === 'number') {
          const validatedValue = Math.max(0, Math.min(100, value));
          updates.memoryTypes.percentages[type] = validatedValue;
          config.memoryTypes.percentages[type] = validatedValue;
        }
      }
    }

    // Save to unified config
    saveConfig(updates);

    return new Response(
      JSON.stringify({
        success: true,
        config,
        message: 'Training data configuration updated successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Failed to update training data configuration',
      }),
      {
        status: error?.status || 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// Apply owner-only guard to POST (only owners can modify training settings)
export const GET = getHandler;
export const POST = requireOwner(postHandler);
