import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UnifiedRequest } from '../types.js';
import { randomUUID } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-bridge-cancellation-'));
assert.equal(fs.realpathSync(root), root);
process.env.METAHUMAN_ROOT = root;
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'isolated-cancellation-fixture';
globalThis.fetch = async () => { throw new Error('Network access is forbidden in this fixture'); };
const { ROOT } = await import('../../path-builder.js');
assert.equal(ROOT, root, 'No domain owner may load outside the isolated runtime');
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const { getQueueManager } = await import('../../queue/unified-queue-manager.js');
const { persistQueueState, loadQueueState } = await import('../../queue/queue-persister.js');
const bridge = await import('../../environment-interface/store.js');
const { handleEnvironmentBridgeStream } = await import('./environment-bridge.js');
const { beginAuthenticatedRuntime } = await import('../../sessions.js');
beginAuthenticatedRuntime();
const { getQueueSystem } = await import('../../queue/queue-system.js');
const { openExecutionStore } = await import('../../durable-execution/storage.js');
const { handleDeleteQueueTask, handleClearQueueTasks, handleCancelQueueExecution, handleQueueStream } = await import('./unified-queue.js');
const manager = getQueueManager();
manager.setOnQueueChange(() => persistQueueState(manager.exportState()));

test('queue Cancel and Cancel pending cancel the saved workflow, not only its wake job', async () => {
  const username = 'cancellation-owner';
  const system = getQueueSystem();
  const request = (id?: string): UnifiedRequest => ({ path: '/api/unified-queue/tasks/' + (id ?? ''),
    method: id ? 'DELETE' : 'POST', params: id ? { id } : {},
    user: { userId: username, username, role: 'owner', isAuthenticated: true } });
  for (const bulk of [false, true]) {
    const store = openExecutionStore(username);
    try {
      const definition = { graphId: 'saved-fixture', graphHash: 'old', runtimeVersion: 'old', checkpointSchemaVersion: 1, nodeVersions: {} };
      const record = store.enter(username, definition, randomUUID(), { graph: {}, context: { cognitiveMode: 'environment' } });
      const lease = store.claim(record.executionId, definition);
      store.settle(lease, 'waiting', 'user_or_autonomy'); store.release(lease);
      const work = manager.enqueue({ type: 'generic', handler: 'graph.signal', username,
        input: { executionId: record.executionId, eventId: 'wake' } });
      const response = bulk ? await handleClearQueueTasks(request()) : await handleDeleteQueueTask(request(work.id));
      assert.equal(response.status, 200);
      assert.equal(store.get(record.executionId).status, 'cancelled');
      assert.equal(manager.getTask(work.id)?.state, 'cancelled');
      store.deliverEvent(record.executionId, { eventId: 'late', kind: 'autonomy_trigger', payload: {} });
      assert.equal(store.pendingDispatches().length, 0);
      assert.ok(response.data.snapshot.executions.some((entry: any) => entry.executionId === record.executionId
        && entry.status === 'cancelled'));
    } finally { store.close(); }
  }
  await system.dispose();
});

test('a saved workflow with no queued job remains cancellable and profile scoped', async () => {
  const { handleHttpRequest } = await import('../adapters/http.js');
  const username = 'saved-owner';
  const store = openExecutionStore(username);
  try {
    const definition = { graphId: 'saved-fixture', graphHash: 'old', runtimeVersion: 'old', checkpointSchemaVersion: 1, nodeVersions: {} };
    const execution = store.create(username, definition);
    const lease = store.claim(execution.executionId, definition);
    store.settle(lease, 'waiting', 'user_or_autonomy'); store.release(lease);
    const request: UnifiedRequest = { path: '/api/unified-queue/executions/' + execution.executionId,
      method: 'DELETE', params: { id: execution.executionId },
      user: { userId: username, username, role: 'owner', isAuthenticated: true } };
    assert.equal((await handleCancelQueueExecution({ ...request, user: { ...request.user, isAuthenticated: false } })).status, 401);
    assert.equal((await handleCancelQueueExecution({ ...request, user: { ...request.user, username: 'different-owner' } })).status, 404);
    const response = await handleHttpRequest({ path: request.path, method: 'DELETE', headers: { host: '127.0.0.1:4321' },
      resolvedUser: request.user, userContextEstablished: true });
    assert.equal(response.status, 200, 'The installed HTTP router extracts the execution ID from the URL');
    assert.equal(JSON.parse(String(response.body)).success, true);
    assert.equal(store.get(execution.executionId).status, 'cancelled');
    const once = store.events(execution.executionId);
    assert.equal((await handleCancelQueueExecution(request)).status, 200);
    assert.deepEqual(store.events(execution.executionId), once);
  } finally { store.close(); }
});

test('saved-only cancellation wakes the activity observer and updates viewers without depending on them', async (t) => {
  const { ACTIVITY_STATE_FILE } = await import('../../system-activity.js');
  const system = getQueueSystem();
  const readExecutions = system.getExecutions.bind(system);
  for (const brokenViewer of [false, true]) {
    const username = 'cancel-wake-owner';
    const store = openExecutionStore(username);
    const controller = new AbortController();
    let watcher: fs.FSWatcher | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: AsyncIterator<string> | undefined;
    try {
      const definition = { graphId: 'wake-fixture', graphHash: 'current', runtimeVersion: 'current', checkpointSchemaVersion: 1, nodeVersions: {} };
      const execution = store.create(username, definition);
      const lease = store.claim(execution.executionId, definition);
      store.settle(lease, 'waiting', 'user_or_autonomy'); store.release(lease);
      const request: UnifiedRequest = { path: '/api/unified-queue/executions/' + execution.executionId,
        method: 'DELETE', params: { id: execution.executionId },
        user: { userId: username, username, role: 'owner', isAuthenticated: true } };
      const response = await handleQueueStream({ ...request, signal: controller.signal,
        user: { ...request.user, username: brokenViewer ? 'unreadable-viewer' : username } });
      stream = response.stream![Symbol.asyncIterator]();
      await stream.next();
      const update = stream.next();
      const mock = t.mock.method(system, 'getExecutions', (profile: string) => {
        if (profile === 'unreadable-viewer') throw new Error('Viewer storage unavailable');
        return readExecutions(profile);
      });
      fs.mkdirSync(path.dirname(ACTIVITY_STATE_FILE), { recursive: true });
      const changed = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Cancellation did not wake activity observers')); }, 1500);
        watcher = fs.watch(path.dirname(ACTIVITY_STATE_FILE), (_, filename) => {
          if (filename?.toString() === path.basename(ACTIVITY_STATE_FILE)) resolve();
        });
      });
      assert.equal((await handleCancelQueueExecution(request)).status, 200);
      await changed;
      const packet = JSON.parse((await update).value!.match(/^data: (.+)$/m)![1]);
      assert.equal(packet.type, brokenViewer ? 'error' : 'execution_cancelled');
      if (brokenViewer) assert.equal(packet.error, 'Viewer storage unavailable');
      else assert.ok(packet.snapshot.executions.some((entry: any) => entry.executionId === execution.executionId && entry.status === 'cancelled'));
      assert.equal(JSON.parse(fs.readFileSync(ACTIVITY_STATE_FILE, 'utf8')).username, username);
      assert.equal(store.get(execution.executionId).status, 'cancelled');
      assert.ok(!manager.getAllTasks().some(task => task.graphExecutions?.includes(execution.executionId)), 'No synthetic work item is required to wake Full Auto');
      mock.mock.restore();
    } finally {
      clearTimeout(timer); watcher?.close(); controller.abort(); await stream?.return?.(); store.close();
    }
  }
});

test('unreachable physical work keeps its uncertainty until explicit owner confirmation', async () => {
  const task = manager.enqueue({ type: 'environment_command', handler: 'environment.command', username: 'physical-owner',
    input: { id: randomUUID(), sessionId: 'absent-body', type: 'robotCommand', command: 'walk' } });
  assert.ok(manager.claim(task.id));
  manager.wait(task.id, 'outcome_unknown: Acknowledgement lost');
  const request: UnifiedRequest = { path: '/api/unified-queue/tasks/' + task.id, method: 'DELETE', params: { id: task.id },
    user: { userId: 'physical-owner', username: 'physical-owner', role: 'owner', isAuthenticated: true } };
  const cancel = await handleDeleteQueueTask(request);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.task.state, 'waiting');
  assert.ok(cancel.data.task.cancellationRequestedAt);
  assert.equal(cancel.data.task.robotSessionId, 'absent-body');
  assert.equal((await handleDeleteQueueTask({ ...request, body: { confirmStopped: true },
    user: { ...request.user, role: 'standard' } })).status, 403);
  const confirmation = await handleDeleteQueueTask({ ...request, body: { confirmStopped: true } });
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.data.task.state, 'cancelled');
  assert.equal(manager.getTask(task.id)?.result?.feedback?.data?.producer, 'owner_confirmation');
  const persisted = loadQueueState()!;
  manager.importState(persisted);
  assert.equal(manager.getTask(task.id)?.state, 'cancelled');
  assert.equal(manager.getTask(task.id)?.result?.feedback?.data?.confirmedBy, 'physical-owner');
});

test('Cancel pending includes global system jobs but leaves actively executing workflows alone', async () => {
  const username = 'bulk-owner';
  const store = openExecutionStore(username);
  const definition = { graphId: 'bulk-fixture', graphHash: 'current', runtimeVersion: 'current', checkpointSchemaVersion: 1, nodeVersions: {} };
  const record = store.create(username, definition);
  const lease = store.claim(record.executionId, definition);
  const running = manager.enqueue({ type: 'generic', handler: 'fixture.active', username, input: {} });
  assert.ok(manager.claim(running.id));
  manager.attachExecution(running.id, record.executionId);
  const waiting = manager.enqueue({ type: 'generic', handler: 'graph.signal', username, input: { executionId: record.executionId } });
  const systemWork = manager.enqueue({ type: 'generic', handler: 'fixture.system', username: 'system', input: {} });
  const request: UnifiedRequest = { path: '/api/unified-queue/clear', method: 'POST',
    user: { userId: username, username, role: 'owner', isAuthenticated: true } };
  try {
    assert.equal((await handleClearQueueTasks({ ...request, user: { ...request.user, role: 'standard' } })).status, 403);
    const result = await handleClearQueueTasks(request);
    assert.equal(result.status, 200);
    assert.equal(manager.getTask(systemWork.id)?.state, 'cancelled');
    assert.equal(manager.getTask(running.id)?.state, 'leased');
    assert.equal(manager.getTask(waiting.id)?.state, 'queued');
    assert.equal(store.get(record.executionId).status, 'running');
  } finally {
    store.release(lease); store.close();
    manager.complete(running.id, true, {}); manager.cancel(waiting.id);
  }
});

test('owner stop confirmation and delayed adapter evidence remain distinct and idempotent', async () => {
  const { ExecutionCheckpointer } = await import('../../durable-execution/checkpointer.js');
  const { executionWorkInput } = await import('../../durable-execution/coordinator-outbox.js');
  for (const adapterFirst of [false, true]) {
    const username = 'durable-stop-owner';
    const store = openExecutionStore(username);
    try {
      const definition = { graphId: 'stop-fixture', graphHash: 'current', runtimeVersion: 'current', checkpointSchemaVersion: 1, nodeVersions: {} };
      const execution = store.create(username, definition);
      const lease = store.claim(execution.executionId, definition);
      const effectId = randomUUID();
      const input = { id: randomUUID(), sessionId: randomUUID(), type: 'robotCommand', command: 'walk' };
      await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: execution.executionId } }, {
        v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
        channel_values: { executionTransition: { transitionId: randomUUID(), dispatches: [{ effectId,
          actionId: input.id, kind: 'coordinator_work', payload: { type: 'environment_command', handler: 'environment.command', username, input },
        }] } },
      }, { source: 'loop', step: 0, parents: {} });
      store.settle(lease, 'waiting', 'robot_result'); store.release(lease);
      const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)));
      store.acknowledgeAdmission(effectId, task.id);
      assert.ok(manager.claim(task.id));
      store.recordActionAcceptance(effectId, task);
      manager.wait(task.id, 'outcome_unknown: Acknowledgement lost');
      const request: UnifiedRequest = { path: '/api/unified-queue/tasks/' + task.id, method: 'DELETE', params: { id: task.id },
        user: { userId: username, username, role: 'owner', isAuthenticated: true } };
      assert.equal((await handleDeleteQueueTask(request)).status, 200);
      const feedback = { id: randomUUID(), actionId: input.id, timestamp: new Date().toISOString(),
        type: 'completed' as const, message: 'Adapter result', data: { producer: 'robot-adapter' } };
      if (adapterFirst) bridge.recordEnvironmentActionResult(feedback);
      const confirmation = await handleDeleteQueueTask({ ...request, body: { confirmStopped: true } });
      assert.equal(confirmation.status, 200);
      assert.equal(confirmation.data.task.state, adapterFirst ? 'completed' : 'cancelled');
      if (!adapterFirst) {
        const ownerEvent = store.events(execution.executionId).find(event => event.eventId === `owner-stopped:${task.id}`)!;
        assert.equal((ownerEvent.payload as any).feedback.data.producer, 'owner_confirmation');
        assert.ok(bridge.recordEnvironmentActionResult(feedback));
        assert.equal(store.event(execution.executionId, feedback.id).parentEventId, ownerEvent.eventId);
      }
      const events = store.events(execution.executionId);
      assert.ok(bridge.recordEnvironmentActionResult(feedback));
      assert.equal((await handleDeleteQueueTask({ ...request, body: { confirmStopped: true } })).status, 200);
      assert.deepEqual(store.events(execution.executionId), events);
      assert.equal(store.get(execution.executionId).status, 'cancelled');
      assert.deepEqual(store.pendingDispatches(), [], 'Late evidence never revives the cancelled objective');
    } finally { store.close(); }
  }
});

function decode(chunk: string) {
  const event = chunk.match(/^event: (.+)$/m)?.[1];
  const data = JSON.parse(chunk.match(/^data: (.+)$/m)![1]);
  return { event, data };
}

async function openStream(sessionId: string) {
  const controller = new AbortController();
  const request: UnifiedRequest = {
    path: '/api/environment-bridge/stream', method: 'GET',
    query: { sessionId }, signal: controller.signal,
    headers: { authorization: `Bearer ${process.env.MH_ENVIRONMENT_BRIDGE_TOKEN}` },
    user: { userId: 'fixture', username: 'fixture', role: 'guest', isAuthenticated: false },
  };
  const response = await handleEnvironmentBridgeStream(request);
  assert.equal(response.status, 200);
  const stream = response.stream![Symbol.asyncIterator]();
  assert.equal(decode((await stream.next()).value).event, 'connected');
  return {
    async next() {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          stream.next().then(chunk => {
            assert.equal(chunk.done, false);
            return decode(chunk.value);
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error('Persisted cancellation did not reach the Bridge stream'));
            }, 500);
          }),
        ]);
      } finally { clearTimeout(timeout); }
    },
    async close() { controller.abort(); await stream.return?.(); },
  };
}

test('persisted physical cancellation reaches the Bridge stream and replays until terminal feedback', async () => {
  const timestamp = new Date().toISOString();
  bridge.writeEnvironmentBridgeState({
    enabled: true, updatedAt: timestamp, feedback: [],
    sessions: Object.fromEntries(['body-a', 'body-b'].map(sessionId => [sessionId, {
      sessionId, environmentId: 'fixture', adapter: 'fake', status: 'connected',
      firstSeenAt: timestamp, lastSeenAt: timestamp,
    }])),
  });
  const action = bridge.enqueueEnvironmentAction({ sessionId: 'body-a', type: 'robotCommand', command: 'walk' });
  const claimed = bridge.dispatchEnvironmentActions('body-a')[0];
  assert.equal(claimed.id, action.id);
  bridge.recordEnvironmentActionResult({ id: 'accepted-a', actionId: action.id,
    timestamp, type: 'accepted', message: 'Fake adapter accepted' });

  const other = bridge.enqueueEnvironmentAction({ sessionId: 'body-b', type: 'robotCommand', command: 'walk' });
  bridge.dispatchEnvironmentActions('body-b');
  manager.cancel(other.workItemId!, 'Cancel the other body');

  const stream = await openStream('body-a');
  let cancellation: Record<string, any>;
  try {
    manager.cancel(action.workItemId!, 'Objective cancelled');
    const event = await stream.next();
    assert.equal(event.event, 'cancellations');
    assert.equal(event.data.cancellations.length, 1, 'Another body cannot receive this cancellation');
    cancellation = event.data.cancellations[0];
    assert.deepEqual(cancellation, {
      cancellationId: `${action.workItemId}:cancel:${manager.getTask(action.workItemId!)!.cancellationRequestedAt}`,
      actionId: action.id, bodyLease: claimed.bodyLease,
      reason: 'Objective cancelled',
    });
    assert.equal(manager.getTask(action.workItemId!)!.state, 'leased', 'Sending cancellation is not terminal proof');
    assert.deepEqual(bridge.dispatchEnvironmentActions('body-a'), []);
    const persisted = loadQueueState()!;
    assert.equal(persisted.items!.find(item => item.id === action.workItemId)?.cancellationReason, 'Objective cancelled');
    manager.cancel(action.workItemId!, 'A later maintenance retry');
    assert.equal(manager.getTask(action.workItemId!)!.cancellationReason, 'Objective cancelled');
  } finally { await stream.close(); }

  manager.importState(loadQueueState()!);
  assert.equal(manager.getTask(action.workItemId!)!.state, 'waiting');
  bridge.setEnvironmentBridgeEnabled(false);
  const reconnected = await openStream('body-a');
  try {
    const replay = await reconnected.next();
    assert.equal(replay.event, 'cancellations', 'Disabling new actions does not discard a pending cancellation');
    assert.deepEqual(replay.data.cancellations, [cancellation!]);
  } finally { await reconnected.close(); }
  assert.equal(manager.getTask(action.workItemId!)!.state, 'waiting');
  bridge.recordEnvironmentActionResult({ id: 'cancelled-a', actionId: action.id,
    timestamp: new Date().toISOString(), type: 'cancelled', message: 'Fake adapter stopped this action' });
  assert.equal(manager.getTask(action.workItemId!)!.state, 'cancelled');

  bridge.setEnvironmentBridgeEnabled(true);
  const nextAction = bridge.enqueueEnvironmentAction({ sessionId: 'body-a', type: 'robotCommand', command: 'walk' });
  const resumed = await openStream('body-a');
  try {
    const event = await resumed.next();
    assert.equal(event.event, 'actions', 'A terminal cancellation must not be replayed');
    assert.equal(event.data.actions[0].id, nextAction.id);
    assert.ok(event.data.actions[0].bodyLease.generation > claimed.bodyLease!.generation);
  } finally { await resumed.close(); }
  manager.cancel(nextAction.workItemId!, 'Cancellation raced with natural completion');
  bridge.recordEnvironmentActionResult({ id: 'completed-next', actionId: nextAction.id,
    timestamp: new Date().toISOString(), type: 'completed', message: 'Fake adapter completed before cancellation' });
  assert.equal(manager.getTask(nextAction.workItemId!)!.state, 'completed', 'The actual terminal result remains authoritative');
});
