/**
 * Monitor API Handlers
 *
 * Unified handlers for agent monitoring.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  getAgentLogs,
  getAgentMonitorSnapshot,
  getAgentStats,
  setAgentVariable,
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
  const query = req.query ?? {};

  try {
    const view = query.view || 'overview';

    switch (view) {
      case 'overview': {
        const snapshot = getAgentMonitorSnapshot();
        return successResponse({
          ...snapshot,
          agents: snapshot.runningAgents,
          recentLogs: getAgentLogs(undefined, 50),
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

export async function handleSetMonitorAgentVariable(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (req.user.role !== 'owner') {
      return { status: 403, error: 'Owner permission required' };
    }

    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const agent = typeof body.agent === 'string' ? body.agent.trim() : '';
    const key = typeof body.key === 'string' ? body.key.trim() : '';

    if (!agent || !key) {
      return { status: 400, error: 'agent and key are required' };
    }

    const agentData = setAgentVariable(agent, key, body.value);
    return successResponse({ success: true, agentData });
  } catch (error) {
    console.error('[monitor] Agent variable update failed:', error);
    return { status: 400, error: (error as Error).message };
  }
}
