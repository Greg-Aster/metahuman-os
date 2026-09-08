import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph'
import { ExecutionStore } from './store.js'
import { ExecutionCheckpointer, type CheckpointConfig } from './checkpointer.js'
import { type CheckpointTransition, type ExecutionDefinition } from './types.js'

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
    const observation = f.store.deliverEvent(f.execution.executionId, { eventId: 'observation', kind: 'observation_received', payload: {} })
    const runner = `${f.execution.executionId}:resume:${result.eventId}`
    const queued = `${f.execution.executionId}:resume:${observation.eventId}`
    f.store.acknowledgeAdmission(runner, 'runner')
    f.store.acknowledgeAdmission(queued, 'queued')
    f.store.acceptAction(runner)
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
