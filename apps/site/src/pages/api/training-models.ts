/**
 * API endpoint for retrieving available training base models
 *
 * GET: Returns the list of available models from local Ollama installation
 */

import type { APIRoute } from 'astro';
import { OllamaClient } from '@metahuman/core/ollama';

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
 * PERFORMANCE: Avoids repeated Ollama API calls on every page load
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
 * GET handler - Retrieve available training models from Ollama
 */
export const GET: APIRoute = async () => {
  try {
    // PERFORMANCE: Check cache first to avoid repeated Ollama API calls
    const cached = getCachedModels();
    if (cached) {
      return new Response(
        JSON.stringify({
          success: true,
          models: cached,
          cached: true,
          notes: {
            usage: 'These are models available in your local Ollama installation',
            setup_guide: '/docs/user-guide/lora-training.md',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const ollama = new OllamaClient();

    // Check if Ollama is running
    const isRunning = await ollama.isRunning();
    if (!isRunning) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ollama is not running. Please start Ollama first.',
          setupGuide: '/docs/user-guide/lora-training.md',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Get list of available models
    const modelTags = await ollama.listModels();

    if (!modelTags || modelTags.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No models found in Ollama. Please pull at least one model first.',
          setupGuide: '/docs/user-guide/lora-training.md',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
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

    // PERFORMANCE: Cache the results
    setCachedModels(models);

    return new Response(
      JSON.stringify({
        success: true,
        models,
        cached: false,
        notes: {
          usage: 'These are models available in your local Ollama installation',
          setup_guide: '/docs/user-guide/lora-training.md',
        },
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
        error: error?.message || 'Failed to load training models from Ollama',
        setupGuide: '/docs/user-guide/lora-training.md',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
