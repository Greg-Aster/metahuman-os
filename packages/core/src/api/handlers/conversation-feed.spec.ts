import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, mock, test } from 'node:test';
import type { MetaHumanEvent } from '../../infrastructure/event-bus/schema.js';
import type { DispatchIntent, ExecutionDefinition } from '../../durable-execution/types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-conversation-feed-'));
process.env.METAHUMAN_ROOT = root;
globalThis.fetch = async () => { throw new Error('No network in conversation feed tests'); };
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const listeners = new Set<(event: MetaHumanEvent) => void>();
const published: MetaHumanEvent[] = [];
mock.method(eventBus, 'subscribe', (listener: (event: MetaHumanEvent) => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
});
mock.method(eventBus, 'emit', (...[source, event, data, options]: Parameters<typeof eventBus.emit>) => {
  const item = { timestamp: new Date().toISOString(), source, event, data, ...options };
  published.push(item);
  for (const listener of listeners) listener(item);
});
const { handleBufferStream } = await import('./buffer-stream.js');
const { StreamWriterNode } = await import('../../nodes/output/stream-writer.node.js');
const { ExecutionStore } = await import('../../durable-execution/store.js');
const { ExecutionCheckpointer } = await import('../../durable-execution/checkpointer.js');
const { relayExecutionOutbox } = await import('../../durable-execution/coordinator-outbox.js');
const { loadBufferForUser, getBufferPathForUser } = await import('../../conversation-buffer.js');
const { getProfilePaths } = await import('../../path-builder.js');
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); });

const definition: ExecutionDefinition = {
  graphId: 'feed-fixture', graphHash: 'feed-v1', runtimeVersion: 'test',
  checkpointSchemaVersion: 1, nodeVersions: { output: 'test' },
};
const user = { username: 'feed-fixture', userId: 'fixture-user', role: 'owner', isAuthenticated: true };
const packet = (value: string) => JSON.parse(value.slice(6).trim());
async function stream(username = user.username, mode = 'conversation', authenticated = true) {
  const abort = new AbortController();
  const response = await handleBufferStream({ query: { mode },
    user: { ...user, username, isAuthenticated: authenticated }, signal: abort.signal } as any);
  const iterator = response.stream![Symbol.asyncIterator]();
  return { abort, iterator };
}
async function commit(store: InstanceType<typeof ExecutionStore>, lease: any, dispatches: DispatchIntent[]) {
  const saver = new ExecutionCheckpointer(store, lease);
  await saver.put({ configurable: { thread_id: lease.executionId } }, {
    v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
    channel_values: { executionTransition: { transitionId: randomUUID(), dispatches } },
  }, { source: 'loop', step: 0, parents: {} });
}

test('Stream Writer commits one live reply, relays through the existing feed and never saves conversation or memory', async () => {
  const store = new ExecutionStore(':memory:');
  const execution = store.create(user.username, definition);
  const lease = store.claim(execution.executionId, definition);
  const staged: DispatchIntent[] = [];
  const feed = await stream();
  try {
    assert.equal(packet((await feed.iterator.next()).value!).type, 'connected');
    assert.equal(packet((await feed.iterator.next()).value!).type, 'update');
    const start = published.filter(event => event.event === 'conversation.feed').length;
    const context = { username: user.username, cognitiveMode: 'environment' as const, graphExecution: {
      executionId: execution.executionId, occurrenceId: 'output-occurrence',
      dispatch: (intent: Omit<DispatchIntent, 'effectId'>) => {
        const effect = { ...intent, effectId: `${execution.executionId}:output:${staged.length}` };
        staged.push(effect);
        return effect;
      },
    } };
    const unchanged = await StreamWriterNode.execute!({ response: 'normal graph output' }, context, {});
    assert.equal(unchanged.output, 'normal graph output');
    assert.equal(staged.length, 0, 'Existing graph outputs remain opt-in');
    const output = await StreamWriterNode.execute!({ response: 'Gravity has submitted a complaint.' }, context,
      { publishToConversation: true });
    assert.equal(output.completed, true);
    assert.equal(staged.length, 1);
    assert.equal(published.filter(event => event.event === 'conversation.feed').length, start,
      'Node execution stages output; it cannot publish before its checkpoint');
    await commit(store, lease, staged);
    const delivery = feed.iterator.next();
    await relayExecutionOutbox(store, execution.executionId);
    const received = packet((await delivery).value!);
    assert.equal(received.type, 'conversation');
    assert.equal(received.message.content, output.output);
    assert.equal(received.message.role, 'assistant');
    assert.equal(received.message.meta.executionId, execution.executionId);
    assert.equal(received.message.meta.idempotencyKey, staged[0].effectId);
    assert.equal(received.message.meta.cognitiveMode, 'environment');
    assert.equal(received.message.meta.liveConversation, true);
    assert.equal(received.message.meta.source, 'stream_writer');
    assert.equal(store.dispatch(staged[0].effectId).status, 'completed');
    await relayExecutionOutbox(store, execution.executionId);
    assert.equal(published.filter(event => event.event === 'conversation.feed').length, start + 1,
      'Outbox replay does not republish completed delivery');
    assert.deepEqual(loadBufferForUser(user.username, 'conversation').messages, []);
    assert.equal(fs.existsSync(getBufferPathForUser(user.username, 'conversation')), false);
    const memory = getProfilePaths(user.username).episodic;
    assert.equal(fs.existsSync(memory), false, 'No episodic directory or memory record was created');
  } finally {
    feed.abort.abort();
    await feed.iterator.return?.();
    store.release(lease);
    store.close();
  }
  assert.equal(listeners.size, 0);
});

test('live feed preserves authenticated profile isolation, selected view and listener lifecycle across reconnect', async () => {
  const unauthenticated = await stream(user.username, 'conversation', false);
  assert.equal(packet((await unauthenticated.iterator.next()).value!).type, 'error');
  assert.equal((await unauthenticated.iterator.next()).done, true);
  assert.equal(listeners.size, 0);
  for (let reconnect = 0; reconnect < 2; reconnect++) {
    const feed = await stream();
    await feed.iterator.next();
    await feed.iterator.next();
    assert.equal(listeners.size, 1);
    const waiting = feed.iterator.next();
    eventBus.emit('graph', 'conversation.feed', { username: 'another-profile', message: { content: 'private' } });
    eventBus.emit('graph', 'unrelated.event', { username: user.username, message: { content: 'unrelated' } });
    eventBus.emit('graph', 'conversation.feed', { username: user.username,
      message: { role: 'assistant', content: `reaction-${reconnect}`, timestamp: 123,
        meta: { liveConversation: true, idempotencyKey: `effect-${reconnect}` } } });
    assert.equal(packet((await waiting).value!).message.content, `reaction-${reconnect}`);
    const pending = feed.iterator.next();
    feed.abort.abort();
    assert.equal((await pending).done, true);
    assert.equal(listeners.size, 0);
  }
  const inner = await stream(user.username, 'inner');
  await inner.iterator.next();
  await inner.iterator.next();
  assert.equal(listeners.size, 0, 'A stream without Conversation selected does not subscribe to live replies');
  inner.abort.abort();
  await inner.iterator.return?.();
});

test('failed and cancelled executions retire undelivered live replies through the existing outbox owner', async () => {
  for (const status of ['failed', 'cancelled'] as const) {
    const store = new ExecutionStore(':memory:');
    const execution = store.create(user.username, definition);
    const lease = store.claim(execution.executionId, definition);
    try {
      await commit(store, lease, [{ effectId: `feed-${status}`, kind: 'conversation_feed',
        payload: { content: 'undelivered', timestamp: 123 } }]);
      if (status === 'failed') store.settle(lease, 'failed');
      else store.cancel(execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} });
      assert.equal(store.dispatch(`feed-${status}`).status, 'cancelled');
    } finally { store.release(lease); store.close(); }
  }
});

test('a worker-side publisher reaches Buffer SSE over the existing event bus socket transport', async t => {
  const { EventBusServer } = await import('../../infrastructure/event-bus/server.js');
  const { EventBusClient } = await import('../../infrastructure/event-bus/client.js');
  const server = new EventBusServer({ port: 0, logsDir: path.join(root, 'transport-events') });
  await server.start();
  const address = (server as any).httpServer.address();
  const url = `ws://127.0.0.1:${address.port}`;
  const worker = new EventBusClient({ url });
  const application = new EventBusClient({ url });
  const subscription = mock.method(eventBus, 'subscribe', (listener: (event: MetaHumanEvent) => void) => application.subscribe(listener));
  const emission = mock.method(eventBus, 'emit', (...args: Parameters<typeof eventBus.emit>) => worker.emit(...args));
  const store = new ExecutionStore(':memory:');
  const execution = store.create(user.username, definition);
  const lease = store.claim(execution.executionId, definition);
  const feed = await stream();
  t.after(async () => {
    feed.abort.abort();
    await feed.iterator.return?.();
    worker.disconnect(); application.disconnect();
    subscription.mock.restore(); emission.mock.restore();
    store.release(lease); store.close();
    await server.stop();
  });
  await feed.iterator.next();
  await feed.iterator.next();
  if (!application.isConnected()) await once((application as any).ws, 'open');
  worker.connect();
  if (!worker.isConnected()) await once((worker as any).ws, 'open');
  await commit(store, lease, [{ effectId: 'socket-reply', kind: 'conversation_feed',
    payload: { content: 'Socket-delivered reaction', timestamp: 456 } }]);
  const waiting = feed.iterator.next();
  await relayExecutionOutbox(store, execution.executionId);
  const received = packet((await waiting).value!);
  assert.equal(received.message.content, 'Socket-delivered reaction');
  assert.equal(received.message.meta.idempotencyKey, 'socket-reply');
  assert.equal(received.message.timestamp, 456);
  assert.equal(store.dispatch('socket-reply').status, 'completed');
});
