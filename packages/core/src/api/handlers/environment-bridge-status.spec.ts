import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvironmentBridgeSummary } from '../../environment-interface/index.js';
import { environmentBridgeSessionOptions } from './environment-bridge.js';

test('session-options view omits stored observation payloads', () => {
  const summary: EnvironmentBridgeSummary = {
    enabled: true,
    updatedAt: '2026-09-02T12:00:00.000Z',
    sessionCount: 1,
    pendingCommandCount: 2,
    sessions: [{
      sessionId: 'robot-1',
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      status: 'connected',
      firstSeenAt: '2026-09-02T11:00:00.000Z',
      lastSeenAt: '2026-09-02T12:00:00.000Z',
      latestObservation: {
        environmentId: 'ainekio',
        adapter: 'ainekio-gateway',
        sessionId: 'robot-1',
        timestamp: '2026-09-02T12:00:00.000Z',
        capabilities: { actions: [] },
        visual: {
          id: 'frame-1',
          timestamp: '2026-09-02T12:00:00.000Z',
          dataUrl: 'data:image/jpeg;base64,large-payload',
        },
      },
    }],
  };

  assert.deepEqual(environmentBridgeSessionOptions(summary), {
    enabled: true,
    updatedAt: '2026-09-02T12:00:00.000Z',
    sessionCount: 1,
    sessions: [{
      sessionId: 'robot-1',
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      status: 'connected',
      lastSeenAt: '2026-09-02T12:00:00.000Z',
    }],
  });
});
