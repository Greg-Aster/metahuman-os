import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Socket } from 'node:net';
import test, { after, afterEach, mock } from 'node:test';
import type { EnvironmentObservation } from './types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-perception-'));
process.env.METAHUMAN_ROOT = root;
const network = mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Fixture has no event bus'), { code: 'ECONNREFUSED' })));
  return this;
});
const core = await import('./index.js');
const { getQueueManager } = await import('../queue/index.js');
const { environmentBridgeInputNode } = await import('../nodes/environment/bridge-input.node.js');
const { handleEnvironmentBridgeTelemetry } = await import('../api/handlers/environment-bridge.js');
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
afterEach(() => core.writeEnvironmentBridgeState({ enabled: true, updatedAt: new Date().toISOString(), sessions: {}, feedback: [] }));
after(() => { network.mock.restore(); fs.rmSync(root, { recursive: true, force: true }); });

function observation(epoch = 7, gatewayInstance = 'fixture-gateway'): EnvironmentObservation {
  const timestamp = new Date().toISOString();
  return { environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'robot-session', timestamp,
    capabilities: { actions: ['captureImage'], visual: true },
    visual: { id: 'requested-still', timestamp, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
    state: { body: { authenticated: true, robotId: 'robot', cameraReady: true },
      gateway: { robots: { robot: { epoch, connection_state: 'online' } } },
      activeMovementUpdates: { gatewayInstance } } };
}

function perception(counter = 1, changes: Record<string, unknown> = {}) {
  const now = Date.now();
  return { version: 1, robotId: 'robot', epoch: 7, gatewayInstance: 'fixture-gateway', frameCounter: counter,
    timeBasis: 'gateway_receipt', observedAt: new Date(now - 20).toISOString(), expiresAt: new Date(now + 1000).toISOString(),
    backend: 'fixture-vision', model: 'fixture', summary: 'Small metal objects on a table',
    objects: [{ label: 'keys', box: { x: 0.4, y: 0.5, width: 0.002, height: 0.003 } }],
    uncertainties: ['Identity is unverified'], ...changes };
}

test('recognition accepts small objects and optional localization without inventing scores', () => {
  const normalized = core.normalizeEnvironmentPerception(perception());
  assert.equal(normalized.objects[0].box?.width, 0.002);
  assert.equal(normalized.objects[0].score, undefined);
  assert.deepEqual(core.normalizeEnvironmentPerception(perception(2, { objects: [{ label: 'table' }] })).objects,
    [{ label: 'table' }]);
  for (const changes of [{ action: 'walk' }, { version: 2 }, { timeBasis: 'sensor_capture' },
    { objects: [{ label: 'keys', score: true }] }, { objects: [{ label: 'keys', score: NaN }] },
    { objects: [{ label: 'keys', verified: true }] }, { objects: [{ label: 'keys', distance: 0.5 }] },
    { objects: [{ label: 'keys', box: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } }] },
    { expiresAt: new Date(Date.now() + 60_000).toISOString() }, { frameCounter: -1 }]) {
    assert.throws(() => core.normalizeEnvironmentPerception(perception(1, changes)));
  }
});

test('camera identity, receipt age, expiry and transport changes fence recognition', () => {
  const source = observation();
  assert.ok(core.currentEnvironmentPerception(source, perception()));
  for (const changes of [{ robotId: 'other' }, { epoch: 8 }, { gatewayInstance: 'other' },
    { observedAt: new Date(Date.now() + 100).toISOString() },
    { observedAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
    assert.equal(core.currentEnvironmentPerception(source, perception(1, changes)), null);
  }
  assert.equal(core.currentEnvironmentPerception({ ...source, state: { ...source.state,
    body: { authenticated: true, robotId: 'robot', cameraReady: false } } }, perception()), null);
  assert.equal(core.currentEnvironmentPerception({ ...source, state: { ...source.state,
    gateway: { robots: { robot: { epoch: 7, connection_state: 'stale' } } } } }, perception()), null);
});

test('telemetry exposes current recognition to task graphs while preserving stills and queue ownership', async () => {
  const originalToken = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-token';
  const queue = getQueueManager();
  const before = queue.getAllTasks().length;
  const source = observation();
  core.recordEnvironmentObservation(source);
  const seenAt = core.readEnvironmentBridgeState().sessions['robot-session'].lastSeenAt;
  const request = (value: unknown, token = 'fixture-token') => ({ path: '/api/environment-bridge/telemetry',
    user: { userId: 'fixture', username: 'fixture', role: 'guest' as const, isAuthenticated: false },
    method: 'POST' as const, headers: { authorization: `Bearer ${token}` }, body: { sessionId: source.sessionId, perception: value } });
  try {
    assert.equal((await handleEnvironmentBridgeTelemetry(request(perception(), 'wrong'))).status, 401);
    assert.equal((await handleEnvironmentBridgeTelemetry(request(perception(1, { action: 'walk' })))).status, 400);
    const response = await handleEnvironmentBridgeTelemetry(request(perception()));
    assert.equal(response.status, 200);
    assert.equal((response.data as any).perceptionAccepted, true);
    assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception()), false, 'same frame cannot replace its interpretation');
    assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(0)), false, 'older results cannot replace current state');
    const output = await environmentBridgeInputNode.execute({}, { environmentObservation: source } as any, {});
    assert.equal((output.perception as any).objects[0].label, 'keys');
    assert.deepEqual((output.observation as EnvironmentObservation).state?.perception, output.perception,
      'existing observation edges must expose current recognition to the task context');
    assert.equal(source.state?.perception, undefined, 'live projection must not alter the triggering observation');
    assert.deepEqual(core.getLatestEnvironmentObservation(source.sessionId)?.visual, source.visual);
    assert.equal(core.readEnvironmentBridgeState().sessions[source.sessionId].lastSeenAt, seenAt);
    assert.equal(queue.getAllTasks().length, before, 'sensor results must not create cognitive or body jobs');
    core.recordEnvironmentObservation({ ...source, timestamp: new Date().toISOString() });
    assert.ok(core.getEnvironmentPerception(source.sessionId), 'normal still/status observations preserve fresh recognition');
    core.recordEnvironmentObservation(observation(8));
    assert.equal(core.getEnvironmentPerception(source.sessionId), null);
    assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(2)), false);
    assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(2, { epoch: 8 })), true);
    const oldSession = await environmentBridgeInputNode.execute({}, { environmentObservation: source } as any, {});
    assert.equal(oldSession.perception, null, 'a trigger from the prior body epoch cannot read the new body');
    core.recordEnvironmentObservation(observation(7, 'new-gateway'));
    assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(3)), false);
  } finally {
    if (originalToken === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
    else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = originalToken;
  }
});

test('expiry hides previous recognition and unsigned camera counters can wrap', async () => {
  const source = observation();
  core.recordEnvironmentObservation(source);
  assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(0xffffffff)), true);
  assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(0)), true);
  assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(0xffffffff)), false);
  const state = core.readEnvironmentBridgeState();
  state.sessions[source.sessionId].latestObservation!.state!.perception = perception(0, {
    observedAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  core.writeEnvironmentBridgeState(state);
  assert.equal(core.getEnvironmentPerception(source.sessionId), null);
  assert.equal(core.getLatestEnvironmentObservation(source.sessionId)?.state?.perception, undefined);
  assert.ok(core.readEnvironmentBridgeState().sessions[source.sessionId].latestObservation?.state?.perception,
    'live filtering must not rewrite recorded sensor evidence');
  state.sessions[source.sessionId].status = 'disconnected';
  core.writeEnvironmentBridgeState(state);
  assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(1)), false);
});
