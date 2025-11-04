import type { APIRoute } from 'astro';
import {
  listAvailableAgents,
  getAgentLogs,
  getAgentStats,
  getAgentStatuses,
  getAgentMetrics,
  getProcessingStatus,
} from '@metahuman/core';

export const GET: APIRoute = async ({ url }) => {
  try {
    const view = url.searchParams.get('view') || 'overview';

    switch (view) {
      case 'overview': {
        const agents = listAvailableAgents();
        const statuses = getAgentStatuses();
        const processing = getProcessingStatus();
        const recentLogs = getAgentLogs(undefined, 50);

        // Shape processing status to what the UI expects
        const processingStatus = {
          processed: processing.processedMemories,
          total: processing.totalMemories,
          processedPercentage:
            processing.totalMemories > 0
              ? Math.round(
                  (processing.processedMemories / processing.totalMemories) * 100
                )
              : 0,
        };

        // Build comprehensive metrics for each agent (same shape as SSE endpoint)
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

        return new Response(
          JSON.stringify({
            agents: agentMetrics,
            processing: processingStatus,
            recentLogs,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      case 'agent': {
        const agentName = url.searchParams.get('name');
        if (!agentName) {
          return new Response(
            JSON.stringify({ error: 'Agent name required' }),
            { status: 400 }
          );
        }

        const stats = getAgentStats(agentName);
        const logs = getAgentLogs(agentName, 100);

        return new Response(
          JSON.stringify({ stats, logs }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      case 'processing': {
        const processing = getProcessingStatus();
        return new Response(
          JSON.stringify(processing),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      case 'logs': {
        const agentName = url.searchParams.get('agent') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const logs = getAgentLogs(agentName, limit);

        return new Response(
          JSON.stringify({ logs }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid view parameter' }),
          { status: 400 }
        );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
