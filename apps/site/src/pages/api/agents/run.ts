/**
 * Run Agent API
 *
 * POST /api/agents/run
 *
 * Triggers a specific agent to run in the background with optional arguments.
 * Used by UI to trigger manual agents like memory-sync and update-check.
 */

import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  ROOT,
  systemPaths,
  registerAgent,
  unregisterAgent,
  audit,
  isLocked,
} from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

interface RunAgentRequest {
  agent: string;
  args?: string[];
}

interface RunAgentResponse {
  success: boolean;
  agent: string;
  pid?: number;
  error?: string;
  alreadyRunning?: boolean;
}

function resolveTsx(): string {
  const candidates = [
    path.join(ROOT, 'apps', 'site', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
    path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'tsx';
}

// Allowed agents that can be triggered via API
const ALLOWED_AGENTS = [
  'profile-sync',
  'memory-sync',
  'update-check',
  'organizer',
  'reflector',
  'curator',
  'curiosity-service',
  'curiosity-researcher',
  'inner-curiosity',
  'psychoanalyzer',
  'desire-generator',
];

/**
 * Resolve agent path - supports both new-style directory agents and legacy single-file agents
 * New style: brain/agents/<name>/cli.ts
 * Legacy: brain/agents/<name>.ts
 */
function resolveAgentPath(agentName: string): string | null {
  // New-style agent directory with cli.ts
  const newStylePath = path.join(systemPaths.brain, 'agents', agentName, 'cli.ts');
  if (fs.existsSync(newStylePath)) {
    return newStylePath;
  }

  // Legacy single-file agent
  const legacyPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

function runAgent(agentName: string, args: string[], actor: string): RunAgentResponse {
  try {
    // Validate agent name
    if (!ALLOWED_AGENTS.includes(agentName)) {
      return { success: false, agent: agentName, error: `Agent '${agentName}' is not allowed to be triggered via API` };
    }

    // Check if already running
    const lockName = `agent-${agentName}`;
    if (isLocked(lockName)) {
      return { success: false, agent: agentName, error: 'Agent is already running', alreadyRunning: true };
    }

    const agentPath = resolveAgentPath(agentName);
    if (!agentPath) {
      return { success: false, agent: agentName, error: 'Agent file not found' };
    }

    const runner = resolveTsx();
    const child = spawn(runner, [agentPath, ...args], {
      stdio: 'ignore',
      cwd: ROOT,
      detached: true,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(ROOT, 'node_modules'),
          path.join(ROOT, 'packages/cli/node_modules'),
          path.join(ROOT, 'apps/site/node_modules'),
        ].join(':'),
      },
    });

    const pid = child.pid;
    if (!pid) {
      return { success: false, agent: agentName, error: 'Failed to spawn process' };
    }

    registerAgent(agentName, pid);
    audit({
      level: 'info',
      category: 'system',
      event: 'agent_started',
      details: { agent: agentName, pid, args, source: 'api/agents/run' },
      actor,
    });

    child.unref();
    child.on('close', (code: number) => {
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: 'agent_stopped',
        details: { agent: agentName, exitCode: code, source: 'api/agents/run' },
        actor,
      });
      unregisterAgent(agentName);
    });

    return { success: true, agent: agentName, pid };
  } catch (error) {
    return {
      success: false,
      agent: agentName,
      error: (error as Error).message,
    };
  }
}

const handler: APIRoute = async (context) => {
  try {
    const policy = getSecurityPolicy(context);
    if (policy.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json() as RunAgentRequest;
    const { agent, args = [] } = body;

    if (!agent) {
      return new Response(
        JSON.stringify({ success: false, error: 'Agent name is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const actor = policy.username ?? 'web_ui';
    const result = runAgent(agent, args, actor);

    const status = result.success ? 200 : (result.alreadyRunning ? 409 : 400);

    return new Response(
      JSON.stringify(result),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[agent-run] Failed:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = handler;
