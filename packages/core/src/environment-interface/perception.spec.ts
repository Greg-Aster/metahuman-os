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
const { handleEnvironmentBridgeTelemetry, handleEnvironmentBridgeObservation } = await import('../api/handlers/environment-bridge.js');
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
afterEach(() => core.writeEnvironmentBridgeState({ enabled: true, updatedAt: new Date().toISOString(), sessions: {}, feedback: [] }));
after(() => { network.mock.restore(); fs.rmSync(root, { recursive: true, force: true }); });

test('recognition image association distinguishes every part of camera identity', () => {
  const source = { robotId: 'robot', gatewayInstance: 'gateway', epoch: 7, counter: 12 }
  const frame = { id: 'image', metadata: source }
  assert.deepEqual(core.recognitionImageAssociation(source, [frame]), {
    matchingVisualFrameIds: ['image'], imageAssociation: 'exact_frame' })
  for (const [key, value] of Object.entries(source)) {
    const changed = { ...source, [key]: typeof value === 'number' ? value + 1 : `${value}-other` }
    assert.equal(core.recognitionImageAssociation(source, [{ ...frame, metadata: changed }]).imageAssociation, 'different_frame')
    const missing: Record<string, unknown> = { ...source }; delete missing[key]
    assert.equal(core.recognitionImageAssociation(missing, [frame]).imageAssociation, 'different_frame')
  }
  assert.equal(core.recognitionImageAssociation(source, []).imageAssociation, 'no_image')
  assert.equal(core.recognitionImageAssociation(null, [frame]).imageAssociation, 'different_frame')
})

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

test('generic track IDs survive normalization and the existing bridge telemetry', async () => {
  const source = observation();
  core.recordEnvironmentObservation(source);
  const objects = [{ label: 'The keys with the distinctive red fabric loop beside the notebook, including the small brass key and the larger silver key', trackId: 'continuity-generation:7', box: { x: .1, y: .2, width: .3, height: .4 } }];
  assert.deepEqual(core.normalizeEnvironmentPerception(perception(1, { objects })).objects, objects);
  assert.equal(await core.recordEnvironmentPerception(source.sessionId, perception(1, { objects })), true);
  assert.deepEqual(core.getEnvironmentPerception(source.sessionId)?.objects, objects);
  assert.equal(core.getEnvironmentPerception(source.sessionId)?.objects[0].identity, undefined);
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

test('named people retain evidence state and never become verified identity', () => {
  const box = { x: .1, y: .1, width: .3, height: .7 };
  const face = { trackId: 'track-a', state: 'face_match', personId: 'person-a', name: 'Alice', faceAgeMs: 0, similarity: .7 };
  const tracked = { trackId: 'track-a', state: 'tracked', personId: 'person-a', name: 'Alice', faceAgeMs: 500 };
  for (const identity of [face, tracked, { trackId: 'track-b', state: 'unknown' }]) {
    const result = core.normalizeEnvironmentPerception(perception(1, { objects: [{ label: 'person', box, identity }] }));
    assert.deepEqual(result.objects[0].identity, identity);
  }
  for (const identity of [{ ...face, verified: true }, { ...face, similarity: NaN }, { ...face, faceAgeMs: 1 },
    { ...tracked, faceAgeMs: 3001 }, { trackId: 'track-b', state: 'unknown', name: 'Alice' }]) {
    assert.throws(() => core.normalizeEnvironmentPerception(perception(1, { objects: [{ label: 'person', box, identity }] })));
  }
  assert.throws(() => core.normalizeEnvironmentPerception(perception(1, { objects: [{ label: 'keys', box, identity: face }] })));
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

test('successive frames keep one pending perception wake and preserve the newest observation', async () => {
  const { openExecutionStore } = await import('../durable-execution/storage.js');
  const store = openExecutionStore('perception-owner');
  const queue = getQueueManager();
  const definition = { graphId: 'perception-wait', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} };
  const execution = store.create('perception-owner', definition);
  const lease = store.claim(execution.executionId, definition);
  store.settle(lease, 'waiting', 'active_task:robot-session:perception'); store.release(lease);
  const owner = queue.enqueue({ type: 'generic', handler: 'environment.active-task-deadline', username: 'perception-owner',
    input: { sessionId: 'robot-session' }, durable: { executionId: execution.executionId, effectId: 'owner-deadline', recovery: 'resume' } });
  const wakes: any[] = [];
  const enqueue = async (input: any) => { wakes.push(input); return queue.enqueue(input); };
  try {
    core.recordEnvironmentObservation(observation());
    await assert.rejects(core.recordEnvironmentPerception('robot-session', perception(1), async () => {
      throw new Error('Temporary queue outage');
    }, 'perception-owner'), /Temporary queue outage/);
    for (let frame = 2; frame <= 8; frame++) assert.equal(await core.recordEnvironmentPerception('robot-session', perception(frame), enqueue, 'perception-owner'), true);
    assert.equal(core.getEnvironmentPerception('robot-session')?.frameCounter, 8, 'Live state is latest-frame, not a buffered old frame');
    assert.equal(wakes.length, 1, 'Camera rate must not create an unbounded queue of equivalent wakes');
    const events = store.events(execution.executionId);
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as any).perception.frameCounter, 1, 'Historical event evidence is not rewritten');
    store.db.transaction(() => store.commitTransition(execution.executionId, 'consumed', {
      transitionId: 'consumed', processedEventIds: [events[0].eventId],
    }))();
    assert.equal(await core.recordEnvironmentPerception('robot-session', perception(9), enqueue, 'perception-owner'), true);
    assert.equal(wakes.length, 2, 'Consuming a wake must allow the next frame to wake the owner');
    store.deliverEvent(execution.executionId, { eventId: 'receipt', kind: 'physical_result', actionId: 'original-motion', payload: { type: 'cancelled' } });
    assert.equal(await core.recordEnvironmentPerception('robot-session', perception(10), enqueue, 'perception-owner'), true);
    assert.equal(store.events(execution.executionId).filter(event => event.kind === 'perception_received').length, 2);
    assert.ok(store.findEvent(execution.executionId, 'receipt'), 'Coalescing never removes a movement receipt');
  } finally { queue.cancel(owner.id, 'Fixture complete'); store.close(); }
});


test('a waiting perception execution wakes after all of its finite jobs have finished', async () => {
  const { openExecutionStore } = await import('../durable-execution/storage.js');
  const username = 'perception-no-work-owner';
  const store = openExecutionStore(username);
  const queue = getQueueManager();
  const definition = { graphId: 'perception-wait', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} };
  const execution = store.create(username, definition);
  const lease = store.claim(execution.executionId, definition);
  store.settle(lease, 'waiting', 'active_task:robot-session:perception'); store.release(lease);
  const wakes: any[] = [];
  try {
    assert.equal(queue.getAllTasks().filter(task => task.username === username).length, 0);
    core.recordEnvironmentObservation(observation());
    assert.equal(await core.recordEnvironmentPerception('robot-session', perception(1), async input => {
      wakes.push(input); return queue.enqueue(input);
    }, username), true);
    assert.equal(wakes.length, 1, 'The durable wait owns the subscription even when no finite work is active');
    assert.equal(wakes[0].username, username);
    assert.equal(store.events(execution.executionId).filter(event => event.kind === 'perception_received').length, 1);
  } finally {
    for (const task of queue.getAllTasks().filter(task => task.username === username)) queue.cancel(task.id, 'Fixture complete');
    store.close();
  }
});

test('locomotion telemetry shares the sensor wake and preserves loss evidence without admitting another task', async () => {
  const { openExecutionStore } = await import('../durable-execution/storage.js');
  const username = 'locomotion-sensor-owner';
  const store = openExecutionStore(username);
  const queue = getQueueManager();
  const definition = { graphId: 'locomotion-wait', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} };
  const waiting = store.create(username, definition);
  const unrelated = store.create(username, definition);
  for (const [execution, reason] of [[waiting, 'active_task:robot-session:perception:locomotion'], [unrelated, 'active_task:robot-session:perception']] as const) {
    const lease = store.claim(execution.executionId, definition);
    store.settle(lease, 'waiting', reason); store.release(lease);
  }
  const wakes: any[] = [];
  const enqueue = async (input: any) => { wakes.push(input); return queue.enqueue(input); };
  const yaw = { available: true, robotId: 'robot', sessionId: 'robot-session', referenceId: 'boot-1',
    observedAt: new Date().toISOString(), source: 'body-imu', degrees: 30, uncertaintyDegrees: null };
  try {
    core.recordEnvironmentObservation(observation());
    await core.recordEnvironmentPerception('robot-session', perception(1), enqueue, username);
    assert.equal(await core.recordEnvironmentLocomotionMeasurement('robot-session', { yaw }, enqueue, username), true);
    assert.equal(wakes.filter(wake => wake.input?.executionId === waiting.executionId).length, 1, 'Camera and orientation updates share one outstanding sensor wake');
    assert.deepEqual(core.getLatestEnvironmentObservation('robot-session')?.state?.locomotionMeasurement, { yaw });
    assert.equal(store.events(unrelated.executionId).length, 1, 'Orientation updates must not wake a non-locomotion camera subscription again');
    assert.equal(await core.recordEnvironmentLocomotionMeasurement('robot-session', { yaw: { ...yaw, robotId: 'other' } }, enqueue, username), false);
    assert.deepEqual(core.getLatestEnvironmentObservation('robot-session')?.state?.locomotionMeasurement, { yaw });
    const first = store.events(waiting.executionId)[0];
    store.db.transaction(() => store.commitTransition(waiting.executionId, 'consumed', {
      transitionId: 'consumed', processedEventIds: [first.eventId],
    }))();
    const lost = { ...yaw, available: false, reason: 'orientation_unavailable' };
    await assert.rejects(core.recordEnvironmentLocomotionMeasurement('robot-session', { yaw: lost }, async () => {
      throw new Error('Queue unavailable');
    }, username), /Queue unavailable/);
    await core.recordEnvironmentLocomotionMeasurement('robot-session', { yaw: lost }, enqueue, username);
    assert.equal(wakes.filter(wake => wake.input?.executionId === waiting.executionId).length, 2, 'A durable wake is relayed after a transient delivery failure');
    assert.deepEqual(core.getLatestEnvironmentObservation('robot-session')?.state?.locomotionMeasurement, { yaw: lost });
    assert.equal(store.events(waiting.executionId).length, 2);
    const last = store.events(waiting.executionId)[1];
    store.db.transaction(() => store.commitTransition(waiting.executionId, 'loss-consumed', {
      transitionId: 'loss-consumed', processedEventIds: [last.eventId],
    }))();
    const offline = { ...observation(), visual: undefined };
    offline.state = { ...offline.state, body: { authenticated: false, robotId: 'robot' },
      locomotionMeasurement: { yaw: { ...lost, reason: 'body_disconnected' } } };
    const token = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
    process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-token';
    const tokenPath = path.join(root, 'logs', 'run', 'queue', 'service-token');
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, 'fixture-coordinator-token');
    const submission = mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
      assert.equal(new URL(String(url)).pathname, '/api/internal/work-coordinator/enqueue');
      return Response.json({ task: queue.enqueue(JSON.parse(String(options?.body))) });
    });
    try {
      const response = await handleEnvironmentBridgeObservation({ path: '/api/environment-bridge/observation',
        method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body: offline,
        user: { userId: username, username, role: 'guest', isAuthenticated: false } }, () => username);
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.equal((response.data as any).graphQueued, false, 'Body loss resumes the goal without admitting another cognition');
      assert.equal(store.events(waiting.executionId).length, 3, 'State-only disconnect wakes the active goal');
      assert.equal((store.events(waiting.executionId)[2].payload as any).locomotionMeasurement.yaw.reason, 'body_disconnected');
    } finally {
      submission.mock.restore();
      if (token === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
      else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = token;
    }
  } finally {
    for (const task of queue.getAllTasks().filter(task => task.username === username)) queue.cancel(task.id, 'Fixture complete');
    store.close();
  }
});
