import { defineNode } from '../types.js';
import {
  getEnvironmentBridgeDiagnosticsSnapshot,
  summarizeEnvironmentBridgeState,
} from '../../environment-interface/index.js';

export const environmentBridgeStatusNode = defineNode({
  id: 'environment_bridge_status',
  name: 'Environment Bridge Status',
  category: 'environment',
  inputs: [],
  outputs: [
    { name: 'summary', type: 'object', description: 'Current bridge summary' },
    { name: 'enabled', type: 'boolean', description: 'Whether the bridge is enabled' },
    { name: 'sessions', type: 'array', description: 'Known environment sessions' },
    { name: 'robotTelemetry', type: 'array', description: 'Bounded current robot telemetry by session' },
    { name: 'latestSessionId', type: 'string', description: 'Most recently seen session ID' },
    { name: 'pendingCommandCount', type: 'number', description: 'Number of active environment command work items' },
  ],
  description: 'Reads current environment bridge status without creating observations or actions.',
  async execute() {
    const summary = summarizeEnvironmentBridgeState();
    const diagnostics = getEnvironmentBridgeDiagnosticsSnapshot();
    const latestSession = [...summary.sessions]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];

    return {
      summary,
      enabled: summary.enabled,
      sessions: summary.sessions,
      robotTelemetry: diagnostics.sessions.slice(-8).map(session => ({
        sessionId: session.sessionId,
        robotId: session.robotId ?? '',
        updatedAt: session.updatedAt,
        robotStatus: session.robotStatus ?? {},
      })),
      latestSessionId: latestSession?.sessionId ?? '',
      pendingCommandCount: summary.pendingCommandCount,
    };
  },
});
