/**
 * Agent Handler - Start autonomous agents
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { errorResponse, notFoundResponse } from '../types.js';
import { spawn } from 'child_process';
import { systemPaths, ROOT, audit, registerAgent, unregisterAgent, stopAllAgents, isLocked } from '../../index.js';
import path from 'node:path';
import fs from 'node:fs';

type BulkAction = 'stop-all' | 'restart-core';

const CORE_SERVICES = ['headless-watcher', 'scheduler-service', 'boredom-service', 'sleep-service'] as const;

interface StartResult {
  agent: string;
  started: boolean;
  pid?: number;
  error?: string;
}

interface RunAgentResponse {
  success: boolean;
  agent: string;
  pid?: number;
  error?: string;
  alreadyRunning?: boolean;
}

const ALLOWED_AGENTS = [
  'profile-sync',
  'memory-sync',
  'update-check',
  'organizer',
  'curator',
  'ingestor',
  'summarizer',
  'digest',
  'reflector',
  'dreamer',
  'train-of-thought',
  'psychoanalyzer',
  'curiosity-service',
  'curiosity-researcher',
  'inner-curiosity',
  'desire-generator',
  'desire-planner',
  'desire-executor',
  'desire-outcome-reviewer',
  'environment-bridge',
  'audio-organizer',
  'transcriber',
];

function json(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data };
}

function resolveTsx(): string {
  const executable = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const candidates = [
    path.join(ROOT, 'apps', 'site', 'node_modules', '.bin', executable),
    path.join(ROOT, 'node_modules', '.bin', executable),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'tsx';
}

function buildNodePath(): string {
  return [
    path.join(ROOT, 'node_modules'),
    path.join(ROOT, 'packages/cli/node_modules'),
    path.join(ROOT, 'apps/site/node_modules'),
  ].join(':');
}

function startCoreService(agentName: string, actor: string): StartResult {
  try {
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      return { agent: agentName, started: false, error: 'Agent file not found' };
    }

    const child = spawn(resolveTsx(), [agentPath], {
      stdio: 'ignore',
      cwd: ROOT,
      detached: true,
      env: {
        ...process.env,
        NODE_PATH: buildNodePath(),
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

function resolveRunnableAgentPath(agentName: string): string | null {
  const newStylePath = path.join(systemPaths.brain, 'agents', agentName, 'cli.ts');
  if (fs.existsSync(newStylePath)) {
    return newStylePath;
  }

  const legacyPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return null;
}

function runAllowedAgent(agentName: string, args: string[], actor: string, triggerUsername?: string): RunAgentResponse {
  try {
    if (!ALLOWED_AGENTS.includes(agentName)) {
      return { success: false, agent: agentName, error: `Agent '${agentName}' is not allowed to be triggered via API` };
    }

    const lockName = `agent-${agentName}`;
    if (isLocked(lockName)) {
      return { success: false, agent: agentName, error: 'Agent is already running', alreadyRunning: true };
    }

    const agentPath = resolveRunnableAgentPath(agentName);
    if (!agentPath) {
      return { success: false, agent: agentName, error: 'Agent file not found' };
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      NODE_PATH: buildNodePath(),
    };

    if (triggerUsername) {
      env.MH_TRIGGER_USERNAME = triggerUsername;
    }

    const child = spawn(resolveTsx(), [agentPath, ...args], {
      stdio: 'inherit',
      cwd: ROOT,
      detached: true,
      env,
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

export async function handleStartAgent(req: UnifiedRequest): Promise<UnifiedResponse> {
  // User is already authenticated by router (requiresAuth: true)
  const user = req.user;

  const { agentName, options = {} } = req.body || {};

  if (!agentName) {
    return errorResponse('agentName is required', 400);
  }

  // Build CLI args from options
  const optionArgs: string[] = [];
  if (options.dryRun) optionArgs.push('--dry-run');
  if (options.verbose) optionArgs.push('--verbose');
  if (options.minLength !== undefined) optionArgs.push('--min-length', String(options.minLength));
  if (options.similarity !== undefined) optionArgs.push('--similarity', String(options.similarity));
  if (options.temperature !== undefined) optionArgs.push('--temperature', String(options.temperature));

  // Support both new directory structure and legacy flat files
  const possiblePaths = [
    path.join(systemPaths.brain, 'agents', agentName, 'cli.ts'),  // New: brain/agents/name/cli.ts
    path.join(systemPaths.brain, 'agents', agentName, 'core.ts'), // New: brain/agents/name/core.ts (if no cli)
    path.join(systemPaths.brain, 'training', `${agentName}.ts`),  // Training scripts
    path.join(systemPaths.brain, 'agents', `${agentName}.ts`),    // Legacy: brain/agents/name.ts
  ];

  const agentPath = possiblePaths.find(p => fs.existsSync(p));

  if (!agentPath) {
    return notFoundResponse(`Agent not found: ${agentName}. Checked: ${possiblePaths.map(p => path.basename(path.dirname(p)) + '/' + path.basename(p)).join(', ')}`);
  }

  console.log(`[Web UI] Spawning agent: ${agentName}...`);

  try {
    const startTime = Date.now();

    // Resolve tsx path inside workspace for reliability
    const tsxBin = process.platform === 'win32'
      ? path.join(ROOT, 'node_modules', '.bin', 'tsx.cmd')
      : path.join(ROOT, 'node_modules', '.bin', 'tsx');
    const tsxCmd = (tsxBin && fs.existsSync(tsxBin)) ? tsxBin : 'tsx';

    // Pass user context to agent via environment variables
    const envOverrides: Record<string, string> = {
      MH_TRIGGER_USERNAME: user.username,
      MH_TRIGGER_ROLE: user.role,
    };

    // Pass username to agent via CLI args (most agents require it)
    const agentArgs = [agentPath, '--username', user.username, ...optionArgs];

    const child = spawn(tsxCmd, agentArgs, {
      stdio: 'pipe', // Pipe output so we can log it
      cwd: ROOT,
      detached: true, // Detach from the web server process
      env: {
        ...process.env,
        ...envOverrides,
        NODE_PATH: [
          `${ROOT}/node_modules`,
          `${ROOT}/packages/cli/node_modules`,
          `${ROOT}/apps/site/node_modules`,
        ].join(':'),
      },
    });

    const pid = child.pid;

    if (pid) {
      // Register agent in running registry
      registerAgent(agentName, pid);

      // Audit agent start with username
      audit({
        level: 'info',
        category: 'system',
        event: 'agent_started',
        details: {
          agent: agentName,
          pid,
          triggeredBy: user.username,
        },
        actor: user.username,
      });
    }

    // Log stdout/stderr for debugging
    child.stdout.on('data', (data) => {
      console.log(`[Agent: ${agentName}] ${data.toString().trim()}`);
    });
    child.stderr.on('data', (data) => {
      console.error(`[Agent: ${agentName}] ${data.toString().trim()}`);
    });

    // Handle process exit
    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      // Unregister agent
      if (pid) {
        unregisterAgent(agentName);
      }

      // Audit agent exit
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: code === 0 ? 'agent_completed' : 'agent_failed',
        details: {
          agent: agentName,
          pid,
          exitCode: code,
          duration,
        },
      });
    });

    // Wait briefly to confirm spawn or catch immediate error
    const started = await new Promise<'spawned'|'timeout'>((resolve) => {
      let resolved = false;
      child.once('spawn', () => { if (!resolved) { resolved = true; resolve('spawned'); } });
      setTimeout(() => { if (!resolved) { resolved = true; resolve('timeout'); } }, 300);
    });

    child.unref(); // Allow parent process to exit independently

    return {
      status: 202, // Accepted
      data: { success: true, message: `Agent '${agentName}' started.`, pid, started },
    };
  } catch (error) {
    console.error(`[Web UI] Failed to start agent: ${(error as Error).message}`);

    audit({
      level: 'error',
      category: 'system',
      event: 'agent_failed',
      details: {
        agent: agentName,
        error: (error as Error).message,
        triggeredBy: user.username,
      },
      actor: user.username,
    });

    return errorResponse('Failed to start agent', 500);
  }
}

/**
 * POST /api/agents/control
 */
export async function handleAgentsControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { action } = (req.body || {}) as { action?: BulkAction };

    if (!action || (action !== 'stop-all' && action !== 'restart-core')) {
      return json({ success: false, message: 'Invalid action' }, 400);
    }

    const stopSummary = stopAllAgents(false);
    const actor = req.user.isAuthenticated ? req.user.username : 'web_ui';
    audit({
      level: 'info',
      category: 'system',
      event: 'agent_bulk_stop',
      details: stopSummary,
      actor,
    });

    if (action === 'stop-all') {
      return json({
        success: true,
        message: `Sent stop signal to ${stopSummary.total} agent(s)`,
        summary: stopSummary,
      });
    }

    const results = CORE_SERVICES.map(agent => startCoreService(agent, actor));
    const started = results.filter(r => r.started);
    const failures = results.filter(r => !r.started);

    return json({
      success: failures.length === 0,
      message: `Restarted ${started.length}/${CORE_SERVICES.length} core services`,
      summary: stopSummary,
      started,
      failures,
    }, failures.length ? 207 : 200);
  } catch (error) {
    console.error('[agent-control] Bulk action failed:', error);
    return json({ success: false, message: 'Internal error' }, 500);
  }
}

/**
 * POST /api/agents/run
 */
export async function handleRunAgent(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return json({ success: false, error: 'Authentication required' }, 403);
    }

    const body = (req.body || {}) as { agent?: string; args?: string[] };
    const { agent, args = [] } = body;

    if (!agent) {
      return json({ success: false, error: 'Agent name is required' }, 400);
    }

    const result = runAllowedAgent(agent, args, req.user.username, req.user.username);
    const status = result.success ? 200 : (result.alreadyRunning ? 409 : 400);

    return {
      status,
      data: result,
    };
  } catch (error) {
    console.error('[agent-run] Failed:', error);
    return json({ success: false, error: 'Internal error' }, 500);
  }
}
