/**
 * Monitor API Handlers
 *
 * Unified handlers for agent monitoring.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  listAvailableAgents,
  getAgentLogs,
  getAgentStats,
  getAgentStatuses,
  getAgentMetrics,
} from '../../agent-monitor.js';

/**
 * GET /api/monitor - Get agent monitoring data
 * Query params:
 *   - view: 'overview' | 'agent' | 'logs' (default: 'overview')
 *   - name: agent name (required for view=agent)
 *   - agent: agent name filter for logs (optional for view=logs)
 *   - limit: number of logs to return (default: 50)
 */
export async function handleGetMonitor(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { query } = req;

  try {
    const view = query.view || 'overview';

    switch (view) {
      case 'overview': {
        const agents = listAvailableAgents();
        const statuses = getAgentStatuses();
        const recentLogs = getAgentLogs(undefined, 50);

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

        return successResponse({
          agents: agentMetrics,
          recentLogs,
        });
      }

      case 'agent': {
        const agentName = query.name;
        if (!agentName) {
          return { status: 400, error: 'Agent name required' };
        }

        const stats = getAgentStats(agentName);
        const logs = getAgentLogs(agentName, 100);

        return successResponse({ stats, logs });
      }

      case 'logs': {
        const agentName = query.agent || undefined;
        const limit = query.limit ? parseInt(query.limit, 10) : 50;
        const logs = getAgentLogs(agentName, limit);

        return successResponse({ logs });
      }

      default:
        return { status: 400, error: 'Invalid view parameter' };
    }
  } catch (error) {
    console.error('[monitor] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
