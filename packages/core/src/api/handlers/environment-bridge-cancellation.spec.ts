import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { UnifiedRequest } from '../types.js';

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
const manager = getQueueManager();
manager.setOnQueueChange(() => persistQueueState(manager.exportState()));

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
