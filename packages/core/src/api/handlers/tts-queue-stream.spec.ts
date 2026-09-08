import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { SvelteFlowGraph } from '../../cognitive-graph-schema.js';
import type { UnifiedRequest } from '../types.js';

// The real graph/outbox, profile queue and acknowledgement handler run together.
// Only the clock and the audible playback effect are controlled by this test.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-tts-api-'));
process.env.METAHUMAN_ROOT = root;
globalThis.fetch = async () => { throw new Error('TTS delivery tests prohibit external transport'); };
const { ROOT, getProfilePaths } = await import('../../path-builder.js');
assert.equal(ROOT, root);
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const { runGraph } = await import('../../graph-runtime.js');
const { handleTtsQueueDelivery } = await import('./tts-queue-stream.js');
const { claimNextTTS, createTTSDeliveryQueueStore, queueTTS, TTS_DELIVERY_LEASE_MS } =
  await import('../../tts/delivery-queue.js');
const username = 'tts-api-fixture';
assert.ok(getProfilePaths(username).state.startsWith(root + path.sep));
after(() => {
  eventBus.disconnect();
  fs.rmSync(root, { recursive: true, force: true });
});

test('graph speech IDs renew and complete through the API without replaying playback', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const graph: SvelteFlowGraph = {
    name: 'TTS delivery contract', version: '1.0', format: 'svelte-flow',
    scheduler: { version: 1, activation: 'demand', skippedState: 'explicit',
      sideEffectOrder: 'serial-topological', maxLoopIterations: 5 },
    nodes: [
      { id: 'input', type: 'inputNode', position: { x: 0, y: 0 },
        data: { nodeType: 'user_input', label: 'Input', properties: {} } },
      { id: 'speech', type: 'outputNode', position: { x: 1, y: 0 },
        data: { nodeType: 'tts', label: 'Speech', properties: { source: 'delivery-test' } } },
    ],
    edges: [{ id: 'text', source: 'input', target: 'speech', sourceHandle: 'message', targetHandle: 'conversation' }],
  };
  const context = { username, userId: username, userMessage: 'One utterance.', requestId: 'tts-api-request' };
  const started = await runGraph({ graph, context });
  assert.equal(started.status, 'completed', started.error?.stack);
  const itemId = started.nodes.get('speech')?.outputs?.itemId;
  assert.equal(typeof itemId, 'string');
  assert.ok(itemId.startsWith(started.executionId!), 'Use the actual durable effect ID, not a hand-written substitute');
  const claim = claimNextTTS(username, 'browser-fixture').item;
  assert.ok(claim);
  assert.equal(claim.id, itemId);
  let playbackCount = 0;
  const play = () => { playbackCount++; };
  play();

  const request: UnifiedRequest = {
    method: 'POST', path: '/api/tts-queue-delivery',
    user: { isAuthenticated: true, username, userId: username, role: 'owner' },
    body: { itemId, leaseToken: claim.leaseToken, action: 'renew' },
  };
  now += TTS_DELIVERY_LEASE_MS / 2;
  const renewed = await handleTtsQueueDelivery(request);
  const renewedExpiry = now + TTS_DELIVERY_LEASE_MS;
  now = claim.leaseExpiresAt + 1;
  if (claimNextTTS(username, 'competing-browser').item) play();
  const completed = await handleTtsQueueDelivery({ ...request, body: { ...request.body, action: 'complete' } });
  assert.deepEqual([renewed.status, completed.status], [200, 200], 'Both acknowledgements must accept the graph ID');
  assert.equal(renewed.data.state, 'renewed');
  assert.equal(renewed.data.leaseExpiresAt, renewedExpiry);
  assert.equal(completed.data.state, 'completed');

  // Expiry, a reconnecting consumer and a replayed completed graph must not
  // produce another delivery. A fresh queue instance reads the saved receipt.
  now += TTS_DELIVERY_LEASE_MS + 1;
  if (claimNextTTS(username, 'reconnected-browser').item) play();
  const replayed = await runGraph({ graph, context, executionId: started.executionId });
  assert.equal(replayed.nodes.get('speech')?.outputs?.itemId, itemId);
  const restartedQueue = createTTSDeliveryQueueStore(username);
  if (restartedQueue.claimNext('restarted-browser').item) play();
  assert.equal(playbackCount, 1);
  assert.deepEqual(restartedQueue.peek(), []);

  // Existing IDs still work, and relaxing ID syntax does not relax ownership.
  const ordinary = queueTTS(username, 'Another utterance.', 'conversation')!;
  const ordinaryClaim = claimNextTTS(username, 'browser-fixture').item!;
  const ordinaryRequest = { ...request, body: { itemId: ordinary.id, leaseToken: ordinaryClaim.leaseToken, action: 'complete' } };
  assert.equal((await handleTtsQueueDelivery({ ...ordinaryRequest,
    user: { ...request.user, isAuthenticated: false } })).status, 401);
  assert.equal((await handleTtsQueueDelivery({ ...ordinaryRequest,
    user: { ...request.user, username: 'different-profile' } })).status, 404);
  assert.equal((await handleTtsQueueDelivery({ ...ordinaryRequest,
    body: { ...ordinaryRequest.body, leaseToken: '00000000-0000-0000-0000-000000000000' } })).status, 409);
  for (const invalid of [undefined, '', 42]) {
    assert.equal((await handleTtsQueueDelivery({ ...ordinaryRequest,
      body: { ...ordinaryRequest.body, itemId: invalid } })).status, 400);
  }
  assert.equal((await handleTtsQueueDelivery(ordinaryRequest)).data.state, 'completed');
});
