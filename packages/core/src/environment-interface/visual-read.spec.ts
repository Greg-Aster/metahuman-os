import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-visual-read-'));
process.env.METAHUMAN_ROOT = root;
globalThis.fetch = async () => { throw new Error('Network forbidden in camera read fixture'); };
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../audit.js');
setAuditEnabled(false);
const { getQueueManager } = await import('../queue/index.js');
const manager = getQueueManager();
const { dispatchEnvironmentVisualReads, recordEnvironmentVisualReadResult, releaseEnvironmentStreamWork,
  subscribeEnvironmentActions, writeEnvironmentBridgeState } = await import('./store.js');
const { environmentImageInputNode } = await import('../nodes/environment/image-input.node.js');
const { runDurableGraph, withGraphWork } = await import('../durable-execution/runtime.js');
const { ExecutionEngine } = await import('../queue/execution-engine.js');
new ExecutionEngine({}, manager); // Adapter work must deliver receipts without a recovery sweep.
const { openExecutionStore } = await import('../durable-execution/storage.js');
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js');
const sessionId = 'read-body';
const username = 'read-fixture';
const visual = { id: 'latest-stream', timestamp: '2026-10-11T01:00:00.000Z',
  mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
  metadata: { robotId: 'selected', gatewayInstance: 'gateway', epoch: 2, counter: 5 } };
const graph = validateSvelteFlowGraph({ name: 'Selected camera read', version: '1.0', format: 'svelte-flow',
  scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 5 },
  nodes: [
    { id: 'session', type: 'inputNode', position: { x: 0, y: 0 }, data: { label: 'Session', nodeType: 'text_input', properties: { inputKey: '', message: sessionId } } },
    { id: 'read', type: 'environmentNode', position: { x: 1, y: 0 }, data: { label: 'Read', nodeType: 'environment_visual_read', properties: {} } },
    { id: 'select', type: 'environmentNode', position: { x: 2, y: 0 }, data: { label: 'Select', nodeType: 'environment_image_input', properties: {} } },
  ], edges: [
    { id: 'session-read', source: 'session', sourceHandle: 'text', target: 'read', targetHandle: 'sessionId' },
    { id: 'read-select', source: 'read', sourceHandle: 'work', target: 'select', targetHandle: 'work' },
  ] });

function connect() {
  writeEnvironmentBridgeState({ enabled: true, updatedAt: new Date().toISOString(), sessions: {}, feedback: [] });
  return subscribeEnvironmentActions(sessionId, () => {});
}

async function run(executionId?: string) {
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'user', username, input: { id: randomUUID() } });
  assert.ok(manager.claim(work.id));
  const result = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runDurableGraph({ graph, executionId,
    context: { username, requestId: randomUUID(), environment: 'server' } }), async input => manager.enqueue(input));
  manager.complete(work.id, result.status !== 'failed', { status: result.status });
  return result;
}

test('selected vision reads stream cache across actual durable dispatch and continuation without a body command', async () => {
  const disconnect = connect();
  try {
    const started = await run();
    assert.equal(started.status, 'waiting', started.error?.stack);
    const requests = dispatchEnvironmentVisualReads(sessionId);
    assert.equal(requests.length, 1);
    const request = requests[0];
    const work = manager.getTask(String(request.requestId))!;
    assert.equal(work.bodyLease, undefined);
    assert.equal(work.type, 'generic');
    recordEnvironmentVisualReadResult({ ...request, type: 'environment.visual.result', visual });
    await new Promise(resolve => setImmediate(resolve));
    const receiptStore = openExecutionStore(username);
    try { assert.equal(receiptStore.events(started.executionId!).filter(event => event.kind === 'work_result').length, 1); }
    finally { receiptStore.close(); }
    const completed = await run(started.executionId);
    assert.equal(completed.status, 'completed', completed.error?.stack);
    assert.deepEqual(completed.nodes.get('select')?.outputs?.frames, [visual]);
    assert.equal(manager.getAllTasks().some(task => task.type === 'environment_command'), false);
    assert.deepEqual(dispatchEnvironmentVisualReads(sessionId), [], 'Resuming cannot issue a second camera read');
    const store = openExecutionStore(username);
    try { assert.equal(store.events(started.executionId!).filter(event => event.kind === 'work_result').length, 1); }
    finally { store.close(); }
  } finally { disconnect(); }
});

test('absent current frame and failed read cannot silently use a supplied old snapshot', async () => {
  const context = (result: object) => ({ graphExecution: { pendingEvents: () => [], events: () => [{
    eventId: 'receipt', kind: 'work_result', payload: { effectId: 'read', result },
  }], recordFrames: () => {} } });
  const inputs = { work: { effectId: 'read' }, visual };
  const absent = await environmentImageInputNode.execute(inputs, context({ state: 'completed', result: { visual: null } }) as any, {});
  assert.deepEqual(absent.frames, []);
  await assert.rejects(environmentImageInputNode.execute(inputs,
    context({ state: 'failed', error: { message: 'Bridge disconnected' } }) as any, {}), /Bridge disconnected/);
});

test('disconnect completes outstanding reads and absent bridge reports a failed read', () => {
  const disconnect = connect();
  const work = manager.enqueue({ type: 'generic', handler: 'environment.visual-read', resource: 'camera', source: 'system', username, input: { sessionId } });
  dispatchEnvironmentVisualReads(sessionId);
  disconnect();
  releaseEnvironmentStreamWork(sessionId);
  assert.equal(manager.getTask(work.id)?.state, 'failed');
  const absent = manager.enqueue({ type: 'generic', handler: 'environment.visual-read', resource: 'camera', source: 'system', username, input: { sessionId } });
  assert.equal(manager.getTask(absent.id)?.state, 'failed');
});

test('old bridge stream teardown cannot fail a new connection camera read', () => {
  const disconnect = connect();
  const work = manager.enqueue({ type: 'generic', handler: 'environment.visual-read', resource: 'camera', source: 'system', username, input: { sessionId } });
  dispatchEnvironmentVisualReads(sessionId, 'new-connection');
  releaseEnvironmentStreamWork(sessionId, 'old-connection');
  assert.equal(manager.getTask(work.id)?.state, 'leased');
  recordEnvironmentVisualReadResult({ requestId: work.id, sessionId, visual: null });
  assert.deepEqual(manager.getTask(work.id)?.result, { visual: null });
  disconnect();
});


test('vision configuration uses the same finite bridge request owner without a body lease', () => {
  const disconnect = connect();
  try {
    const vision = { operation: 'select', frame: visual, box: { x: .1, y: .2, width: .3, height: .4 }, description: 'keys' };
    const work = manager.enqueue({ type: 'generic', handler: 'environment.visual-read', resource: 'camera', source: 'system', username,
      input: { sessionId, vision } });
    const request = dispatchEnvironmentVisualReads(sessionId).find(request => request.requestId === work.id)!;
    assert.deepEqual(request.frame, visual);
    assert.equal(request.operation, 'select');
    assert.equal(manager.getTask(work.id)?.bodyLease, undefined);
    const result = { operation: 'select', queryId: work.id, referenceFrameId: visual.id, classes: ['keys'], tracking: true };
    recordEnvironmentVisualReadResult({ requestId: work.id, sessionId, vision: result });
    assert.deepEqual(manager.getTask(work.id)?.result, { vision: result });
    assert.deepEqual(dispatchEnvironmentVisualReads(sessionId), []);
  } finally { disconnect(); }
});


for (const outcome of ['failed', 'disconnected'] as const) {
  test(`adapter ${outcome} read delivers its failure without recovery`, async () => {
    const disconnect = connect();
    try {
      const started = await run();
      assert.equal(started.status, 'waiting');
      const [request] = dispatchEnvironmentVisualReads(sessionId);
      assert.ok(request);
      if (outcome === 'disconnected') releaseEnvironmentStreamWork(sessionId);
      else recordEnvironmentVisualReadResult({ ...request, error: 'Camera unavailable' });
      await new Promise(resolve => setImmediate(resolve));
      const store = openExecutionStore(username);
      try {
        const receipts = store.events(started.executionId!).filter(event => event.kind === 'work_result');
        assert.equal(receipts.length, 1);
        assert.equal((receipts[0].payload as any).result.state, 'failed');
      } finally { store.close(); }
      const completed = await run(started.executionId);
      assert.equal(completed.status, 'failed');
      assert.equal(manager.getTask(String(request.requestId))?.state, 'failed');
    } finally { disconnect(); }
  });
}
