/**
 * API endpoint for streaming agent monitor metrics in real-time
 * Uses Server-Sent Events (SSE) for live updates
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  systemPaths,
  getAgentStatuses,
  getAgentMetrics,
  listAvailableAgents,
} from '@metahuman/core';

export const GET: APIRoute = ({ request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      let currentDay = new Date().toISOString().split('T')[0];
      let auditFile = path.join(systemPaths.logs, 'audit', `${currentDay}.ndjson`);

      let lastPosition = 0;
      let fileExists = fs.existsSync(auditFile);
      let isClosed = false;

      const sendEvent = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
          // Controller already closed, mark as closed to stop sending
          isClosed = true;
        }
      };

      const sendMetricsUpdate = () => {
        if (isClosed) return;
        try {
          const statuses = getAgentStatuses();
          const agents = listAvailableAgents();

          // Build comprehensive metrics for each agent
          const agentMetrics = agents.map((name) => {
            const status = statuses.find((s) => s.name === name);
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

          sendEvent({
            type: 'metrics',
            timestamp: new Date().toISOString(),
            agents: agentMetrics,
          });
        } catch (error) {
          console.error('Error computing metrics:', error);
        }
      };

      const readNewLines = () => {
        // Check if day has rolled over
        const newDay = new Date().toISOString().split('T')[0];
        if (newDay !== currentDay) {
          // Day changed - switch to new audit file
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
          if (stats.size <= lastPosition) {
            return; // No new data
          }

          const stream = fs.createReadStream(auditFile, {
            start: lastPosition,
            encoding: 'utf8',
          });

          let buffer = '';
          let hasAgentEvent = false;

          stream.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const entry = JSON.parse(line);
                  // Check if this is an agent-related event
                  if (
                    entry.event?.includes('agent_') ||
                    entry.details?.agent ||
                    entry.actor?.includes('agent') ||
                    entry.actor?.includes('-service')
                  ) {
                    hasAgentEvent = true;
                  }
                } catch {
                  /* ignore malformed json */
                }
              }
            }
          });

          stream.on('end', () => {
            lastPosition = stats.size;
            // If we saw agent events, send updated metrics
            if (hasAgentEvent) {
              sendMetricsUpdate();
            }
          });
        } catch {
          // File might have been deleted or is otherwise inaccessible
          fileExists = false;
          lastPosition = 0;
        }
      };

      // Send initial metrics
      sendEvent({ type: 'connected' });
      sendMetricsUpdate();

      // Check for new audit entries every 30 seconds (reduced from 1s to prevent 100% CPU)
      // 24MB log file causes massive CPU when polled every second
      const auditInterval = setInterval(readNewLines, 30000);

      // Also send periodic metrics updates every 30 seconds (in case no audit events)
      const metricsInterval = setInterval(sendMetricsUpdate, 30000);

      request.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(auditInterval);
        clearInterval(metricsInterval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
