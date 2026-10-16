import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph'
import { contentHash, ExecutionStore } from './store.js'
import { ExecutionCheckpointer, type CheckpointConfig } from './checkpointer.js'
import { type CheckpointTransition, type ExecutionDefinition } from './types.js'
import type { VisualObservationRecord } from '../visual-observation.js'

const definition: ExecutionDefinition = {
  graphId: 'test-workflow', graphHash: 'graph-v1', runtimeVersion: 'runtime-v1',
  checkpointSchemaVersion: 1, nodeVersions: { review: 'implementation-v1' },
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-durable-owner-'))
  const filename = path.join(directory, 'execution.sqlite')
  const store = new ExecutionStore(filename)
  const execution = store.create('test-user', definition)
  const lease = store.claim(execution.executionId, definition)
  const saver = new ExecutionCheckpointer(store, lease)
  const config = { configurable: { thread_id: execution.executionId }, durability: 'sync' as const }
  return { directory, filename, store, execution, lease, saver, config }
}

async function checkpoint(f: ReturnType<typeof fixture>, transition?: CheckpointTransition, config: CheckpointConfig = f.config) {
  return f.saver.put(config, {
    v: 4, id: randomUUID(), ts: new Date().toISOString(),
    channel_values: transition ? { executionTransition: transition } : {}, channel_versions: {}, versions_seen: {},
  }, { source: 'loop', step: 0, parents: {} })
}

test('execution listing preserves full records and waits with one database query', () => {
  const store = new ExecutionStore(':memory:');
  try {
    const first = store.create('first-user', definition);
    const second = store.create('second-user', definition);
    store.db.prepare('INSERT INTO execution_waits VALUES (?, ?)').run(first.executionId, 'physical_result');
    const expected = [store.get(first.executionId), store.get(second.executionId)];
    const prepare = store.db.prepare.bind(store.db);
    let queries = 0;
    store.db.prepare = ((sql: string) => { queries++; return prepare(sql); }) as typeof store.db.prepare;
    assert.deepEqual(store.list(), expected);
    assert.equal(queries, 1, 'listing must not issue one more query for each historical execution');
    queries = 0;
    assert.deepEqual(store.list('first-user'), [expected[0]]);
    assert.equal(queries, 1);
    assert.deepEqual(store.list('unknown-user'), []);
    const personResume = { status: 'candidate', sessionId: 'robot-session', candidateFrame: 'frame-1' };
    prepare('INSERT INTO execution_task VALUES (?, ?, ?)').run(first.executionId, 'checkpoint',
      store.codec.encode({ personResume }));
    queries = 0;
    assert.deepEqual(store.summaries('first-user'), [{
      executionId: first.executionId, graph: definition.graphId, status: first.status,
      waitingReason: 'physical_result', updatedAt: new Date(first.updatedAt).toISOString(),
      personResume, liveWriter: false,
    }]);
    assert.equal(queries, 1, 'queue projection reads optional task state in the same query');
    const old = store.create('first-user', definition);
    const latest = store.create('first-user', definition);
    prepare("UPDATE executions SET status='completed', updated_at=1 WHERE execution_id=?").run(old.executionId);
    prepare("UPDATE executions SET status='completed', updated_at=2 WHERE execution_id=?").run(latest.executionId);
    assert.deepEqual(store.summaries('first-user', 1).map(row => row.executionId), [first.executionId, latest.executionId]);
    assert.deepEqual(store.summaries('first-user', 0).map(row => row.executionId), [first.executionId],
      'the work queue excludes terminal workflows while retaining unfinished work');
    assert.equal(store.summaries('first-user').length, 3, 'history projection must not delete older executions');
  } finally { store.close(); }
});

test('event bursts share one pending wake without losing inputs or changing admitted payloads', async () => {
  const f = fixture()
  try {
    const id = f.execution.executionId
    const first = f.store.deliverEvent(id, { eventId: 'event-0', kind: 'observation_received', payload: { index: 0 } })
    const wake = f.store.pendingDispatches()[0]
    f.store.acknowledgeAdmission(wake.effectId, 'queued-wake')
    for (let index = 1; index < 100; index++) {
      f.store.deliverEvent(id, { eventId: `event-${index}`, kind: index === 50 ? 'user_steering' : 'observation_received', payload: { index } })
    }
    assert.equal(f.store.dispatches(id).length, 1)
    assert.deepEqual(f.store.dispatch(wake.effectId).payload, wake.payload)
    assert.equal(f.store.dispatch(wake.effectId).workItemId, 'queued-wake')
    assert.equal(f.store.dispatch(wake.effectId).checkpointId, 'event:100')
    assert.deepEqual(f.store.events(id).map(event => event.payload), Array.from({ length: 100 }, (_, index) => ({ index })))
    const config = await checkpoint(f, { transitionId: 'first-event', processedEventIds: [first.eventId] })
    assert.equal(f.store.dispatch(wake.effectId).status, 'admitted', 'consuming the original anchor must not lose later inputs')
    const reopened = new ExecutionStore(f.filename)
    try {
      reopened.deliverEvent(id, { eventId: 'event-100', kind: 'observation_received', payload: { index: 100 } })
      assert.equal(reopened.dispatches(id).length, 1, 'coalescing survives reopening the store')
      assert.equal(reopened.dispatch(wake.effectId).checkpointId, 'event:101')
    } finally { reopened.close() }
    await checkpoint(f, { transitionId: 'rest', processedEventIds: f.store.events(id, 1).map(event => event.eventId) }, config)
    assert.equal(f.store.dispatch(wake.effectId).status, 'completed')
    f.store.deliverEvent(id, { eventId: 'next', kind: 'user_steering', payload: { text: 'next request' } })
    assert.equal(f.store.pendingDispatches().length, 1, 'new inputs still wake the execution after the previous batch settles')
  } finally { f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true }) }
})

test('events arriving during an accepted wake share one follow-up without altering the running wake', () => {
  const f = fixture()
  try {
    const id = f.execution.executionId
    f.store.deliverEvent(id, { eventId: 'initial', kind: 'user_steering', payload: {} })
    const wake = f.store.pendingDispatches()[0]
    f.store.acknowledgeAdmission(wake.effectId, 'running-wake')
    f.store.release(f.lease)
    f.store.acceptAction(wake.effectId)
    const accepted = f.store.dispatch(wake.effectId)
    for (let index = 0; index < 100; index++) {
      f.store.deliverEvent(id, { eventId: `incoming-${index}`, kind: 'observation_received', payload: { index } })
    }
    assert.deepEqual(f.store.dispatch(wake.effectId), accepted)
    assert.equal(f.store.dispatches(id).length, 2)
    assert.equal(f.store.pendingDispatches().length, 1)
    assert.equal(f.store.events(id).length, 101)
  } finally { f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true }) }
})

test('legacy unstarted wakes consolidate without cancellation receipts interrupting their objective', () => {
  const f = fixture()
  try {
    const id = f.execution.executionId
    f.store.release(f.lease)
    f.store.deliverEvent(id, { eventId: 'first', kind: 'observation_received', payload: {} })
    const first = f.store.pendingDispatches()[0]
    f.store.acknowledgeAdmission(first.effectId, 'first-work')
    f.store.acceptAction(first.effectId)
    f.store.deliverEvent(id, { eventId: 'second', kind: 'user_steering', payload: { text: 'stop' } })
    const second = f.store.pendingDispatches()[0]
    f.store.acknowledgeAdmission(second.effectId, 'second-work')
    // Reproduce two unstarted admissions written by the previous runtime.
    f.store.db.prepare("UPDATE execution_outbox SET status='admitted' WHERE effect_id=?").run(first.effectId)
    f.store.deliverEvent(id, { eventId: 'third', kind: 'observation_received', payload: {} })
    assert.equal(f.store.dispatch(first.effectId).checkpointId, 'event:3')
    assert.equal(f.store.dispatch(second.effectId).status, 'completed')
    const before = f.store.get(id)
    f.store.deliverWorkResult(second.effectId, 'second-work', { state: 'cancelled' })
    assert.equal(f.store.get(id).status, before.status)
    assert.equal(f.store.get(id).waitingReason, before.waitingReason)
    assert.equal(f.store.dispatches(id).filter(effect => ['pending', 'admitted'].includes(effect.status)).length, 1)
    assert.deepEqual(f.store.events(id).slice(0, 3).map(event => event.eventId), ['first', 'second', 'third'])
    assert.equal(f.store.acceptAction(first.effectId).status, 'accepted')
  } finally { f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true }) }
})

test('Robot Status selects the same current task without decoding unrelated execution history', () => {
  const store = new ExecutionStore(':memory:');
  try {
    const add = (username: string, status: string, updatedAt: string, outcome = 'continue', objectiveComplete = false) => {
      const record = store.create(username, definition);
      store.db.prepare('UPDATE executions SET status=? WHERE execution_id=?').run(status, record.executionId);
      const task = { executionId: record.executionId, updatedAt, decision: { outcome, objectiveComplete } };
      store.db.prepare('INSERT INTO execution_task VALUES (?, ?, ?)').run(record.executionId, 'checkpoint', store.codec.encode(task));
      return { ...task, executionStatus: status };
    };
    assert.equal(store.projectedTask('first-user'), null);
    const active = add('first-user', 'waiting', '2026-01-01T00:00:01.000Z');
    const complete = add('first-user', 'completed', '2026-01-01T00:00:09.000Z', 'continue', true);
    add('first-user', 'running', '2026-01-01T00:00:08.000Z', 'abandon');
    add('first-user', 'waiting', '2026-01-01T00:00:07.000Z', 'cancel');
    add('first-user', 'waiting', '2026-01-01T00:00:06.000Z', 'continue', true);
    add('second-user', 'running', '2026-01-01T00:00:10.000Z');
    for (let i = 0; i < 100; i++) store.create('first-user', definition);
    const prepare = store.db.prepare.bind(store.db);
    const decode = store.codec.decode.bind(store.codec);
    let queries = 0;
    let decodes = 0;
    store.db.prepare = ((sql: string) => { queries++; return prepare(sql); }) as typeof store.db.prepare;
    store.codec.decode = ((value: string) => { decodes++; return decode(value); }) as typeof store.codec.decode;
    assert.deepEqual(store.projectedTask('first-user'), active);
    assert.equal(queries, 1);
    assert.equal(decodes, 5, "only this profile's task records need decoding");
    const latest = add('first-user', 'running', '2026-01-01T00:00:02.000Z');
    assert.deepEqual(store.projectedTask('first-user'), latest);
    prepare("UPDATE executions SET status='completed' WHERE username=?").run('first-user');
    assert.deepEqual(store.projectedTask('first-user'), complete, 'newest task wins when no unfinished task remains');
    assert.equal(store.projectedTask('unknown-user'), null);
  } finally { store.close(); }
});

for (const firstDelivery of ['timed', 'untimed', 'legacy'] as const) {
  test(`camera evidence remains identical across delivery timing changes (${firstDelivery})`, async () => {
    const f = fixture()
    try {
      const frame = { id: 'captured', timestamp: '2026-01-01T00:00:01.000Z', source: 'robot-camera',
        mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
        metadata: { actionId: 'capture-1', correlationId: 'turn-1', robotId: 'body-1' } }
      const timed = { ...frame, metadata: { ...frame.metadata,
        actionTiming: { version: 1, coreObservationReceivedAt: '2026-01-01T00:00:02.000Z' }, actionStageDurations: {} } }
      let config = await checkpoint(f, { transitionId: 'initial-camera', frames: [firstDelivery === 'untimed' ? frame : timed] })
      assert.deepEqual(f.store.frame(f.execution.executionId, frame.id), frame)
      if (firstDelivery === 'legacy') {
        // Reproduce a frame committed before timing and evidence were separated.
        f.store.db.prepare('UPDATE execution_frames SET identity=?, frame=? WHERE execution_id=? AND frame_id=?')
          .run(contentHash(timed), f.store.encodeDocument(f.execution.executionId, timed), f.execution.executionId, frame.id)
      }
      const savedBytes = () => f.store.db.prepare('SELECT frame FROM execution_frames WHERE execution_id=? AND frame_id=?')
        .get(f.execution.executionId, frame.id)
      const original = savedBytes()
      for (const repeated of [frame, timed, { ...timed, metadata: { ...timed.metadata,
        actionTiming: { version: 1, coreObservationReceivedAt: '2026-01-01T00:01:02.000Z' } } }]) {
        config = await checkpoint(f, { transitionId: randomUUID(), frames: [repeated] }, config)
        assert.deepEqual(savedBytes(), original, 'Delivery diagnostics cannot replace already committed camera evidence')
      }
      for (const changed of [
        { ...frame, dataUrl: 'data:image/jpeg;base64,different' },
        { ...frame, timestamp: '2026-01-01T00:00:03.000Z' },
        { ...frame, source: 'another-camera' },
        { ...frame, mimeType: 'image/png' },
        { ...frame, metadata: { ...frame.metadata, actionId: 'another-action' } },
        { ...frame, metadata: { ...frame.metadata, correlationId: 'another-turn' } },
        { ...frame, metadata: { ...frame.metadata, robotId: 'another-body' } },
      ]) {
        await assert.rejects(checkpoint(f, { transitionId: randomUUID(), frames: [changed] }, config),
          /Frame identity reused with different evidence/)
        assert.deepEqual(savedBytes(), original)
      }
      assert.equal(f.store.dispatches(f.execution.executionId).length, 0)
    } finally { f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
}

test('LangGraph checkpoint commits dispatch intent and resumes the saved pending review', async () => {
  const f = fixture()
  let planned = 0
  let reviewed = 0
  const State = Annotation.Root({ value: Annotation<string>(), executionTransition: Annotation<CheckpointTransition>() })
  const build = (saver: ExecutionCheckpointer) => new StateGraph(State)
    .addNode('plan', () => {
      planned++
      return { executionTransition: { transitionId: 'planned', dispatches: [{ effectId: 'effect-1', kind: 'test', payload: {}, actionId: 'action-1' }] } }
    })
    .addNode('wait', () => {
      const result = interrupt<string>('action-1')
      return { value: result, executionTransition: { transitionId: 'result', status: 'running' as const } }
    })
    .addNode('review', state => {
      reviewed++
      return { value: `reviewed:${state.value}`, executionTransition: { transitionId: 'reviewed', status: 'completed' as const } }
    })
    .addEdge(START, 'plan').addEdge('plan', 'wait').addEdge('wait', 'review').addEdge('review', END)
    .compile({ checkpointer: saver, interruptBefore: ['review'] })
  let program = build(f.saver)
  await program.invoke({ value: '' }, f.config)
  assert.deepEqual((await program.getState(f.config)).next, ['wait'])
  assert.equal(f.store.pendingDispatches().length, 1)
  f.store.acknowledgeAdmission('effect-1', 'job-1')
  f.store.acceptAction('effect-1')
  f.store.recordResult(f.execution.executionId, 'action-1', {
    eventId: 'result-1', kind: 'physical_result', actionId: 'action-1', payload: { completed: true },
  })
  await program.invoke(new Command({ resume: 'result-1' }), f.config)
  assert.deepEqual((await program.getState(f.config)).next, ['review'])
  assert.equal(reviewed, 0)
  f.store.release(f.lease)
  f.store.close()

  const reopened = new ExecutionStore(f.filename)
  const newLease = reopened.claim(f.execution.executionId, definition)
  program = build(new ExecutionCheckpointer(reopened, newLease))
  // No result is submitted again: resume the actual next checkpoint position.
  const result = await program.invoke(null, f.config)
  assert.equal(result.value, 'reviewed:result-1')
  assert.equal(planned, 1)
  assert.equal(reviewed, 1)
  assert.equal(reopened.get(f.execution.executionId).status, 'completed')
  reopened.release(newLease)
  reopened.close()
})

test('cancellation before or after admission never revives a dispatch', async () => {
  for (const admitted of [false, true]) {
    const f = fixture()
    const State = Annotation.Root({ executionTransition: Annotation<CheckpointTransition>() })
    const program = new StateGraph(State).addNode('plan', () => ({ executionTransition: {
      transitionId: 'plan', dispatches: [{ effectId: 'effect', kind: 'test', payload: {} }],
    } })).addEdge(START, 'plan').addEdge('plan', END).compile({ checkpointer: f.saver })
    await program.invoke({}, f.config)
    if (admitted) f.store.acknowledgeAdmission('effect', 'job')
    f.store.cancel(f.execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
    assert.equal(f.store.pendingDispatches().length, 0)
    assert.throws(() => f.store.acceptAction('effect'), /cancelled/)
    f.store.acknowledgeAdmission('effect', 'job')
    assert.equal(f.store.dispatch('effect').status, 'cancelled')
    assert.throws(() => f.store.assertDispatchable('effect'), /cancelled/)
    f.store.close()
  }
})

test('terminal work receipts retain their committed graph-return snapshot across replay', async () => {
  for (const originalGraphs of [undefined, [{ graph: 'specialist', status: 'failed', output: null }]]) {
    const f = fixture()
    try {
      await checkpoint(f, { transitionId: 'specialist', dispatches: [
        { effectId: 'specialist', kind: 'coordinator_work', payload: {} },
      ] })
      f.store.acknowledgeAdmission('specialist', 'specialist-job')
      const receipt = { state: 'failed', result: null, error: { message: 'Provider failed' } }
      const first = f.store.deliverWorkResult('specialist', 'specialist-job', receipt, originalGraphs)
      assert.equal(f.store.hasWorkResultReceipt('specialist', 'specialist-job', receipt), true)
      assert.equal(f.store.hasWorkResultReceipt('specialist', 'another-job', receipt), false)
      assert.equal(f.store.hasWorkResultReceipt('specialist', 'specialist-job', { ...receipt, state: 'completed' }), false)
      const replay = f.store.deliverWorkResult('specialist', 'specialist-job', receipt,
        [{ graph: 'specialist', status: 'failed', output: null, projectionVersion: 2 }])
      assert.deepEqual(replay, first)
      assert.equal(f.store.events(f.execution.executionId).filter(event => event.kind === 'work_result').length, 1)
      assert.throws(() => f.store.deliverWorkResult('specialist', 'specialist-job', { ...receipt, state: 'completed' }),
        /receipt reused with different content/)
    } finally { f.store.close() }
  }
})

test('resume receipts belong to their writer, including progress inside an interrupted node', async () => {
  const f = fixture()
  const State = Annotation.Root({ value: Annotation<unknown>() })
  const build = (saver: ExecutionCheckpointer) => new StateGraph(State)
    .addNode('wait', () => {
      const result = interrupt('result')
      const observation = interrupt('observation')
      return { value: [result, observation] }
    }).addEdge(START, 'wait').addEdge('wait', END).compile({ checkpointer: saver })
  try {
    await build(f.saver).invoke({ value: null }, f.config)
    f.store.settle(f.lease, 'waiting', 'robot_result')
    f.store.release(f.lease)
    const event = f.store.deliverEvent(f.execution.executionId, { eventId: 'result', kind: 'physical_result', payload: {} })
    const effectId = `${f.execution.executionId}:resume:${event.eventId}`
    f.store.acknowledgeAdmission(effectId, 'old-wake')
    f.store.acceptAction(effectId)
    const before = f.store.get(f.execution.executionId)
    const lease = f.store.claim(f.execution.executionId, definition)
    const program = build(new ExecutionCheckpointer(f.store, lease))
    await program.invoke(new Command({ resume: event.eventId }), f.config)
    f.store.settle(lease, 'waiting', 'observation')
    f.store.release(lease)
    const progressed = f.store.get(f.execution.executionId)
    assert.equal(progressed.checkpointVersion, before.checkpointVersion)
    assert.equal(progressed.lastProcessedSequence, before.lastProcessedSequence)
    assert.equal(progressed.ownerGeneration, before.ownerGeneration + 1)
    assert.equal((await program.getState(f.config)).tasks[0].interrupts[0].value, 'observation')
    const failure = { state: 'failed', error: { message: 'Earlier worker failed' } }
    f.store.deliverWorkResult(effectId, 'old-wake', failure)
    assert.equal(f.store.get(f.execution.executionId).status, 'waiting')
    assert.equal(f.store.get(f.execution.executionId).waitingReason, 'observation')
    const recorded = f.store.events(f.execution.executionId)
    f.store.deliverWorkResult(effectId, 'old-wake', failure)
    assert.deepEqual(f.store.events(f.execution.executionId), recorded)

    const next = f.store.deliverEvent(f.execution.executionId, { eventId: 'observation', kind: 'observation_received', payload: {} })
    const nextEffect = `${f.execution.executionId}:resume:${next.eventId}`
    f.store.acknowledgeAdmission(nextEffect, 'current-wake')
    f.store.acceptAction(nextEffect)
    const current = f.store.claim(f.execution.executionId, definition, undefined, undefined,
      { effectId: nextEffect, workItemId: 'current-wake' })
    assert.equal(f.store.dispatch(nextEffect).attemptGeneration, current.generation)
    f.store.release(current)
    f.store.deliverWorkResult(nextEffect, 'current-wake', failure)
    assert.equal(f.store.get(f.execution.executionId).status, 'failed', 'The actual failed writer settles its own execution')
    assert.equal(f.store.get(f.execution.executionId).waitingReason, undefined)
  } finally { f.store.close() }
})

test('interrupted and pre-migration resume receipts create one correlated recovery', async () => {
  for (const legacy of [false, true]) {
    const f = fixture()
    try {
      await checkpoint(f)
      f.store.settle(f.lease, 'waiting', 'user_or_autonomy')
      f.store.release(f.lease)
      const event = f.store.deliverEvent(f.execution.executionId, { eventId: 'wake', kind: 'autonomy_trigger', payload: {} })
      const effectId = `${f.execution.executionId}:resume:${event.eventId}`
      f.store.acknowledgeAdmission(effectId, 'interrupted-wake')
      f.store.acceptAction(effectId)
      if (legacy) f.store.db.prepare('UPDATE execution_outbox SET attempt_generation=NULL WHERE effect_id=?').run(effectId)
      const receipt = { state: legacy ? 'failed' : 'cancelled', error: { message: 'Worker stopped' } }
      f.store.deliverWorkResult(effectId, 'interrupted-wake', receipt)
      const state = f.store.get(f.execution.executionId)
      assert.equal(state.status, 'waiting')
      assert.equal(state.waitingReason, 'interrupted')
      assert.equal(state.checkpointVersion, 1)
      const recovery = f.store.pendingDispatches()
      assert.equal(recovery.length, 1)
      assert.equal(recovery[0].kind, 'graph_resume')
      assert.match(recovery[0].effectId, /:interrupted-wake$/)
      f.store.deliverWorkResult(effectId, 'interrupted-wake', receipt)
      assert.deepEqual(f.store.pendingDispatches(), recovery)
      assert.deepEqual(f.store.get(f.execution.executionId), state)
    } finally { f.store.close() }
  }
})

test('consuming a result retires queued wakes but not the runner that must still review it', async () => {
  const f = fixture()
  try {
    let config = await checkpoint(f)
    f.store.settle(f.lease, 'waiting', 'robot_result')
    f.store.release(f.lease)
    const result = f.store.deliverEvent(f.execution.executionId, { eventId: 'physical-result', kind: 'physical_result', payload: {} })
    const runner = `${f.execution.executionId}:resume:${result.eventId}`
    f.store.acknowledgeAdmission(runner, 'runner')
    f.store.acceptAction(runner)
    const observation = f.store.deliverEvent(f.execution.executionId, { eventId: 'observation', kind: 'observation_received', payload: {} })
    const queued = `${f.execution.executionId}:resume:${observation.eventId}`
    f.store.acknowledgeAdmission(queued, 'queued')
    const lease = f.store.claim(f.execution.executionId, definition, undefined, undefined, { effectId: runner, workItemId: 'runner' })
    const saver = new ExecutionCheckpointer(f.store, lease)
    config = await saver.put(config, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(),
      channel_values: { executionTransition: { transitionId: 'received', processedEventIds: [result.eventId, observation.eventId] } },
      channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 1, parents: {} })
    assert.equal(f.store.dispatch(queued).status, 'completed')
    assert.equal(f.store.dispatch(runner).status, 'accepted', 'The result checkpoint is not the end of its reviewing invocation')
    f.store.release(lease)
    f.store.close()
    const reopened = new ExecutionStore(f.filename)
    try {
      assert.equal(reopened.acceptAction(runner).status, 'accepted', 'A restarted runner still resumes its saved review')
      const next = reopened.claim(f.execution.executionId, definition, undefined, undefined, { effectId: runner, workItemId: 'runner' })
      reopened.release(next)
      reopened.deliverWorkResult(runner, 'runner', { state: 'failed', error: { message: 'Review failed after result consumption' } })
      assert.equal(reopened.get(f.execution.executionId).status, 'failed', 'A current review failure must settle even though its input was consumed')
    } finally { reopened.close() }
  } finally { if (f.store.db.open) f.store.close() }
})

test('an external child and its native subgraphs retain separate checkpoints in the parent thread', async () => {
  const f = fixture()
  const State = Annotation.Root({ value: Annotation<string>() })
  const parent = new StateGraph(State).addNode('wait', () => ({ value: interrupt<string>('child-result') }))
    .addEdge(START, 'wait').addEdge('wait', END).compile({ checkpointer: f.saver })
  await parent.invoke({ value: 'parent-objective' }, f.config)
  const before = await parent.getState(f.config)
  const childSaver = new ExecutionCheckpointer(f.store, f.lease, undefined, 'work:effect-1:graph:0')
  const nested = new StateGraph(State).addNode('nested', state => ({ value: `${state.value}:nested` }))
    .addEdge(START, 'nested').addEdge('nested', END).compile({ checkpointer: childSaver })
  const child = new StateGraph(State).addNode('call', async state => nested.invoke(state))
    .addNode('wait', () => ({ value: interrupt<string>('child-observation') }))
    .addEdge(START, 'call').addEdge('call', 'wait').addEdge('wait', END).compile({ checkpointer: childSaver })
  await child.invoke({ value: 'child-input' }, f.config)
  assert.equal((await parent.getState(f.config)).config.configurable?.checkpoint_id, before.config.configurable?.checkpoint_id)
  assert.equal((await parent.getState(f.config)).values.value, 'parent-objective')
  assert.equal((await child.getState(f.config)).values.value, 'child-input:nested')
  const namespaces = f.store.db.prepare('SELECT namespace FROM execution_heads WHERE execution_id = ?')
    .all(f.execution.executionId) as Array<{ namespace: string }>
  assert.ok(namespaces.some(row => row.namespace === ''))
  assert.ok(namespaces.some(row => row.namespace === 'work:effect-1:graph:0|'))
  assert.ok(namespaces.some(row => row.namespace.startsWith('work:effect-1:graph:0|call:')))
  const history = []
  for await (const tuple of childSaver.list(f.config, { filter: { source: 'loop' }, limit: 2 })) history.push(tuple)
  assert.equal(history.length, 2)
  assert.ok(history.every(tuple => tuple.config.configurable?.checkpoint_ns === '' && tuple.metadata?.source === 'loop'))
  f.store.release(f.lease)
  f.store.close()

  const reopened = new ExecutionStore(f.filename)
  const lease = reopened.claim(f.execution.executionId, definition)
  const resumed = new StateGraph(State).addNode('wait', () => ({ value: interrupt<string>('child-observation') }))
    .addEdge(START, 'wait').addEdge('wait', END)
    .compile({ checkpointer: new ExecutionCheckpointer(reopened, lease, undefined, 'work:effect-1:graph:0') })
  // The saved child is waiting after its successful nested call; that call is not replayed.
  assert.equal((await resumed.invoke(new Command({ resume: 'child-result' }), f.config)).value, 'child-result')
  const root = await new ExecutionCheckpointer(reopened, lease).getTuple(f.config)
  assert.equal(root?.checkpoint.id, before.config.configurable?.checkpoint_id)
  reopened.release(lease)
  reopened.close()
})

test('event identity, cursor and stale checkpoint updates are authoritative', async () => {
  const f = fixture()
  const State = Annotation.Root({ executionTransition: Annotation<CheckpointTransition>(), objective: Annotation<string>() })
  const program = new StateGraph(State).addNode('decision', state => state)
    .addEdge(START, 'decision').addEdge('decision', END).compile({ checkpointer: f.saver })
  const event = { eventId: randomUUID(), kind: 'user_steering', payload: { text: 'the new objective' } }
  assert.equal(f.store.findEvent(f.execution.executionId, event.eventId), null)
  assert.throws(() => f.store.event(f.execution.executionId, event.eventId), /Unknown execution event/)
  f.store.appendEvent(f.execution.executionId, event)
  assert.deepEqual(f.store.findEvent(f.execution.executionId, event.eventId), f.store.event(f.execution.executionId, event.eventId))
  await program.invoke({ objective: 'original', executionTransition: { transitionId: 'first', processedEventIds: [event.eventId] } }, f.config)
  const stale = (await program.getState(f.config)).config
  await program.updateState(f.config, { objective: 'newer' })
  await assert.rejects(program.updateState(stale, { objective: 'stale' }), /stale checkpoint/i)
  assert.equal((await program.getState(f.config)).values.objective, 'newer')
  assert.equal(f.store.appendEvent(f.execution.executionId, event).sequence, 1)
  assert.equal(f.store.get(f.execution.executionId).lastSequence, 1)
  assert.equal(f.store.get(f.execution.executionId).lastProcessedSequence, 1)
  assert.throws(() => f.store.appendEvent(f.execution.executionId, { ...event, payload: 'different' }), /different content/)
  f.store.close()
})

test('input admission and completion serialize without discarding accepted input or reviving audit receipts', async () => {
  const f = fixture()
  const receiver = f.store.enter('test-user', definition, 'input-receiver', {
    graph: { scheduler: { eventInputNodeId: 'receive' } }, context: {},
  })
  const receiverLease = f.store.claim(receiver.executionId, definition)
  const intent = { effectId: 'handoff', kind: 'execution_event', payload: {
    executionId: receiver.executionId, kind: 'user_steering', context: { userMessage: 'New instruction' },
  } }
  await checkpoint(f, { transitionId: 'input-handoff', dispatches: [intent] })
  f.store.deliverExecutionInput(intent.effectId)
  f.store.settle(receiverLease, 'completed')
  assert.equal(f.store.get(receiver.executionId).status, 'waiting')
  assert.equal(f.store.get(receiver.executionId).waitingReason, 'pending_input')
  const saver = new ExecutionCheckpointer(f.store, receiverLease)
  await saver.put({ configurable: { thread_id: receiver.executionId } }, {
    v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
    channel_values: { executionTransition: { transitionId: 'handled-input', processedEventIds: [intent.effectId] } },
  }, { source: 'loop', step: 0, parents: {} })
  f.store.settle(receiverLease, 'completed')
  assert.equal(f.store.get(receiver.executionId).status, 'completed')
  f.store.deliverExecutionInput(intent.effectId)
  assert.equal(f.store.events(receiver.executionId).length, 1, 'Repeated handoff returns its committed receipt even after completion')
  assert.throws(() => f.store.deliverEvent(receiver.executionId, {
    eventId: 'too-late', kind: 'user_steering', payload: { userMessage: 'Another instruction' },
  }), /finished before input admission/)
  assert.equal(f.store.findEvent(receiver.executionId, 'too-late'), null, 'Rejected input was never acknowledged as delivered')
  f.store.deliverEvent(receiver.executionId, { eventId: 'audit', kind: 'resume_result', payload: {} })
  assert.equal(f.store.hasPendingInput(receiver.executionId), false)
  assert.equal(f.store.get(receiver.executionId).status, 'completed', 'Audit receipts do not restart an execution')
  f.store.close()
})

test('separate writers serialize event sequences and reject stale ownership', () => {
  const f = fixture()
  const other = new ExecutionStore(f.filename)
  assert.throws(() => other.claim(f.execution.executionId, definition), /live writer/)
  for (let i = 0; i < 50; i++) {
    (i % 2 ? other : f.store).appendEvent(f.execution.executionId, { eventId: `e${i}`, kind: 'observation', payload: i })
  }
  assert.deepEqual(f.store.events(f.execution.executionId).map(e => e.sequence), Array.from({ length: 50 }, (_, i) => i + 1))
  f.store.release(f.lease)
  const takeover = other.claim(f.execution.executionId, definition)
  assert.throws(() => f.store.assertLease(f.lease), /Stale execution writer/)
  other.release(takeover)
  other.close()
  f.store.close()
})

test('resume compares the executing graph, schema and node versions', () => {
  const f = fixture()
  f.store.release(f.lease)
  for (const update of [{ graphHash: 'changed' }, { runtimeVersion: 'changed' }, { checkpointSchemaVersion: 2 }, { nodeVersions: { review: 'changed' } }]) {
    assert.throws(() => f.store.claim(f.execution.executionId, { ...definition, ...update }), /does not match/)
  }
  f.store.close()
})

test('successful output includes its channel and terminal transitions cannot revive work', async () => {
  const f = fixture()
  const saved = await checkpoint(f)
  await f.saver.putWrites(saved, [['output', 7]], 'task')
  await assert.rejects(f.saver.putWrites(saved, [['other-output', 7]], 'task'), /conflicts/)
  const terminal = await checkpoint(f, { transitionId: 'complete', status: 'completed' }, saved)
  assert.throws(() => f.store.settle(f.lease, 'waiting'), /terminal execution/)
  await assert.rejects(checkpoint(f, {
    transitionId: 'revive', status: 'running', dispatches: [{ effectId: 'late', kind: 'test', payload: {} }],
  }, terminal), /terminal execution/)
  f.store.cancel(f.execution.executionId, { eventId: 'late-cancel', kind: 'user_cancelled', payload: {} })
  assert.equal(f.store.get(f.execution.executionId).status, 'completed')
  assert.equal(f.store.pendingDispatches().length, 0)
  f.store.close()
})

test('a result consumed by a live graph settles its unneeded resume intent', async () => {
  const f = fixture()
  const event = f.store.deliverEvent(f.execution.executionId, { eventId: 'arrived', kind: 'observation', payload: {} })
  assert.equal(f.store.pendingDispatches().length, 1)
  await checkpoint(f, { transitionId: 'consumed', processedEventIds: [event.eventId], status: 'completed' })
  assert.equal(f.store.dispatch(`${f.execution.executionId}:resume:${event.eventId}`).status, 'completed')
  f.store.release(f.lease)
  assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
  f.store.close()
})

test('terminal retention honors lease expiry when a writer never releases ownership', async t => {
  for (const status of ['completed', 'failed', 'cancelled'] as const) {
    const f = fixture()
    try {
      if (status === 'cancelled') f.store.cancel(f.execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
      else f.store.settle(f.lease, status)
      const before = f.store.get(f.execution.executionId).leaseUntil! + 1
      assert.equal(await f.saver.pruneTerminal(before), 0, 'A live writer still owns cleanup')
      await assert.rejects(f.saver.deleteThread(f.execution.executionId), /active execution/)
      const clock = t.mock.method(Date, 'now', () => before)
      assert.throws(() => f.store.renew(f.lease), /Stale execution writer/)
      assert.equal(await f.saver.pruneTerminal(before), 1, `${status} history must not be pinned by an expired lease`)
      assert.equal(f.store.isRetired(f.execution.executionId), true)
      clock.mock.restore()
    } finally { f.store.close() }
  }
})

test('lease expiry does not retire unfinished executions or unresolved effects', async t => {
  const f = fixture()
  try {
    await checkpoint(f, { transitionId: 'unresolved', dispatches: [
      { effectId: 'action', kind: 'coordinator_work', actionId: 'motion', payload: {} },
    ] })
    f.store.acknowledgeAdmission('action', 'job')
    f.store.acceptAction('action')
    const before = f.store.get(f.execution.executionId).leaseUntil! + 1
    const clock = t.mock.method(Date, 'now', () => before)
    assert.equal(await f.saver.pruneTerminal(before + 1), 0)
    await assert.rejects(f.saver.deleteThread(f.execution.executionId), /active execution/)
    clock.mock.restore()
    f.store.cancel(f.execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
    t.mock.method(Date, 'now', () => before)
    assert.equal(await f.saver.pruneTerminal(before + 1), 0)
    await assert.rejects(f.saver.deleteThread(f.execution.executionId), /unresolved dispatch/)
    assert.throws(() => f.saver.assertProfileHistoryCanBeReset('test-user'), /pending execution results/)
    assert.equal(f.store.dispatch('action').status, 'accepted')
  } finally { f.store.close() }
})

test('uncertain-result correlation and retention survive separate instances', async () => {
  const f = fixture()
  await checkpoint(f, { transitionId: 'actions', dispatches: ['one', 'two'].map(id => ({
    effectId: id, kind: 'physical', actionId: id, payload: {},
  })) })
  const other = new ExecutionStore(f.filename)
  f.store.acknowledgeAdmission('one', 'job-one')
  f.store.acknowledgeAdmission('two', 'job-two')
  f.store.acceptAction('one')
  f.store.recordResult(f.execution.executionId, 'one', {
    eventId: 'lost-ack', kind: 'outcome_unknown', actionId: 'one', payload: { connectionLost: true },
  }, true)
  assert.throws(() => f.store.recordResult(f.execution.executionId, 'wrong-action', {
    eventId: 'wrong', kind: 'reconciliation', actionId: 'wrong-action', payload: { completed: true },
  }), /does not identify/)
  assert.equal(f.store.events(f.execution.executionId).length, 1)
  f.store.cancel(f.execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
  f.store.release(f.lease)
  await assert.rejects(f.saver.deleteThread(f.execution.executionId), /unresolved dispatch/)
  const result = { eventId: 'observed', kind: 'reconciliation', actionId: 'one', payload: { physicalResult: 'stopped' } }
  const once = f.store.recordResult(f.execution.executionId, 'one', result)
  const twice = other.recordResult(f.execution.executionId, 'one', result)
  assert.equal(once.sequence, twice.sequence)
  assert.equal(f.store.get(f.execution.executionId).status, 'cancelled', 'physical success does not complete an objective')
  assert.throws(() => other.acceptAction('two'), /cancelled/)
  other.close()
  f.store.close()
})

test('terminal failure retires undelivered local projections but protects unresolved Coordinator effects', async () => {
  const local = fixture()
  await checkpoint(local, { transitionId: 'projection', dispatches: [
    { effectId: 'buffer', kind: 'buffer_entry', payload: {} },
  ] })
  local.store.settle(local.lease, 'waiting', 'attempt_failed')
  assert.equal(local.store.dispatch('buffer').status, 'pending', 'A retry retains its pending projection')
  local.store.settle(local.lease, 'failed')
  assert.equal(local.store.dispatch('buffer').status, 'cancelled')
  local.store.release(local.lease)
  assert.equal(await local.saver.pruneTerminal(Date.now() + 1), 1)
  local.store.close()

  for (const status of ['pending', 'admitted', 'accepted', 'outcome_unknown']) {
    const f = fixture()
    await checkpoint(f, { transitionId: 'action', dispatches: [
      { effectId: 'action', kind: 'coordinator_work', payload: {}, actionId: 'motion' },
      { effectId: 'projection', kind: 'robot_status', payload: {} },
    ] })
    if (status !== 'pending') f.store.acknowledgeAdmission('action', 'job')
    if (status === 'accepted' || status === 'outcome_unknown') f.store.acceptAction('action')
    if (status === 'outcome_unknown') f.store.recordResult(f.execution.executionId, 'motion', {
      eventId: 'uncertain', kind: 'outcome_unknown', actionId: 'motion', payload: {},
    }, true)
    f.store.settle(f.lease, 'failed')
    assert.equal(f.store.dispatch('projection').status, 'cancelled')
    assert.equal(f.store.dispatch('action').status, status)
    assert.throws(() => f.store.assertDispatchable('action'), /not eligible/)
    f.store.release(f.lease)
    assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 0, `${status} work still needs its receipt`)
    f.store.recordResult(f.execution.executionId, 'motion', {
      eventId: 'terminal', kind: 'physical_result', actionId: 'motion', payload: { status: 'cancelled' },
    }, false, true)
    assert.equal(f.store.get(f.execution.executionId).status, 'failed', 'A result cannot revive the failed graph')
    assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
    f.store.close()
  }
})

test('non-dispatch confirmation requires the exact cancelled never-started Coordinator receipt', async () => {
  const f = fixture()
  await checkpoint(f, { transitionId: 'pending', dispatches: [
    { effectId: 'work', kind: 'coordinator_work', actionId: 'motion', payload: {} },
  ] })
  const receipt = { id: 'job', state: 'cancelled' as const,
    durable: { executionId: f.execution.executionId, effectId: 'work', recovery: 'reconcile' as const } }
  assert.throws(() => f.store.confirmUndispatched('work', receipt), /not eligible/)
  f.store.settle(f.lease, 'failed')
  for (const invalid of [
    { ...receipt, durable: { ...receipt.durable, effectId: 'wrong' } },
    { ...receipt, durable: { ...receipt.durable, executionId: 'wrong' } },
    { ...receipt, state: 'completed' as const },
    { ...receipt, startedAt: new Date().toISOString() },
  ]) assert.throws(() => f.store.confirmUndispatched('work', invalid), /does not prove/)
  assert.equal(f.store.events(f.execution.executionId).length, 0)
  const once = f.store.confirmUndispatched('work', receipt)
  const twice = f.store.confirmUndispatched('work', receipt)
  assert.equal(once.sequence, twice.sequence)
  assert.equal(once.kind, 'dispatch_cancelled')
  assert.equal(f.store.events(f.execution.executionId).length, 1)
  assert.equal(f.store.dispatch('work').status, 'cancelled')
  assert.equal(f.store.dispatch('work').workItemId, receipt.id)
  assert.throws(() => f.store.confirmUndispatched('work', { ...receipt, id: 'different' }), /does not prove/)
  f.store.release(f.lease)
  assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
  f.store.close()
})

test('claimed action evidence survives terminal parents without authorizing another dispatch', async () => {
  for (const terminal of ['failed', 'cancelled'] as const) {
    const f = fixture()
    await checkpoint(f, { transitionId: 'dispatch', dispatches: [
      { effectId: 'effect', kind: 'coordinator_work', actionId: 'action', payload: {} },
    ] })
    f.store.acknowledgeAdmission('effect', 'job')
    const receipt = { id: 'job', type: 'environment_command' as const, handler: 'environment.command',
      state: 'leased' as const, username: 'test-user', input: { id: 'action', sessionId: 'body' },
      durable: { executionId: f.execution.executionId, effectId: 'effect', recovery: 'reconcile' as const },
      startedAt: new Date().toISOString(), bodyLease: { bodyId: 'body', executionId: f.execution.executionId, generation: 1 } }
    if (terminal === 'failed') f.store.settle(f.lease, 'failed')
    else f.store.cancel(f.execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
    assert.throws(() => f.store.acceptAction('effect'))
    assert.throws(() => f.store.assertDispatchable('effect'))
    const before = f.store.dispatch('effect').status
    for (const invalid of [
      { ...receipt, id: 'other-work' },
      { ...receipt, username: 'other-profile' },
      { ...receipt, durable: { ...receipt.durable, effectId: 'other-effect' } },
      { ...receipt, durable: { ...receipt.durable, executionId: 'other-execution' } },
      { ...receipt, input: { ...receipt.input, id: 'other-action' } },
      { ...receipt, bodyLease: { ...receipt.bodyLease, bodyId: 'other-body' } },
      { ...receipt, bodyLease: { ...receipt.bodyLease, executionId: 'other-execution' } },
      { ...receipt, bodyLease: { ...receipt.bodyLease, generation: 0 } },
      { ...receipt, startedAt: undefined },
      { ...receipt, bodyLease: undefined },
      { ...receipt, state: 'queued' as const },
    ]) {
      assert.throws(() => f.store.recordActionAcceptance('effect', invalid), /does not prove/)
      assert.throws(() => f.store.deliverActionResult(f.execution.executionId, 'action', {
        eventId: 'wrong', kind: 'physical_result', actionId: 'action', workItemId: 'job', payload: {},
      }, false, false, invalid), /does not prove/)
      assert.equal(f.store.dispatch('effect').status, before)
    }
    f.store.recordActionAcceptance('effect', receipt)
    f.store.deliverActionResult(f.execution.executionId, 'action', {
      eventId: 'uncertain', kind: 'physical_result', actionId: 'action', workItemId: 'job', payload: { status: 'outcome_unknown' },
    }, true, false, receipt)
    f.store.recordActionAcceptance('effect', receipt)
    assert.equal(f.store.dispatch('effect').status, 'outcome_unknown', 'A delayed acceptance cannot erase uncertainty')
    const result = { eventId: 'terminal', kind: 'physical_result', actionId: 'action', workItemId: 'job', payload: { status: 'completed' } }
    const once = f.store.deliverActionResult(f.execution.executionId, 'action', result, false, false, receipt)
    const twice = f.store.deliverActionResult(f.execution.executionId, 'action', result, false, false, receipt)
    assert.equal(once.sequence, twice.sequence)
    f.store.recordActionAcceptance('effect', receipt)
    assert.equal(f.store.dispatch('effect').status, 'completed', 'A delayed acceptance cannot revive completed work')
    assert.equal(f.store.get(f.execution.executionId).status, terminal)
    assert.equal(f.store.pendingDispatches().length, 0)
    assert.throws(() => f.store.deliverActionResult(f.execution.executionId, 'action', {
      ...result, payload: { status: 'different' },
    }, false, false, receipt), /different content/)
    f.store.release(f.lease)
    assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
    f.store.close()
  }
})

test('physical reconciliation compares the exact previous receipt and late delivery diagnostics cannot replace it', async () => {
  const f = fixture()
  await checkpoint(f, { transitionId: 'dispatch', dispatches: [
    { effectId: 'effect', kind: 'coordinator_work', actionId: 'action', payload: {} },
  ] })
  f.store.acknowledgeAdmission('effect', 'job')
  const receipt = { id: 'job', type: 'environment_command' as const, handler: 'environment.command',
    state: 'leased' as const, username: 'test-user', input: { id: 'action', sessionId: 'body' },
    durable: { executionId: f.execution.executionId, effectId: 'effect', recovery: 'reconcile' as const },
    startedAt: new Date().toISOString(), bodyLease: { bodyId: 'body', executionId: f.execution.executionId, generation: 1 } }
  const conclusion = { eventId: 'local-delivery', kind: 'physical_result', actionId: 'action', workItemId: 'job',
    payload: { status: 'failed' } }
  const original = f.store.deliverActionResult(f.execution.executionId, 'action', conclusion, false, false, receipt)
  f.store.settle(f.lease, 'failed')
  const other = new ExecutionStore(f.filename)
  try {
    const terminal = { eventId: 'adapter-terminal', kind: 'physical_result', actionId: 'action', workItemId: 'job',
      parentEventId: original.eventId, payload: { status: 'cancelled' } }
    assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', terminal, false, false, receipt), /not waiting/)
    for (const evidence of [{ reconcilesEventId: 'different-event' }, { deliveryOnly: true }, {}]) {
      assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', terminal, false, false, receipt, evidence))
    }
    assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', {
      ...terminal, parentEventId: 'different-event',
    }, false, false, receipt, { reconcilesEventId: original.eventId }), /does not match/)
    assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', terminal, false, false,
      { ...receipt, id: 'different-work' }, { reconcilesEventId: original.eventId }), /does not prove/)
    const committed = f.store.deliverActionResult(f.execution.executionId, 'action', terminal, false, false,
      receipt, { reconcilesEventId: original.eventId })
    assert.equal(other.deliverActionResult(f.execution.executionId, 'action', terminal, false, false,
      receipt, { reconcilesEventId: original.eventId }).sequence, committed.sequence)
    assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', {
      ...terminal, eventId: 'racing-terminal', payload: { status: 'completed' },
    }, false, false, receipt, { reconcilesEventId: original.eventId }), /does not match/)
    assert.throws(() => other.deliverActionResult(f.execution.executionId, 'action', {
      ...terminal, payload: { status: 'completed' },
    }, false, false, receipt, { reconcilesEventId: original.eventId }), /different content/)
    const diagnostic = { eventId: 'late-delivery', kind: 'delivery_result', actionId: 'action', workItemId: 'job',
      payload: { status: 'outcome_unknown' } }
    const delivery = other.deliverActionResult(f.execution.executionId, 'action', diagnostic, true, false,
      receipt, { deliveryOnly: true })
    assert.equal(other.deliverActionResult(f.execution.executionId, 'action', diagnostic, true, false,
      receipt, { deliveryOnly: true }).sequence, delivery.sequence)
    assert.deepEqual(other.event(f.execution.executionId, original.eventId), original)
    assert.deepEqual(other.event(f.execution.executionId, committed.eventId), committed)
    assert.equal(other.dispatch('effect').status, 'completed')
    assert.equal(other.get(f.execution.executionId).status, 'failed')
    assert.equal(other.pendingDispatches().length, 0)
    assert.throws(() => other.acceptAction('effect'))
  } finally { other.close(); f.store.release(f.lease); f.store.close() }
})

test('evidence is referenced once, rejected writes add no blobs, and retention protects active work', async () => {
  const f = fixture()
  const image = `data:image/jpeg;base64,${'A'.repeat(32_768)}`
  const State = Annotation.Root({ image: Annotation<string>(), executionTransition: Annotation<CheckpointTransition>() })
  const program = new StateGraph(State).addNode('step', state => state)
    .addEdge(START, 'step').addEdge('step', END).compile({ checkpointer: f.saver })
  await program.invoke({ image }, f.config)
  const stale = (await program.getState(f.config)).config
  await program.updateState(f.config, { image })
  const blobs = () => (f.store.db.prepare('SELECT count(*) AS n FROM execution_blobs').get() as any).n
  assert.equal(blobs(), 1)
  await assert.rejects(program.updateState(stale, { image: image + 'changed' }), /stale checkpoint/i)
  assert.equal(blobs(), 1, 'rejected checkpoint must not persist new evidence')
  assert.equal((await program.getState(f.config)).values.image, image)
  const literal = '\u0000mh-blob:literal-user-data'
  assert.deepEqual(f.store.decodeDocument(f.store.encodeDocument(f.execution.executionId, { literal })), { literal })
  await assert.rejects(f.saver.deleteThread(f.execution.executionId), /active execution/)
  await program.updateState(f.config, { executionTransition: { transitionId: 'done', status: 'completed' } })
  f.store.release(f.lease)
  const active = f.store.create('test-user', definition)
  assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
  assert.equal(f.store.get(active.executionId).status, 'running')
  assert.equal(blobs(), 0)
  f.store.close()
})

test('staging repeated evidence avoids duplicate encoding without caching later mutations', () => {
  const evidence = 'camera evidence '.repeat(1_000)
  let encodes = 0
  const store = new ExecutionStore(':memory:', {
    encode(value) { if (value === evidence) encodes++; return JSON.stringify(value) },
    decode: JSON.parse,
  })
  try {
    const execution = store.create('test-user', definition)
    const observation = { evidence, timestamp: '2026-01-01T00:00:00.000Z' }
    const value = { first: observation, second: observation, other: { evidence } }
    const first = store.encodeDocument(execution.executionId, value)
    assert.equal(encodes, 1, 'The same large evidence is encoded once per document')
    observation.timestamp = '2026-01-01T00:00:01.000Z'
    const next = store.encodeDocument(execution.executionId, value)
    assert.equal(store.decodeDocument(first).first.timestamp, '2026-01-01T00:00:00.000Z')
    assert.deepEqual(store.decodeDocument(next), value, 'A later checkpoint must see the changed observation')
    assert.equal(encodes, 2, 'Memoization must not survive a staging call')
  } finally { store.close() }
})

test('checkpoint field projection resolves references without expanding unrelated evidence', () => {
  const unrelated = 'unrelated retained camera bytes '.repeat(10_000)
  let unrelatedReads = 0
  const store = new ExecutionStore(':memory:', {
    encode: JSON.stringify,
    decode(value) { const result = JSON.parse(value); if (result === unrelated) unrelatedReads++; return result },
  })
  try {
    const execution = store.create('test-user', definition)
    const context = { activeTaskSessionId: 'selected-body', activeProgram: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] }, unrelated }
    const document = { json: { channel_values: { contextSnapshot: context, modelOutput: { unrelated } } } }
    const encoded = store.encodeDocument(execution.executionId, document)
    assert.equal(store.decodeDocument(encoded, ['json', 'channel_values', 'contextSnapshot', 'activeTaskSessionId']), 'selected-body')
    assert.deepEqual(store.decodeDocument(encoded, ['json', 'channel_values', 'contextSnapshot', 'activeProgram']), context.activeProgram)
    assert.equal(store.decodeDocument(encoded, ['json', 'channel_values', 'missing', 'nested']), undefined)
    assert.equal(unrelatedReads, 0, 'Reading status facts must not load unrelated model or camera blobs')
    assert.deepEqual(store.decodeDocument(encoded), document, 'The full original evidence remains available')
    assert.ok(unrelatedReads > 0)
  } finally { store.close() }
})

test('structured node outputs are shared across checkpoints without losing active execution evidence', async () => {
  const f = fixture()
  const output = { records: Array.from({ length: 24 }, (_, index) => ({ index, detail: 'verified detail '.repeat(30) })) }
  const value = { nodes: Array.from({ length: 20 }, (_, index) => ({ index, output })) }
  const other = f.store.create('test-user', definition)
  const encoded = f.store.encodeDocument(f.execution.executionId, value)
  const bytes = () => (f.store.db.prepare('SELECT sum(length(value)) AS bytes FROM execution_blobs').get() as any).bytes
  const storedOnce = bytes()
  const duplicate = f.store.encodeDocument(other.executionId, value)
  assert.equal(bytes(), storedOnce, 'Unchanged structured values are stored once, even across executions')
  assert.ok(encoded.length + storedOnce < JSON.stringify(value).length / 5, 'Checkpoint storage must not repeat every large node output')
  assert.deepEqual(f.store.decodeDocument(encoded), value)
  const decoded = f.store.decodeDocument(duplicate)
  decoded.nodes[0].output.records[0].detail = 'local mutation'
  assert.equal(decoded.nodes[1].output.records[0].detail, output.records[0].detail, 'Decoding retains ordinary independent JSON object values')
  f.store.settle(f.lease, 'completed')
  f.store.release(f.lease)
  assert.equal(await f.saver.pruneTerminal(Date.now() + 1), 1)
  assert.deepEqual(f.store.decodeDocument(duplicate), value, 'Retiring one execution cannot remove another execution\'s references')
  assert.equal(bytes(), storedOnce)
  f.store.close()
})
test('visual history retains correlated evidence across executions, restart, replay and terminal cleanup', async () => {
  const f = fixture()
  const sourceId = f.execution.executionId
  const frames = ['before', 'after'].map((id, index) => ({
    id, timestamp: `2026-01-01T00:00:0${index}.000Z`, dataUrl: `data:image/jpeg;base64,${'A'.repeat(5000)}`,
    metadata: { actionId: index ? 'action-after' : 'action-before' },
  }))
  const record: VisualObservationRecord = {
    observationId: `${sourceId}:save:visual-observation`, executionId: sourceId, occurrenceId: `${sourceId}:save`,
    environmentId: 'fixture-robot', adapter: 'fixture-adapter', interpretedAt: '2026-01-01T00:00:02.000Z',
    robotId: 'body-1', sessionId: 'source-session',
    summary: 'A small object is visible beside the chair. '.repeat(120).trim(), changes: 'The object is now closer to the center.',
    uncertainties: ['Its identity is uncertain.'], frameIds: frames.map(frame => frame.id),
    frames: frames.map(frame => ({ id: frame.id, timestamp: frame.timestamp, actionId: frame.metadata.actionId })),
  }
  const transition: CheckpointTransition = { transitionId: 'save-observation', frames, observations: [record] }
  let sourceConfig = await checkpoint(f, transition)
  sourceConfig = await checkpoint(f, transition, sourceConfig)
  const query = { environmentId: record.environmentId, adapter: record.adapter, robotId: record.robotId, sessionId: 'new-session', limit: 5 }
  assert.deepEqual(f.store.observationHistory(sourceId, query), [record], 'Replay does not duplicate the observation')
  assert.equal(f.store.task(sourceId), null, 'An observation does not require or create a task')
  assert.equal(f.store.dispatches(sourceId).length, 0, 'Saving evidence does not dispatch work or speech')
  assert.deepEqual(f.store.observationHistory(sourceId, { ...query, environmentId: 'other-robot' }), [])
  assert.deepEqual(f.store.observationHistory(sourceId, { ...query, robotId: 'other-body' }), [], 'Bodies in the same room remain separate')
  assert.deepEqual(f.store.observationHistory(sourceId, { ...query, robotId: null }), [], 'An unidentified body cannot claim another robot history')
  const anotherProfile = f.store.create('other-user', definition)
  assert.deepEqual(f.store.observationHistory(anotherProfile.executionId, query), [])
  assert.throws(() => f.store.observationFrames(anotherProfile.executionId, record), /profile/)
  await assert.rejects(checkpoint(f, { transitionId: 'changed-interpretation', observations: [{ ...record, summary: 'Invented replacement' }] }, sourceConfig), /identity reused/)
  await assert.rejects(checkpoint(f, { transitionId: 'wrong-image', observations: [{ ...record,
    observationId: `${sourceId}:other:visual-observation`, occurrenceId: `${sourceId}:other`, frameIds: ['unseen-image'] }] }, sourceConfig), /source image/)

  const reader = f.store.create('test-user', definition)
  const lease = f.store.claim(reader.executionId, definition)
  const saver = new ExecutionCheckpointer(f.store, lease)
  const readerFixture = { ...f, execution: reader, lease, saver, config: { configurable: { thread_id: reader.executionId }, durability: 'sync' as const } }
  const selected = f.store.readObservationHistory(reader.executionId, query)
  await checkpoint(f, { transitionId: 'finish-source', status: 'completed' }, sourceConfig)
  f.store.release(f.lease)
  await f.saver.deleteThread(sourceId)
  // Cleanup may race the interval between the reader's node output and checkpoint.
  const readerConfig = await checkpoint(readerFixture, { transitionId: 'load-history', status: 'waiting',
    frames: selected.frames, retainedObservations: selected.observations })
  assert.deepEqual(f.store.observationHistory(reader.executionId, query), [record])
  assert.deepEqual(f.store.observationFrames(reader.executionId, record), frames)
  assert.deepEqual(f.store.frame(reader.executionId, 'before'), frames[0])
  assert.deepEqual(f.store.frame(reader.executionId, 'after'), frames[1])
  await assert.rejects(saver.deleteThread(reader.executionId), /active execution/)
  f.store.release(lease)
  f.store.close()

  const reopened = new ExecutionStore(f.filename)
  const resumedLease = reopened.claim(reader.executionId, definition)
  const resumedSaver = new ExecutionCheckpointer(reopened, resumedLease)
  assert.deepEqual(reopened.observationHistory(reader.executionId, query), [record])
  assert.deepEqual(reopened.observationFrames(reader.executionId, record), frames)
  await checkpoint({ ...readerFixture, store: reopened, lease: resumedLease, saver: resumedSaver },
    { transitionId: 'finish-reader', status: 'completed' }, readerConfig)
  reopened.release(resumedLease)
  await resumedSaver.deleteThread(reader.executionId)
  assert.equal((reopened.db.prepare('SELECT COUNT(*) AS n FROM execution_observations').get() as { n: number }).n, 0)
  assert.equal((reopened.db.prepare('SELECT COUNT(*) AS n FROM execution_blobs').get() as { n: number }).n, 0)
  reopened.close()
  fs.rmSync(f.directory, { recursive: true, force: true })
})

for (const boundary of ['checkpoint', 'pending writes'] as const) {
  test(`${boundary} commit admits ready feedback before continuing graph work`, async () => {
    const f = fixture()
    try {
      const config = await checkpoint(f)
      let feedbackTurn: { inTransaction: boolean; committed: boolean } | undefined
      setImmediate(() => {
        feedbackTurn = { inTransaction: f.store.db.inTransaction, committed: boundary === 'checkpoint'
          ? f.store.dispatches(f.execution.executionId).some(item => item.effectId === 'owned-action')
          : !!f.store.db.prepare('SELECT 1 FROM writes WHERE task_id = ?').get('completed-node') }
      })
      if (boundary === 'checkpoint') {
        await checkpoint(f, { transitionId: 'owned-transition', dispatches: [
          { effectId: 'owned-action', kind: 'coordinator_work', payload: { handler: 'fixture' } },
        ] }, config)
      } else await f.saver.putWrites(config, [['result', { actionId: 'original', status: 'completed' }]], 'completed-node')
      assert.deepEqual(feedbackTurn, { inTransaction: false, committed: true },
        'Ready feedback must get an event-loop turn after atomic commit, before the next graph continuation')
    } finally {
      // Drain the test callback even on the pre-fix failing implementation.
      await new Promise(resolve => setImmediate(resolve))
      f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true })
    }
  })
}

test('admitted independent work can finish after its parent turn without reopening that turn', async () => {
  const f = fixture()
  try {
    await checkpoint(f, { transitionId: 'tool-handoff', dispatches: [{ effectId: 'tool-effect', kind: 'coordinator_work',
      payload: { executionScope: 'independent', type: 'big_brother_escalation', handler: 'environment.tools', input: {} } }] })
    f.store.settle(f.lease, 'completed')
    assert.equal(f.store.get(f.execution.executionId).status, 'waiting', 'Unadmitted work must remain recoverable')
    f.store.acknowledgeAdmission('tool-effect', 'tool-task')
    f.store.settle(f.lease, 'completed')
    assert.equal(f.store.get(f.execution.executionId).status, 'completed')
    assert.equal(f.store.acceptAction('tool-effect').status, 'accepted')
    f.store.deliverWorkResult('tool-effect', 'tool-task', { state: 'completed', result: { output: 'A sourced result.' } })
    assert.equal(f.store.get(f.execution.executionId).status, 'completed')
    assert.equal(f.store.pendingDispatches().filter(e => e.kind === 'graph_resume').length, 0)
    assert.equal(f.store.dispatch('tool-effect').status, 'completed')
  } finally { f.store.close() }
})

test('delivery settlement preserves unfinished root work, new inputs, and uncertain physical motion', async () => {
  for (const scenario of ['unfinished', 'new-input', 'physical-unknown', 'finished']) {
    const f = fixture()
    const effectId = 'delivery-effect'
    try {
      await f.saver.put(f.config, { v: 4, id: randomUUID(), ts: new Date().toISOString(),
        channel_values: { queue: scenario === 'unfinished' ? ['next'] : [],
          executionTransition: { transitionId: 'display', dispatches: [{ effectId, kind: 'coordinator_work', actionId: 'action',
            payload: { type: 'environment_command', input: { type: scenario === 'physical-unknown' ? 'move' : 'faceExpression' } } }] } },
        channel_versions: {}, versions_seen: {},
      }, { source: 'loop', step: 0, parents: {} })
      f.store.acknowledgeAdmission(effectId, 'receipt')
      f.store.acceptAction(effectId)
      f.store.settle(f.lease, 'completed')
      f.store.release(f.lease)
      if (scenario === 'new-input') f.store.deliverEvent(f.execution.executionId,
        { eventId: 'new-input', kind: 'user_steering', payload: { message: 'New request' } })
      if (scenario === 'physical-unknown') f.store.deliverActionResult(f.execution.executionId, 'action',
        { eventId: 'motion-unknown', kind: 'physical_result', actionId: 'action', payload: { status: 'outcome_unknown' } }, true)
      else f.store.deliverWorkResult(effectId, 'receipt', { state: 'failed', error: { code: 'outcome_unknown' } })
      f.store.settleEffectDelivery(f.execution.executionId)
      assert.equal(f.store.get(f.execution.executionId).status, scenario === 'finished' ? 'completed' : 'waiting', scenario)
      if (scenario === 'physical-unknown') assert.equal(f.store.dispatch(effectId).status, 'outcome_unknown')
      if (scenario === 'new-input') assert.equal(f.store.hasPendingInput(f.execution.executionId), true)
    } finally { f.store.close() }
  }
})


test('parent and finite child writers own separate heads within one execution', () => {
  const { store, execution, lease } = fixture()
  try {
    const child = store.claimGraph(execution.executionId, 'work:speech:graph:0', definition)
    const sibling = store.claimGraph(execution.executionId, 'work:speech:graph:1', definition)
    store.assertLease(lease)
    store.assertLease(child)
    store.assertLease(sibling)
    assert.throws(() => store.claim(execution.executionId, definition), /live writer/)
    assert.throws(() => store.claimGraph(execution.executionId, child.invocationId!, definition), /live writer/)
    store.renew(child)
    store.release(child)
    const replacement = store.claimGraph(execution.executionId, child.invocationId!, definition)
    assert.throws(() => store.assertLease(child), /Stale execution writer/)
    store.release(child)
    store.assertLease(replacement)
    store.assertLease(lease)
    store.assertLease(sibling)
    store.release(replacement)
    assert.throws(() => store.claimGraph(execution.executionId, child.invocationId!, { ...definition, graphHash: 'changed' }), /child graph/)
    store.release(lease)
    assert.equal(store.summaries('test-user')[0].liveWriter, true, 'Queue still sees the child writer')
    store.cancel(execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
    const saver = new ExecutionCheckpointer(store, sibling)
    assert.throws(() => saver.resetProfileHistory('test-user'), /active worker/)
    store.release(sibling)
    assert.equal(store.hasLiveWriter(execution.executionId), false)
    assert.throws(() => store.claimGraph(execution.executionId, 'work:speech:graph:2', definition), /cancelled/)
    assert.throws(() => store.db.transaction(() => store.commitTransition(execution.executionId, 'cancelled-chunk', {
      transitionId: 'cancelled-chunk', dispatches: [{ effectId: 'late-speech', kind: 'coordinator_work', payload: {} }],
    }))(), /terminal execution/)
  } finally { store.close() }
})

test('child writer ownership migrates existing graph records and recovers expired writers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-child-writer-'))
  const filename = path.join(directory, 'execution.sqlite')
  let store = new ExecutionStore(filename)
  try {
    const execution = store.create('test-user', definition)
    const lease = store.claim(execution.executionId, definition)
    store.pinGraph(lease, 'saved-child', definition)
    store.release(lease)
    store.db.exec('ALTER TABLE execution_graphs DROP COLUMN owner; ALTER TABLE execution_graphs DROP COLUMN owner_generation; ALTER TABLE execution_graphs DROP COLUMN lease_until')
    store.close()
    store = new ExecutionStore(filename)
    const expired = store.claimGraph(execution.executionId, 'saved-child', definition, randomUUID(), -1)
    const recovered = store.claimGraph(execution.executionId, 'saved-child', definition, randomUUID())
    assert.throws(() => store.assertLease(expired), /Stale execution writer/)
    store.release(expired)
    store.assertLease(recovered)
    assert.equal(store.get(execution.executionId).owner, null)
    assert.equal(store.get(execution.executionId).ownerGeneration, 1, 'Child recovery does not replace parent ownership')
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('child graph snapshots survive reopen and preserve legacy definition-only admissions', () => {
  const f = fixture()
  const graph = { name: 'saved-child', nodes: [], edges: [], format: 'svelte-flow', version: '1.0',
    scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 5 } } as const
  const edited = { ...graph, name: 'edited-child' }
  try {
    f.store.pinGraph(f.lease, 'saved', definition, graph as any)
    f.store.pinGraph(f.lease, 'legacy', definition)
    f.store.pinGraph(f.lease, 'legacy', definition, graph as any)
    assert.equal(f.store.graphSnapshot(f.execution.executionId, 'legacy'), null, 'No implicit legacy migration')
    f.store.release(f.lease)
    const child = f.store.claimGraph(f.execution.executionId, 'worker', definition, undefined, undefined, graph as any)
    f.store.release(child)
    f.store.close()
    const reopened = new ExecutionStore(f.filename)
    try {
      assert.deepEqual(reopened.graphSnapshot(f.execution.executionId, 'saved'), graph)
      assert.deepEqual(reopened.graphSnapshot(f.execution.executionId, 'worker'), graph)
      const retry = reopened.claimGraph(f.execution.executionId, 'worker', definition, undefined, undefined, edited as any)
      assert.deepEqual(reopened.graphSnapshot(f.execution.executionId, 'worker'), graph, 'Retry cannot replace the admitted graph')
      reopened.release(retry)
      assert.throws(() => reopened.claimGraph(f.execution.executionId, 'legacy', { ...definition, graphHash: 'changed' }), /does not match/)
      assert.equal(reopened.graphSnapshot(f.execution.executionId, 'legacy'), null)
    } finally { reopened.close() }
  } finally { if (f.store.db.open) f.store.close(); fs.rmSync(f.directory, { recursive: true, force: true }) }
})

test('latest execution readers decode only consumed records and lookup preserves missing identity', () => {
  const store = new ExecutionStore(':memory:')
  try {
    const older = store.create('fixture', definition)
    const latest = store.create('fixture', definition)
    store.db.prepare('UPDATE executions SET created_at=1 WHERE execution_id=?').run(older.executionId)
    store.db.prepare('UPDATE executions SET created_at=2 WHERE execution_id=?').run(latest.executionId)
    const decode = store.codec.decode.bind(store.codec)
    let decoded = 0
    store.codec.decode = (value: string) => { decoded++; return decode(value) }
    for (const record of store.iterate('fixture', true)) { assert.equal(record.executionId, latest.executionId); break }
    assert.equal(decoded, 1)
    assert.equal(store.find('not-retained'), null)
    assert.throws(() => store.get('not-retained'), /Unknown execution not-retained/)
    assert.deepEqual(store.list('fixture').map(record => record.executionId), [older.executionId, latest.executionId])
  } finally { store.close() }
})
