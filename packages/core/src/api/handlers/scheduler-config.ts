/**
 * Scheduler Config API Handlers
 *
 * Unified handlers for agent scheduler configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { ROOT } from '../../paths.js';
import { audit } from '../../audit.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const agentsConfigPath = path.join(ROOT, 'etc', 'agents.json');

export interface AgentConfig {
  id: string;
  enabled: boolean;
  type: 'interval' | 'activity' | 'time-of-day' | 'manual';
  priority: 'high' | 'normal' | 'low';
  agentPath: string;
  usesLLM: boolean;
  interval?: number;
  inactivityThreshold?: number;
  schedule?: string;
  runOnBoot: boolean;
  autoRestart: boolean;
  maxRetries: number;
  comment?: string;
}

export interface GlobalSettings {
  pauseAll: boolean;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  maxConcurrentAgents: number;
  maxConcurrentLLMAgents: number;
  maxConcurrentNonLLMAgents: number;
  pauseQueueOnActivity: boolean;
  activityResumeDelay: number;
}

export interface SchedulerConfig {
  globalSettings: GlobalSettings;
  agents: Record<string, AgentConfig>;
}

/**
 * GET /api/scheduler-config - Retrieve scheduler configuration
 */
export async function handleGetSchedulerConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const configData = await fs.readFile(agentsConfigPath, 'utf-8');
    const config = JSON.parse(configData);

    return successResponse({
      success: true,
      globalSettings: config.globalSettings || {},
      agents: config.agents || {},
    });
  } catch (error) {
    console.error('[scheduler-config] Failed to load config:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/scheduler-config - Update scheduler configuration (owner only)
 * Body: { globalSettings?: Partial<GlobalSettings>, agents?: Record<string, Partial<AgentConfig>> }
 */
export async function handleSetSchedulerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner permission required' };
    }

    // Read current config
    const configData = await fs.readFile(agentsConfigPath, 'utf-8');
    const config = JSON.parse(configData);

    const changes: string[] = [];

    // Update global settings if provided
    if (body.globalSettings) {
      config.globalSettings = {
        ...config.globalSettings,
        ...body.globalSettings,
      };
      changes.push('globalSettings');
    }

    // Update individual agent settings if provided
    if (body.agents) {
      for (const [agentId, agentUpdates] of Object.entries(body.agents)) {
        if (config.agents[agentId]) {
          config.agents[agentId] = {
            ...config.agents[agentId],
            ...(agentUpdates as Partial<AgentConfig>),
          };
          changes.push(`agents.${agentId}`);
        }
      }
    }

    // Write updated config
    await fs.writeFile(agentsConfigPath, JSON.stringify(config, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'system',
      event: 'scheduler_config_updated',
      details: {
        changes,
        globalSettings: body.globalSettings,
        agentChanges: body.agents ? Object.keys(body.agents) : [],
      },
      actor: user.username,
    });

    console.log(`[scheduler-config] Updated by ${user.username}: ${changes.join(', ')}`);

    return successResponse({
      success: true,
      globalSettings: config.globalSettings,
      agents: config.agents,
    });
  } catch (error) {
    console.error('[scheduler-config] Failed to update config:', error);
    return { status: 500, error: (error as Error).message };
  }
}
