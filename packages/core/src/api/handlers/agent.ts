/**
 * Agent Handler - Start autonomous agents
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit, getAgentMonitorSnapshot, startAgentProcess, stopAllAgents } from '../../index.js';
import { getAgentCatalogService } from '../../agent-catalog.js';
import { ensureQueueSystemStarted } from '../../queue/index.js';
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
  taskId?: string;
  queued?: boolean;
}

function json(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data };
}

async function runAllowedService(agentName: string, args: string[], actor: string, triggerUsername?: string): Promise<RunAgentResponse> {
  try {
    const catalogAgent = getAgentCatalogService().getAgent(agentName);
    if (!catalogAgent?.sourceReady) {
      return { success: false, agent: agentName, error: `Agent '${agentName}' is not installed or its executable is missing` };
    }
    if (catalogAgent.lifecycle !== 'service' || !catalogAgent.serviceRegistered) {
      return { success: false, agent: agentName, error: `${agentName} is finite work and must run through the Work Coordinator` };
    }
    if (!catalogAgent.enabled) {
      return { success: false, agent: agentName, error: `${agentName} is disabled in services.json` };
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
      const catalogAgent = getAgentCatalogService().getAgent(agent);
      if (!catalogAgent) {
        return json({ success: false, message: `Agent '${agent}' cannot be controlled from the UI` }, 400);
      }

      if (action === 'clear-failure') {
        clearAgentFailure(agent);
        return json({ success: true, agent, message: `Cleared ${agent} failure` });
      }

      if (catalogAgent.lifecycle !== 'service' || !catalogAgent.serviceRegistered) {
        return json({ success: false, agent, message: `${agent} is finite work; manage its task through the Work Coordinator` }, 409);
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

      const result = await runAllowedService(agent, [], actor, req.user.username);
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
      .filter(agent => agent.enabled && agent.startOnSystemBoot)
      .map(agent => agent.agentId);
    const agentsToRestart = [...new Set(bootAgents)];
    const results = await Promise.all(agentsToRestart.map(agent => startAgentProcess(agent, {
      actor,
      source: 'api/agents/control',
      useBootstrap: true,
      detached: true,
      waitForMs: 5_000,
      checkLock: true,
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

    const catalogAgent = getAgentCatalogService().getAgent(agent);
    let result: RunAgentResponse;
    if (!catalogAgent || !catalogAgent.sourceReady) {
      result = { success: false, agent, error: `Agent '${agent}' is not installed or its executable is missing` };
    } else if (!catalogAgent.canRun) {
      result = { success: false, agent, error: catalogAgent.triggerRegistered || catalogAgent.serviceRegistered
        ? `Agent '${agent}' is disabled in its lifecycle configuration`
        : `Agent '${agent}' requires explicit Agent Catalog registration before it can run` };
    } else if (catalogAgent.lifecycle === 'service') {
      result = await runAllowedService(agent, args, req.user.username, req.user.username);
    } else {
      const system = await ensureQueueSystemStarted();
      if (catalogAgent.triggerRegistered) {
        const taskId = system.triggerAgent(agent, req.user.username, args);
        result = taskId
          ? { success: true, agent, taskId, queued: true }
          : { success: false, agent, error: `Trigger '${agent}' did not admit work; check its enabled state and Trigger Manager health` };
      } else {
        const task = system.enqueueFiniteAgent(agent, req.user.username, args);
        result = { success: true, agent, taskId: task.id, queued: true };
      }
    }
    const status = result.success ? (result.queued ? 202 : 200) : (result.alreadyRunning ? 409 : 400);

    return {
      status,
      data: result,
    };
  } catch (error) {
    console.error('[agent-run] Failed:', error);
    return json({ success: false, error: 'Internal error' }, 500);
  }
}
