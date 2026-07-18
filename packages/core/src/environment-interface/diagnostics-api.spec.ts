import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import {
  handleEnvironmentBridgeDiagnosticAudio,
  handleEnvironmentBridgeDiagnosticMedia,
  handleEnvironmentBridgeDiagnostics,
  handleEnvironmentBridgeTelemetry,
} from '../api/handlers/environment-bridge.js';
import type { UnifiedRequest } from '../api/types.js';
import { resetEnvironmentBridgeDiagnosticsForTests } from './diagnostics.js';

const originalToken = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;

function request(overrides: Partial<UnifiedRequest> = {}): UnifiedRequest {
  return {
    path: '/api/environment-bridge/telemetry',
    method: 'POST',
    headers: {},
    user: {
      userId: 'diagnostics-spec',
      username: 'diagnostics-spec',
      role: 'owner',
      isAuthenticated: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'diagnostic-secret';
  resetEnvironmentBridgeDiagnosticsForTests();
});

afterEach(() => {
  resetEnvironmentBridgeDiagnosticsForTests();
  if (originalToken === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
  else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = originalToken;
});

test('service-token telemetry is aggregated and robot status is allowlisted', async () => {
  assert.equal((await handleEnvironmentBridgeTelemetry(request())).status, 401);
  const response = await handleEnvironmentBridgeTelemetry(request({
    headers: { Authorization: 'Bearer diagnostic-secret' },
    body: {
      sessionId: 'robot-session',
      intervalMs: 1000,
      inboundBytes: 640,
      microphoneLevel: 0.25,
      robotStatus: { vbat: 7.2, rssi: -48, secret: 'discard-me' },
      freestyleMovement: { supported: true, enabled: true, available: true },
      movementPlan: {
        actionId: 'plan-1',
        sequence: 12,
        status: 'active',
        frameCount: 3,
        durationMs: 1200,
        activeFrame: 2,
        updatedAt: '2026-07-17T21:00:00.000Z',
      },
    },
  }));

  assert.equal(response.status, 200);
  const snapshot = await handleEnvironmentBridgeDiagnostics(request({ method: 'GET' }));
  const session = snapshot.data.sessions[0];
  assert.equal(session.transport.inboundBytes, 640);
  assert.equal(session.microphoneLevel, 0.25);
  assert.equal(session.robotStatus.vbat, 7.2);
  assert.equal('secret' in session.robotStatus, false);
  assert.equal(session.freestyleMovement.available, true);
  assert.equal(session.movementPlan.actionId, 'plan-1');
  assert.equal(session.movementPlan.activeFrame, 2);
});

test('latest bounded diagnostic WAV can be read from the owner media handler', async () => {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36, 4);
  wav.write('WAVE', 8, 'ascii');

  const stored = await handleEnvironmentBridgeDiagnosticAudio(request({
    path: '/api/environment-bridge/diagnostics/audio',
    headers: {
      Authorization: 'Bearer diagnostic-secret',
      'X-Environment-Session-Id': 'robot-session',
      'X-Environment-Utterance-Id': 'utterance-1',
      'X-Environment-Duration-Ms': '20',
    },
    rawBody: wav,
  }));
  assert.equal(stored.status, 200);

  const media = await handleEnvironmentBridgeDiagnosticMedia(request({
    path: '/api/environment-bridge/diagnostics/media',
    method: 'GET',
    query: { sessionId: 'robot-session', kind: 'audio' },
  }));
  assert.equal(media.status, 200);
  assert.equal(media.contentType, 'audio/wav');
  assert.deepEqual(media.binary, wav);
  assert.equal(media.headers?.['Cache-Control'], 'private, no-store');
});
