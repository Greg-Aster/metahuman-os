import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test, { mock } from 'node:test'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-continuity-'))
process.env.METAHUMAN_ROOT = root
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { ExecutionStore } = await import('../../durable-execution/store.js')
const { ExecutionCheckpointer } = await import('../../durable-execution/checkpointer.js')
const filename = path.join(root, 'execution.sqlite')
const store = new ExecutionStore(filename)
const definition = { graphId: 'controller', graphHash: 'fixture', runtimeVersion: 'fixture', checkpointSchemaVersion: 1, nodeVersions: {} }
const record = store.enter('fixture', definition, 'controller-admission', {
  graph: { name: 'Robot Autonomy Controller' },
  context: { username: 'fixture', robotOperatorContext: { robotObserver: {
    cycleId: 'fixture-cycle', step: 1, triggerSource: 'autonomy',
    graph: 'robot-autonomy-controller', requestedBy: 'robot-autonomy-controller',
  } } },
})
const lease = store.claim(record.executionId, definition)
const decision = { taskId: 'none', reason: 'The selected activity already finished.', responseAuthored: false }
const saver = new ExecutionCheckpointer(store, lease)
await saver.put({ configurable: { thread_id: record.executionId } }, {
  v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
  channel_values: { nodeEntries: [['editable-parser-name', { status: 'completed',
    definition: { type: 'robot_autonomy_controller_parser' }, outputs: { decisionReceipt: decision } }]] },
}, { source: 'loop', step: 0, parents: {} })
store.settle(lease, 'completed')
store.release(lease)
store.close()
const queue = await import('../../queue/unified-queue-manager.js')
mock.method(queue.getQueueManager(), 'getHistory', () => [{ id: 'admission', username: 'fixture', source: 'autonomy',
    handler: 'workflow.robot-autonomy-controller', state: 'completed', createdAt: new Date().toISOString(),
    input: {}, graphExecutions: [record.executionId], result: { executionStatus: 'waiting', executionId: record.executionId } }])
const storage = await import('../../durable-execution/storage.js')
mock.module('../../durable-execution/storage.js', { namedExports: { ...storage,
  openExecutionStore: () => new ExecutionStore(filename) } })
const { robotAutonomyActivityHistoryNode, projectAutonomyActivityOutcomes } = await import('./autonomy-activity-history.node.js')

test('next autonomous cycle receives the saved decision after admission yielded', async () => {
  const result = await robotAutonomyActivityHistoryNode.execute({}, { username: 'fixture' }, { limit: 10 })
  assert.equal(result.count, 1)
  assert.equal(result.history[0].capabilityId, 'none')
  assert.deepEqual(result.history[0].result.decision, decision)
  assert.equal(result.history[0].result.executions[0].status, 'completed')
  assert.equal(result.history[0].result.executions[0].objective, null)
})

test('controller decisions survive eviction from the global work receipt window', async () => {
  const manager = new queue.UnifiedQueueManager({ historyLimit: 200 })
  const admission = manager.enqueue({ type: 'generic', username: 'fixture', source: 'autonomy',
    handler: 'workflow.robot-autonomy-controller', input: {} })
  assert.ok(manager.claim(admission.id))
  manager.attachExecution(admission.id, record.executionId)
  manager.complete(admission.id, true, { executionId: record.executionId })
  for (let index = 0; index < 201; index++) {
    const unrelated = manager.enqueue({ type: 'generic', username: 'fixture', source: 'system',
      handler: 'unrelated.completed-work', input: { index } })
    assert.ok(manager.claim(unrelated.id))
    manager.complete(unrelated.id, true, {})
  }
  assert.equal(manager.getHistory().length, 200)
  assert.equal(manager.getHistory().some(item => item.id === admission.id), false)
  const retained = new ExecutionStore(filename)
  assert.equal(retained.get(record.executionId).status, 'completed')
  retained.close()
  const history = mock.method(queue.getQueueManager(), 'getHistory', () => manager.getHistory())
  try {
    const result = await robotAutonomyActivityHistoryNode.execute({}, { username: 'fixture' }, { limit: 10 })
    const activity = result.history.find((item: any) => item.executionIds?.includes(record.executionId))
    assert.ok(activity, 'Durably saved controller decision must remain available after unrelated work evicts its admission receipt')
    assert.deepEqual(activity.result.decision, decision)
  } finally { history.mock.restore() }
})

test('a selected child receipt does not replace its parent controller decision', async () => {
  const child = { id: 'child-work', username: 'fixture', source: 'autonomy',
    handler: 'agent.reflector', state: 'completed', createdAt: new Date().toISOString(),
    input: { triggeredBy: 'robot-autonomy-controller' },
    durable: { executionId: record.executionId, effectId: 'child-effect' }, result: {} }
  const history = mock.method(queue.getQueueManager(), 'getHistory', () => [child] as never)
  try {
    const result = await robotAutonomyActivityHistoryNode.execute({}, { username: 'fixture' }, { limit: 10 })
    assert.equal(result.count, 2)
    assert.ok(result.history.some((item: any) => item.taskId === 'child-work'))
    const controller = result.history.find((item: any) => item.handler === 'workflow.robot-autonomy-controller')
    assert.deepEqual(controller.result.decision, decision)
  } finally { history.mock.restore() }
})

test('durable recovery excludes other profiles, user turns and diagnostic copies', async () => {
  const fixtureStore = new ExecutionStore(filename)
  const observer = { cycleId: 'other-cycle', step: 1, triggerSource: 'autonomy',
    graph: 'robot-autonomy-controller', requestedBy: 'robot-autonomy-controller' }
  for (const [username, trigger] of [
    ['other-profile', observer],
    ['fixture', { ...observer, triggerSource: 'user' }],
    ['fixture', undefined],
    ['fixture', { ...observer, requestedBy: 'boredom-observer' }],
  ] as const) {
    const excluded = fixtureStore.enter(username, definition, randomUUID(), {
      graph: { name: 'Diagnostic controller copy' },
      context: { username, robotOperatorContext: trigger ? { robotObserver: trigger } : {} },
    })
    const owned = fixtureStore.claim(excluded.executionId, definition)
    const checkpoint = new ExecutionCheckpointer(fixtureStore, owned)
    await checkpoint.put({ configurable: { thread_id: excluded.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
      channel_values: { nodeEntries: [['parser', { status: 'completed',
        definition: { type: 'robot_autonomy_controller_parser' },
        outputs: { decisionReceipt: { taskId: 'none', reason: 'Excluded provenance' } } }]] },
    }, { source: 'loop', step: 0, parents: {} })
    fixtureStore.settle(owned, 'completed')
    fixtureStore.release(owned)
  }
  fixtureStore.close()
  const history = mock.method(queue.getQueueManager(), 'getHistory', () => [])
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await robotAutonomyActivityHistoryNode.execute({}, { username: 'fixture' }, { limit: 1 })
      assert.equal(result.count, 1, 'Domain selection precedes the existing history limit')
      assert.deepEqual(result.history[0].executionIds, [record.executionId])
      assert.equal(result.history[0].taskId, undefined, 'No queue task identity may be invented')
      assert.deepEqual(result.history[0].result.decision, decision)
    }
  } finally { history.mock.restore() }
})

test('selection matches full retained history without decoding older unselected checkpoints', async () => {
  const fixtureStore = new ExecutionStore(filename)
  const expected: any[] = []
  for (let index = 0; index < 28; index++) {
    const eligible = index < 25
    const observer = eligible ? { cycleId: `retained-${index}`, step: 1, triggerSource: 'autonomy',
      graph: 'robot-autonomy-controller', requestedBy: 'robot-autonomy-controller' } : undefined
    const created = fixtureStore.enter('fixture', definition, `selection-${index}`, {
      graph: { name: 'Controller' }, context: { robotOperatorContext: { robotObserver: observer } },
    })
    const owned = fixtureStore.claim(created.executionId, definition)
    const chosen = { taskId: 'none', reason: `Decision ${index}: ` + 'complete evidence '.repeat(80) + 'retained suffix', responseAuthored: false }
    await new ExecutionCheckpointer(fixtureStore, owned).put({ configurable: { thread_id: created.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
      channel_values: { nodeEntries: [['parser', { status: 'completed',
        definition: { type: 'robot_autonomy_controller_parser' }, outputs: { decisionReceipt: chosen } }]] },
    }, { source: 'loop', step: 0, parents: {} })
    fixtureStore.settle(owned, 'completed')
    fixtureStore.release(owned)
    const completed = fixtureStore.get(created.executionId)
    if (eligible) expected.push({ executionIds: [completed.executionId], capabilityId: 'none',
      handler: 'workflow.robot-autonomy-controller', state: 'completed',
      createdAt: new Date(completed.createdAt).toISOString(), completedAt: new Date(completed.updatedAt).toISOString(),
      result: { decision: chosen } })
  }
  const reference = projectAutonomyActivityOutcomes(expected
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt)).slice(-10), fixtureStore)
  fixtureStore.close()
  let entries = 0
  let checkpoints = 0
  const readEntry = ExecutionStore.prototype.entry
  const readCheckpoint = ExecutionCheckpointer.prototype.getTuple
  const entryMock = mock.method(ExecutionStore.prototype, 'entry', function (this: InstanceType<typeof ExecutionStore>, ...args: Parameters<typeof readEntry>) {
    entries++
    return readEntry.apply(this, args)
  })
  const checkpointMock = mock.method(ExecutionCheckpointer.prototype, 'getTuple', function (this: InstanceType<typeof ExecutionCheckpointer>, ...args: Parameters<typeof readCheckpoint>) {
    checkpoints++
    return readCheckpoint.apply(this, args)
  })
  const history = mock.method(queue.getQueueManager(), 'getHistory', () => [])
  try {
    const result = await robotAutonomyActivityHistoryNode.execute({}, { username: 'fixture' }, { limit: 10 })
    assert.deepEqual(result.history, reference, 'Optimization must retain exact ordering, identity, full decisions and outcome projection')
    assert.equal(checkpoints, 10, 'Only returned eligible checkpoints need full decoding')
    assert.equal(entries, 13, 'Newer excluded executions are checked without consuming history slots')
  } finally { history.mock.restore(); entryMock.mock.restore(); checkpointMock.mock.restore() }
})

test.after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })
