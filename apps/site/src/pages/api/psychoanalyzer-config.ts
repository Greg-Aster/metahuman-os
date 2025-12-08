import type { APIRoute } from 'astro';
import { ROOT } from '@metahuman/core/paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit, getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

const configPath = path.join(ROOT, 'etc', 'psychoanalyzer.json');

export interface MemorySelectionConfig {
  strategy: string;
  daysBack: number;
  maxMemories: number;
  minMemories: number;
  excludeTypes: string[];
  priorityTags: string[];
}

export interface AnalysisConfig {
  model: string;
  temperature: number;
  focusAreas: string[];
  confidenceThreshold: number;
  maxTokens?: number;
}

export interface UpdateStrategyConfig {
  mode: string;
  preserveUserEdits: boolean;
  mergeStrategy: string;
  fields: Record<string, boolean>;
}

export interface PsychoanalyzerConfig {
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
 * GET /api/psychoanalyzer-config
 * Retrieve the psychoanalyzer configuration
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);

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

    return new Response(
      JSON.stringify({
        success: true,
        config,
        backendInfo,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to load config:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/psychoanalyzer-config
 * Update psychoanalyzer configuration (owner only)
 */
const postHandler: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

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

    return new Response(
      JSON.stringify({
        success: true,
        config,
        backendInfo,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to update config:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap POST with owner-only guard
export const POST = requireOwner(postHandler);
