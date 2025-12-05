import type { APIRoute } from 'astro';
import { ROOT } from '@metahuman/core/paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit, getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

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
 * GET /api/scheduler-config
 * Retrieve the full scheduler configuration from etc/agents.json
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    const configData = await fs.readFile(agentsConfigPath, 'utf-8');
    const config = JSON.parse(configData);

    return new Response(
      JSON.stringify({
        success: true,
        globalSettings: config.globalSettings || {},
        agents: config.agents || {},
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[scheduler-config] Failed to load config:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/scheduler-config
 * Update scheduler configuration (owner only)
 * Body: { globalSettings?: Partial<GlobalSettings>, agents?: Record<string, Partial<AgentConfig>> }
 */
const postHandler: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

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

    return new Response(
      JSON.stringify({
        success: true,
        globalSettings: config.globalSettings,
        agents: config.agents,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[scheduler-config] Failed to update config:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap POST with owner-only guard
export const POST = requireOwner(postHandler);
