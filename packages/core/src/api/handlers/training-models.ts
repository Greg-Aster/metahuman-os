/**
 * Training Models API Handlers
 *
 * Returns available training base models from Ollama.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { OllamaClient } from '../../ollama.js';

interface TrainingModel {
  id: string;
  name: string;
  description: string;
  size: string;
  vram: string;
  license: string;
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Simple in-memory cache for Ollama model list
 * PERFORMANCE: Avoids repeated Ollama API calls
 */
let modelCache: { models: TrainingModel[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function getCachedModels(): TrainingModel[] | null {
  if (!modelCache) return null;
  const age = Date.now() - modelCache.timestamp;
  if (age > CACHE_TTL_MS) {
    modelCache = null;
    return null;
  }
  return modelCache.models;
}

function setCachedModels(models: TrainingModel[]): void {
  modelCache = { models, timestamp: Date.now() };
}

/**
 * GET /api/training-models - Get available Ollama models
 */
export async function handleGetTrainingModels(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Check cache first
    const cached = getCachedModels();
    if (cached) {
      return successResponse({
        success: true,
        models: cached,
        cached: true,
        notes: {
          usage: 'These are models available in your local Ollama installation',
          setup_guide: '/docs/user-guide/lora-training.md',
        },
      });
    }

    const ollama = new OllamaClient();

    // Check if Ollama is running
    const isRunning = await ollama.isRunning();
    if (!isRunning) {
      return {
        status: 503,
        error: 'Ollama is not running. Please start Ollama first.',
        data: { setupGuide: '/docs/user-guide/lora-training.md' },
      };
    }

    // Get list of available models
    const modelTags = await ollama.listModels();

    if (!modelTags || modelTags.length === 0) {
      return {
        status: 404,
        error: 'No models found in Ollama. Please pull at least one model first.',
        data: { setupGuide: '/docs/user-guide/lora-training.md' },
      };
    }

    // Format models for frontend
    const models: TrainingModel[] = modelTags.map(tag => ({
      id: tag.name,
      name: tag.name,
      description: `Modified: ${new Date(tag.modified_at).toLocaleDateString()}`,
      size: formatSize(tag.size),
      vram: 'Varies',
      license: 'See model details',
    }));

    // Cache the results
    setCachedModels(models);

    return successResponse({
      success: true,
      models,
      cached: false,
      notes: {
        usage: 'These are models available in your local Ollama installation',
        setup_guide: '/docs/user-guide/lora-training.md',
      },
    });
  } catch (error) {
    console.error('[training-models] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Failed to load training models from Ollama',
      data: { setupGuide: '/docs/user-guide/lora-training.md' },
    };
  }
}
