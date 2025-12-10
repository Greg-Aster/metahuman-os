/**
 * Psychoanalyzer Config API Handlers
 *
 * GET/POST psychoanalyzer configuration for persona analysis.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';

const configPath = path.join(systemPaths.etc, 'psychoanalyzer.json');

interface MemorySelectionConfig {
  strategy: string;
  daysBack: number;
  maxMemories: number;
  minMemories: number;
  excludeTypes: string[];
  priorityTags: string[];
}

interface AnalysisConfig {
  model: string;
  temperature: number;
  focusAreas: string[];
  confidenceThreshold: number;
  maxTokens?: number;
}

interface UpdateStrategyConfig {
  mode: string;
  preserveUserEdits: boolean;
  mergeStrategy: string;
  fields: Record<string, boolean>;
}

interface PsychoanalyzerConfig {
  enabled: boolean;
  backend?: 'auto' | 'local' | 'cloud' | 'bigbrother';
  memorySelection: MemorySelectionConfig;
  analysis: AnalysisConfig;
  updateStrategy: UpdateStrategyConfig;
  reconciliation: {
    enabled: boolean;
    removeStaleGoals: boolean;
    removeStaleInterests: boolean;
    updateGoalStatuses: boolean;
    removeContradictedValues: boolean;
    removeUnusedHeuristics: boolean;
  };
}

// Default backend descriptions for UI
const backendInfo = {
  auto: {
    name: 'Auto',
    description: 'Uses currently active backend (Ollama/vLLM)',
    contextWindow: 'Varies',
    maxTokens: 'Varies',
  },
  local: {
    name: 'Local',
    description: 'Ollama or vLLM on local hardware',
    contextWindow: '4K-8K',
    maxTokens: '2048',
  },
  cloud: {
    name: 'Cloud (RunPod)',
    description: 'Qwen3-Coder-30B on RunPod serverless',
    contextWindow: '32K',
    maxTokens: '4096',
  },
  bigbrother: {
    name: 'Big Brother (Claude)',
    description: 'Claude Code CLI for complex analysis',
    contextWindow: 'Unlimited',
    maxTokens: 'Unlimited',
  },
};

/**
 * GET /api/psychoanalyzer-config - Get psychoanalyzer configuration
 */
export async function handleGetPsychoanalyzerConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Read config file
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData) as PsychoanalyzerConfig;

    // Add default backend if not present
    if (!config.backend) {
      config.backend = 'auto';
    }

    // Add maxTokens if not present
    if (!config.analysis.maxTokens) {
      config.analysis.maxTokens = 800;
    }

    return successResponse({
      success: true,
      config,
      backendInfo,
    });
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to load config:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/psychoanalyzer-config - Update psychoanalyzer configuration
 */
export async function handleSetPsychoanalyzerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Only owner can update psychoanalyzer config' };
  }

  try {
    // Read current config
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    const changes: string[] = [];

    // Update enabled
    if (typeof body.enabled === 'boolean') {
      config.enabled = body.enabled;
      changes.push('enabled');
    }

    // Update backend
    if (body.backend && ['auto', 'local', 'cloud', 'bigbrother'].includes(body.backend)) {
      config.backend = body.backend;
      changes.push('backend');
    }

    // Update memory selection
    if (body.memorySelection) {
      config.memorySelection = {
        ...config.memorySelection,
        ...body.memorySelection,
      };
      changes.push('memorySelection');
    }

    // Update analysis settings
    if (body.analysis) {
      config.analysis = {
        ...config.analysis,
        ...body.analysis,
      };
      changes.push('analysis');
    }

    // Update focus areas specifically
    if (body.focusAreas && Array.isArray(body.focusAreas)) {
      config.analysis.focusAreas = body.focusAreas;
      changes.push('analysis.focusAreas');
    }

    // Update updateStrategy fields
    if (body.updateStrategy) {
      config.updateStrategy = {
        ...config.updateStrategy,
        ...body.updateStrategy,
      };
      changes.push('updateStrategy');
    }

    // Update reconciliation
    if (body.reconciliation) {
      config.reconciliation = {
        ...config.reconciliation,
        ...body.reconciliation,
      };
      changes.push('reconciliation');
    }

    // Write updated config
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'system',
      event: 'psychoanalyzer_config_updated',
      details: {
        changes,
        backend: body.backend,
        memorySelection: body.memorySelection,
        analysis: body.analysis,
      },
      actor: user.username,
    });

    console.log(`[psychoanalyzer-config] Updated by ${user.username}: ${changes.join(', ')}`);

    return successResponse({
      success: true,
      config,
      backendInfo,
    });
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to update config:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
