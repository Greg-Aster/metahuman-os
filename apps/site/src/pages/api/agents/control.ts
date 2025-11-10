import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  stopAllAgents,
  paths,
  registerAgent,
  unregisterAgent,
  audit,
} from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

type BulkAction = 'stop-all' | 'restart-core';

const CORE_SERVICES = ['headless-watcher', 'scheduler-service', 'boredom-service', 'sleep-service'] as const;

interface StartResult {
  agent: string;
  started: boolean;
  pid?: number;
  error?: string;
}

function resolveTsx(): string {
  if (process.platform === 'win32') {
    return path.join(paths.root, 'node_modules', '.bin', 'tsx.cmd');
  }
  const candidate = path.join(paths.root, 'node_modules', '.bin', 'tsx');
  return fs.existsSync(candidate) ? candidate : 'tsx';
}

function startService(agentName: string, actor: string): StartResult {
  try {
    const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      return { agent: agentName, started: false, error: 'Agent file not found' };
    }

    const runner = resolveTsx();
    const child = spawn(runner, [agentPath], {
      stdio: 'ignore',
      cwd: paths.root,
      detached: true,
      env: {
        ...process.env,
        NODE_PATH: [
          path.join(paths.root, 'node_modules'),
          path.join(paths.root, 'packages/cli/node_modules'),
          path.join(paths.root, 'apps/site/node_modules'),
        ].join(':'),
      },
    });

    const pid = child.pid;
    if (!pid) {
      return { agent: agentName, started: false, error: 'Failed to spawn process' };
    }

    registerAgent(agentName, pid);
    audit({
      level: 'info',
      category: 'system',
      event: 'agent_started',
      details: { agent: agentName, pid, source: 'api/agents/control' },
      actor,
    });

    child.unref();
    child.on('close', (code: number) => {
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: 'agent_stopped',
        details: { agent: agentName, exitCode: code, source: 'api/agents/control' },
        actor,
      });
      unregisterAgent(agentName);
    });

    return { agent: agentName, started: true, pid };
  } catch (error) {
    return {
      agent: agentName,
      started: false,
      error: (error as Error).message,
    };
  }
}

const handler: APIRoute = async (context) => {
  try {
    const policy = getSecurityPolicy(context);
    if (policy.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, message: 'Authentication required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { action } = await context.request.json() as { action?: BulkAction };

    if (!action || (action !== 'stop-all' && action !== 'restart-core')) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid action' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stopSummary = stopAllAgents(false);
    audit({
      level: 'info',
      category: 'system',
      event: 'agent_bulk_stop',
      details: stopSummary,
      actor: policy.username ?? 'web_ui',
    });

    if (action === 'stop-all') {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Sent stop signal to ${stopSummary.total} agent(s)`,
          summary: stopSummary,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const actor = policy.username ?? 'system';
    const results = CORE_SERVICES.map(agent => startService(agent, actor));
    const started = results.filter(r => r.started);
    const failures = results.filter(r => !r.started);

    return new Response(
      JSON.stringify({
        success: failures.length === 0,
        message: `Restarted ${started.length}/${CORE_SERVICES.length} core services`,
        summary: stopSummary,
        started,
        failures,
      }),
      { status: failures.length ? 207 : 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[agent-control] Bulk action failed:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = handler;
