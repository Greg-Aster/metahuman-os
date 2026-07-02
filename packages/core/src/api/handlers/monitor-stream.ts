import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { streamResponse } from '../types.js';
import { getAgentMetrics, getAgentStatuses, listAvailableAgents } from '../../agent-monitor.js';
import { systemPaths } from '../../path-builder.js';

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleMonitorStream: UnifiedHandler = async (req) => {
  const response = streamResponse(streamMonitorUpdates(req.signal));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
};

async function* streamMonitorUpdates(signal: AbortSignal | undefined): AsyncGenerator<string> {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  let currentDay = new Date().toISOString().split('T')[0];
  let auditFile = path.join(systemPaths.logs, 'audit', `${currentDay}.ndjson`);
  let lastPosition = 0;
  let fileExists = fs.existsSync(auditFile);

  const push = (data: Record<string, unknown>) => {
    if (closed) return;
    queue.push(sse(data));
    wake?.();
    wake = undefined;
  };

  const close = () => {
    closed = true;
    wake?.();
    wake = undefined;
  };

  const sendMetricsUpdate = () => {
    if (closed) return;
    try {
      const statuses = getAgentStatuses();
      const agents = listAvailableAgents();

      if (agents.length === 0) {
        console.warn('[monitor/stream] No agents found by listAvailableAgents()');
        console.warn('[monitor/stream] systemPaths.agents:', systemPaths.agents);
        console.warn('[monitor/stream] agents dir exists:', fs.existsSync(systemPaths.agents));
      }

      const agentMetrics = agents.map((name) => {
        const status = statuses.find((item) => item.name === name);
        const metrics = getAgentMetrics(name);

        return {
          name,
          status: status?.status || 'stopped',
          pid: status?.pid,
          uptime: status?.uptime,
          lastActivity: status?.lastActivity,
          metrics: {
            totalRuns: metrics.totalRuns,
            successfulRuns: metrics.successfulRuns,
            failedRuns: metrics.failedRuns,
            lastRun: metrics.lastRun,
            lastError: metrics.lastError,
            recentActivity: metrics.recentActivity,
            successRate: metrics.successRate,
          },
          errors: status?.errors || [],
        };
      });

      push({
        type: 'metrics',
        timestamp: new Date().toISOString(),
        agents: agentMetrics,
      });
    } catch (error) {
      console.error('Error computing metrics:', error);
    }
  };

  const readNewLines = () => {
    const newDay = new Date().toISOString().split('T')[0];
    if (newDay !== currentDay) {
      currentDay = newDay;
      auditFile = path.join(systemPaths.logs, 'audit', `${currentDay}.ndjson`);
      lastPosition = 0;
      fileExists = fs.existsSync(auditFile);
    }

    if (!fileExists) {
      fileExists = fs.existsSync(auditFile);
      if (!fileExists) return;
    }

    try {
      const stats = fs.statSync(auditFile);
      if (stats.size <= lastPosition) return;

      const auditStream = fs.createReadStream(auditFile, {
        start: lastPosition,
        encoding: 'utf8',
      });

      let buffer = '';
      let hasAgentEvent = false;

      auditStream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (
              entry.event?.includes('agent_') ||
              entry.details?.agent ||
              entry.actor?.includes('agent') ||
              entry.actor?.includes('-service')
            ) {
              hasAgentEvent = true;
            }
          } catch {
            // Ignore malformed audit lines.
          }
        }
      });

      auditStream.on('end', () => {
        lastPosition = stats.size;
        if (hasAgentEvent) sendMetricsUpdate();
      });
    } catch {
      fileExists = false;
      lastPosition = 0;
    }
  };

  push({ type: 'connected' });
  sendMetricsUpdate();

  const auditInterval = setInterval(readNewLines, 30000);
  const metricsInterval = setInterval(sendMetricsUpdate, 30000);
  signal?.addEventListener('abort', close, { once: true });

  try {
    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield queue.shift()!;
    }
  } finally {
    clearInterval(auditInterval);
    clearInterval(metricsInterval);
    signal?.removeEventListener('abort', close);
    close();
  }
}
