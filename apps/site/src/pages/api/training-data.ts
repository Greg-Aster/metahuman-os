/**
 * API endpoint for managing training data collection configuration
 *
 * GET: Retrieve current training data configuration
 * POST: Update training data configuration
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, systemPaths } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

const CONFIG_PATH = path.join(systemPaths.etc, 'training-data.json');

interface TrainingDataConfig {
  curator: {
    batchSize: number;
    qualityThreshold: number;
    temperature: number;
  };
  collection: {
    maxDays: number;
    maxSamplesPerSource: number;
  };
  memoryTypes: {
    enabled: string[];
    priorities: Record<string, number>;
  };
  phases: {
    description: string;
    phase1_conservative: any;
    phase2_optimal: any;
    phase3_maximum: any;
  };
}

/**
 * Load training data configuration
 */
function loadConfig(): TrainingDataConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      // Return default config if file doesn't exist
      return getDefaultConfig();
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('[training-data] Failed to load config:', error);
    return getDefaultConfig();
  }
}

/**
 * Save training data configuration
 */
function saveConfig(config: TrainingDataConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
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

    // Load current config
    const config = loadConfig();

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

    // Save updated config
    saveConfig(config);

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
