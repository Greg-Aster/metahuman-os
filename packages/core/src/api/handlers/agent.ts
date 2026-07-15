/**
 * Agent Handler - Start autonomous agents
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit, getAgentMonitorSnapshot, startAgentProcess, stopAllAgents } from '../../index.js';
import {
  clearAgentFailure,
  isAgentRunning,
  isProcessRunning,
  stopAgent,
} from '../../agent-monitor-registry.js';

type AgentControlAction = 'stop-all' | 'restart-core' | 'stop' | 'restart' | 'clear-failure';

interface RunAgentResponse {
  success: boolean;
  agent: string;
  pid?: number;
  error?: string;
  exitCode?: number | null;
  stderr?: string;
  stdout?: string;
  completed?: boolean;
  alreadyRunning?: boolean;
}

const ALLOWED_AGENTS = [
  'profile-sync',
  'memory-sync',
  'memory-pruner',
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
  'audio-organizer',
  'transcriber',
  'environment-bridge',
];

function json(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data };
}

async function runAllowedAgent(agentName: string, args: string[], actor: string, triggerUsername?: string): Promise<RunAgentResponse> {
  try {
    if (!ALLOWED_AGENTS.includes(agentName)) {
      return { success: false, agent: agentName, error: `Agent '${agentName}' is not allowed to be triggered via API` };
    }

    const result = await startAgentProcess(agentName, {
      actor,
      source: 'api/agents/run',
      args,
      triggerUsername,
      useBootstrap: true,
      waitForMs: 5000,
      checkLock: true,
    });

    return {
      success: Boolean(result.success),
      agent: result.agent,
      pid: result.pid,
      error: result.error,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
      completed: result.completed,
      alreadyRunning: result.alreadyRunning,
    };
  } catch (error) {
    return {
      success: false,
      agent: agentName,
      error: (error as Error).message,
    };
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return !isProcessRunning(pid);
}

/**
 * POST /api/agents/control
 */
export async function handleAgentsControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { action, agent } = (req.body || {}) as { action?: AgentControlAction; agent?: string };

    if (!action || !['stop-all', 'restart-core', 'stop', 'restart', 'clear-failure'].includes(action)) {
      return json({ success: false, message: 'Invalid action' }, 400);
    }

    const actor = req.user.isAuthenticated ? req.user.username : 'web_ui';
    if (action === 'stop' || action === 'restart' || action === 'clear-failure') {
      if (!agent) {
        return json({ success: false, message: 'Agent name is required' }, 400);
      }
      if (!ALLOWED_AGENTS.includes(agent)) {
        return json({ success: false, message: `Agent '${agent}' cannot be controlled from the UI` }, 400);
      }

      if (action === 'clear-failure') {
        clearAgentFailure(agent);
        return json({ success: true, agent, message: `Cleared ${agent} failure` });
      }

      if (action === 'stop') {
        const result = stopAgent(agent);
        return json({ success: result.success, agent, message: result.message, result }, result.success ? 200 : 409);
      }

      const wasRunning = isAgentRunning(agent);
      if (wasRunning) {
        const stopResult = stopAgent(agent);
        if (!stopResult.success) {
          return json({ success: false, agent, message: stopResult.message, result: stopResult }, 409);
        }
        if (stopResult.pid && !await waitForProcessExit(stopResult.pid)) {
          return json({ success: false, agent, message: `${agent} did not stop in time` }, 409);
        }
      }

      const result = await runAllowedAgent(agent, [], actor, req.user.username);
      return json({
        ...result,
        message: result.success
          ? `${agent} ${wasRunning ? 'restarted' : 'started'}`
          : result.error || `Failed to restart ${agent}`,
      }, result.success ? 200 : (result.alreadyRunning ? 409 : 400));
    }

    const stopSummary = stopAllAgents(false);
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

    const bootAgents = getAgentMonitorSnapshot().bootAgents
      .filter(agent => agent.enabled && agent.runOnBoot)
      .map(agent => agent.agentId);
    const agentsToRestart = [...new Set(bootAgents)];
    const results = await Promise.all(agentsToRestart.map(agent => startAgentProcess(agent, {
      actor,
      source: 'api/agents/control',
      useBootstrap: true,
    })));
    const started = results.filter(r => r.started);
    const already = results.filter(r => r.alreadyRunning);
    const failures = results.filter(r => !r.started && !r.alreadyRunning);

    return json({
      success: failures.length === 0,
      message: `Restarted ${started.length}/${agentsToRestart.length} configured startup agent(s)`,
      summary: stopSummary,
      started,
      already,
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

    const result = await runAllowedAgent(agent, args, req.user.username, req.user.username);
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
