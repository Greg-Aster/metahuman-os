/**
 * Agent Handler - Start autonomous agents
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { errorResponse, notFoundResponse } from '../types.js';
import { spawn } from 'child_process';
import { systemPaths, ROOT, audit, registerAgent, unregisterAgent } from '../../index.js';
import path from 'node:path';
import fs from 'node:fs';

export async function handleStartAgent(req: UnifiedRequest): Promise<UnifiedResponse> {
  // User is already authenticated by router (requiresAuth: true)
  const user = req.user;

  const { agentName } = req.body || {};

  if (!agentName) {
    return errorResponse('agentName is required', 400);
  }

  const agentPath = `${systemPaths.brain}/agents/${agentName}.ts`;

  if (!fs.existsSync(agentPath)) {
    return notFoundResponse(`Agent not found: ${agentName}`);
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

    const child = spawn(tsxCmd, [agentPath], {
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
