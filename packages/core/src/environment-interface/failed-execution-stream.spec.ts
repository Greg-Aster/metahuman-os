import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToIO } from 'node:timers/promises';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-failed-stream-'));
process.env.METAHUMAN_ROOT = root;
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-token';
globalThis.fetch = async () => { throw new Error('Network is forbidden in this fixture'); };
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../audit.js');
setAuditEnabled(false);
const bridge = await import('./index.js');
const { getQueueManager } = await import('../queue/unified-queue-manager.js');
const { openExecutionStore } = await import('../durable-execution/storage.js');
const { ExecutionStore } = await import('../durable-execution/store.js');
const { executionWorkInput } = await import('../durable-execution/coordinator-outbox.js');
const { handleEnvironmentBridgeStream } = await import('../api/handlers/environment-bridge.js');
const manager = getQueueManager();

// Catch only in the fixture so the real queued notification can be asserted,
// instead of terminating the test worker before its receipt evidence is checked.
for (const settlement of ['before-notification', 'during-acceptance'] as const) test(`failed execution ${settlement} reconciles stream notifications and reconnect without altering claimed outcomes`, async () => {
  manager.clear();
  const errors: unknown[] = [];
  const queue = globalThis.queueMicrotask;
  mock.method(globalThis, 'queueMicrotask', (callback: () => void) => queue(() => {
    try { callback(); } catch (error) { errors.push(error); }
  }));
  const timestamp = new Date().toISOString();
  const sessions = Object.fromEntries(['pending', 'started', 'accepted', 'unknown'].map(sessionId => [sessionId, {
    sessionId, environmentId: 'fixture', adapter: 'fixture', status: 'connected', firstSeenAt: timestamp, lastSeenAt: timestamp,
  }]));
  bridge.writeEnvironmentBridgeState({ enabled: true, updatedAt: timestamp, sessions, feedback: [] } as never);
  const store = openExecutionStore('stream-fixture');
  const definition = { graphId: 'fixture', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} };
  const execution = store.create('stream-fixture', definition);
  const lease = store.claim(execution.executionId, definition);
  const held: Array<{ task: any; effect: any }> = [];
  const controllers: AbortController[] = [];
  const streams: AsyncIterator<any>[] = [];
  const connect = async () => {
    const abort = new AbortController(); controllers.push(abort);
    const response = await handleEnvironmentBridgeStream({ method: 'GET', path: '/api/environment-bridge/stream',
      headers: { Authorization: 'Bearer fixture-token' }, query: { sessionId: 'pending' }, signal: abort.signal,
      user: { isAuthenticated: false } } as never);
    const stream = response.stream![Symbol.asyncIterator](); streams.push(stream);
    assert.match((await stream.next()).value, /event: connected/);
    return stream;
  };
  try {
    await connect();
    const admit = (sessionId: string, type: 'faceExpression' | 'robotCommand') => {
      const actionId = randomUUID();
      const effectId = `${execution.executionId}:${sessionId}`;
      store.db.transaction(() => store.commitTransition(execution.executionId, effectId, {
        transitionId: effectId, dispatches: [{ effectId, kind: 'coordinator_work', actionId,
          payload: { type: 'environment_command', handler: 'environment.command', source: 'autonomy',
            resource: `${type === 'faceExpression' ? 'environment-display' : 'environment'}:${sessionId}`,
            input: { id: actionId, type, sessionId, ...(type === 'faceExpression' ? { expression: 'thinking' } : { command: 'walk' }) } } }],
      }))();
      const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)));
      store.acknowledgeAdmission(effectId, task.id);
      return { task, effectId, actionId };
    };
    for (const state of ['started', 'accepted', 'unknown']) {
      const admitted = admit(state, 'robotCommand');
      const claimed = manager.claim(admitted.task.id, `fixture:${state}`)!;
      assert.ok(claimed.startedAt && claimed.bodyLease);
      if (state !== 'started') store.recordActionAcceptance(admitted.effectId, claimed);
      if (state === 'unknown') {
        store.deliverActionResult(execution.executionId, admitted.actionId, {
          eventId: 'uncertain', kind: 'physical_result', actionId: admitted.actionId, payload: { status: 'outcome_unknown' },
        }, true);
        manager.wait(claimed.id, 'outcome_unknown');
      }
      held.push({ task: structuredClone(manager.getTask(claimed.id)), effect: store.dispatch(admitted.effectId) });
    }
    const pending = admit('pending', 'faceExpression');
    if (settlement === 'before-notification') {
      store.settle(lease, 'failed');
      store.release(lease);
    } else {
      const assertDispatchable = ExecutionStore.prototype.assertDispatchable;
      let settled = false;
      mock.method(ExecutionStore.prototype, 'assertDispatchable', function (this: InstanceType<typeof ExecutionStore>, effectId: string) {
        if (effectId === pending.effectId && !settled) {
          // The stream already read running state. A distinct SQLite handle
          // commits the worker's terminal transition before acceptance reads it.
          settled = true;
          store.settle(lease, 'failed');
          store.release(lease);
        }
        return assertDispatchable.call(this, effectId);
      });
    }
    await yieldToIO();
    assert.deepEqual(errors, [], 'A queued stream notification must not throw after its parent fails');
    assert.equal(manager.getTask(pending.task.id)?.state, 'cancelled');
    assert.equal(store.dispatch(pending.effectId).status, 'cancelled');
    const evidence = store.events(execution.executionId).filter(event => event.kind === 'dispatch_cancelled');
    assert.equal(evidence.length, 1);
    for (let attempt = 0; attempt < 2; attempt++) {
      manager.enqueue(executionWorkInput(store, store.dispatch(pending.effectId)));
      await yieldToIO();
      await connect();
      assert.deepEqual(errors, []);
      assert.equal(store.events(execution.executionId).filter(event => event.kind === 'dispatch_cancelled').length, 1);
    }
    for (const previous of held) {
      assert.deepEqual(manager.getTask(previous.task.id), previous.task);
      assert.deepEqual(store.dispatch(previous.effect.effectId), previous.effect);
    }
  } finally {
    for (const controller of controllers) controller.abort();
    for (const stream of streams) await stream.return?.();
    store.close();
    mock.restoreAll();
  }
});

test.after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });

test('Coordinator graph release reconciles failed work immediately including enqueue-before-ack and repeated release', async () => {
  const { ExecutionEngine } = await import('../queue/execution-engine.js');
  const engine = new ExecutionEngine({}, manager);
  const store = openExecutionStore('stream-fixture');
  const definition = { graphId: 'release-fixture', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} };
  const execution = store.create('stream-fixture', definition);
  const lease = store.claim(execution.executionId, definition);
  const work = manager.enqueue({ type: 'generic', handler: 'fixture.graph', username: 'stream-fixture', source: 'user', input: {} });
  assert.ok(manager.claim(work.id));
  const release = (engine as any).attachGraphExecution(work, execution.executionId) as () => void;
  try {
    const effects = ['enqueue-before-ack', 'before-enqueue'].map(label => ({
      effectId: `${execution.executionId}:${label}`, kind: 'coordinator_work',
      payload: { type: 'generic', handler: 'fixture.pending', username: 'stream-fixture', source: 'system', input: {} },
    }));
    store.db.transaction(() => store.commitTransition(execution.executionId, 'release-effects', {
      transitionId: 'release-effects', dispatches: effects,
    }))();
    const admitted = manager.enqueue(executionWorkInput(store, store.dispatch(effects[0].effectId)));
    assert.equal(store.dispatch(effects[0].effectId).workItemId, null);
    store.settle(lease, 'failed');
    store.release(lease);
    release();
    assert.equal(manager.getTask(admitted.id)?.state, 'cancelled', 'Release reconciles before the next event-loop turn');
    for (const effect of effects) {
      const receipt = store.dispatch(effect.effectId);
      assert.equal(receipt.status, 'cancelled');
      assert.equal(manager.getTask(receipt.workItemId!)?.state, 'cancelled');
    }
    assert.equal(work.activeGraphExecutionId, undefined);
    assert.equal(store.events(execution.executionId).filter(event => event.kind === 'dispatch_cancelled').length, 2);
    release();
    assert.equal(store.events(execution.executionId).filter(event => event.kind === 'dispatch_cancelled').length, 2);
  } finally { store.close(); }
});
