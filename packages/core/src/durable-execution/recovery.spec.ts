import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ExecutionDefinition } from './types.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-execution-recovery-'))
assert.equal(fs.realpathSync(root), root)
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the recovery fixture') }
const { ROOT, systemPaths } = await import('../path-builder.js')
assert.equal(ROOT, root)
assert.ok(systemPaths.usersDb.startsWith(root + path.sep))
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const { openExecutionStore } = await import('./storage.js')
const { ExecutionCheckpointer } = await import('./checkpointer.js')
const { recoverDurableExecutions } = await import('./recovery.js')
const { UnifiedQueueManager } = await import('../queue/unified-queue-manager.js')
const { ExecutionEngine } = await import('../queue/execution-engine.js')
const { WorkOutcomeUnknownError } = await import('../queue/types.js')
const { executionWorkInput } = await import('./coordinator-outbox.js')

const definition: ExecutionDefinition = {
  graphId: 'recovery-fixture', graphHash: 'v1', runtimeVersion: 'v1', checkpointSchemaVersion: 1,
  nodeVersions: { fixture: 'v1' },
}

async function fixture(username: string, handler?: string, physical = false) {
  const store = openExecutionStore(username)
  assert.ok(String(store.db.name).startsWith(root + path.sep))
  const record = store.create(username, definition)
  const lease = store.claim(record.executionId, definition)
  const effectId = randomUUID()
  try {
    const saver = new ExecutionCheckpointer(store, lease)
    await saver.put({ configurable: { thread_id: record.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(),
      channel_values: { executionTransition: { transitionId: randomUUID(), ...(handler ? {
        dispatches: [{ effectId, kind: 'coordinator_work',
          ...(physical ? { actionId: `${effectId}:action` } : {}),
          payload: physical ? {
            type: 'environment_command', handler: 'environment.command', resource: `body:${effectId}`,
            source: 'environment', username, input: { id: `${effectId}:action`, sessionId: effectId, type: 'robotCommand', command: 'walk' },
          } : { type: 'generic', handler, resource: 'local-llm', source: 'system', username, input: {} },
        }],
      } : {}) } }, channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 0, parents: {} })
    if (!handler) store.settle(lease, 'completed')
    return { username, executionId: record.executionId, effectId }
  } finally { store.release(lease); store.close() }
}

test('one execution failure leaves sibling recovery, other profiles and terminal retention independent', async () => {
  fs.mkdirSync(path.dirname(systemPaths.usersDb), { recursive: true })
  fs.writeFileSync(systemPaths.usersDb, JSON.stringify({ version: 1,
    users: [{ id: 'fixture-one', username: 'profile-one' }, { id: 'fixture-two', username: 'profile-two' }] }))
  const failed = await fixture('profile-one', 'fixture.reject')
  const sibling = await fixture('profile-one', 'fixture.sibling')
  const otherProfile = await fixture('profile-two', 'fixture.other')
  const terminal = await fixture('profile-one')
  const manager = new UnifiedQueueManager()
  const enqueue = manager.enqueue.bind(manager)
  const attempted: string[] = []
  manager.enqueue = input => {
    attempted.push(input.handler!)
    if (input.handler === 'fixture.reject') throw new Error('Injected one-execution admission failure')
    return enqueue(input)
  }
  const originalNow = Date.now
  const afterRetention = Date.now() + 31 * 86_400_000
  Date.now = () => afterRetention
  try {
    await assert.rejects(recoverDurableExecutions(manager, 30), error => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /Injected one-execution admission failure/)
      assert.match(error.message, new RegExp(failed.executionId))
      return true
    })
  } finally { Date.now = originalNow }
  assert.ok(attempted.includes('fixture.sibling'))
  assert.ok(attempted.includes('fixture.other'))
  for (const expected of [failed, sibling, otherProfile]) {
    const store = openExecutionStore(expected.username)
    try {
      assert.equal(store.dispatch(expected.effectId).status, expected === failed ? 'pending' : 'admitted')
      assert.equal(store.get(expected.executionId).status, 'running')
      if (expected === failed) {
        assert.throws(() => store.get(terminal.executionId), /Unknown execution/)
        assert.deepEqual(store.retirements(), [])
      }
    } finally { store.close() }
  }
  manager.enqueue = enqueue
  await recoverDurableExecutions(manager, 30)
  const store = openExecutionStore(failed.username)
  try { assert.equal(store.dispatch(failed.effectId).status, 'admitted') }
  finally { store.close() }
})

test('reported finite-handler failure returns to its parent while lost-worker outcomes remain waiting', async () => {
  const manager = new UnifiedQueueManager()
  const errors: string[] = []
  const engine = new ExecutionEngine({ onError: error => errors.push(error.message) }, manager)
  engine.unregisterHandler('graph.resume') // This fixture exercises the worker/result boundary, not a parent model call.
  engine.registerHandler('agent.daydreamer', async () => { throw new Error('Known handler failure') })
  engine.registerHandler('agent.reflector', async () => { throw new WorkOutcomeUnknownError('Worker exited without a result') })
  const cases = []
  for (const [handler, expected] of [['agent.daydreamer', 'failed'], ['agent.reflector', 'waiting']] as const) {
    const parent = await fixture('failure-profile', handler)
    const store = openExecutionStore(parent.username)
    try {
      const lease = store.claim(parent.executionId, definition)
      store.settle(lease, 'waiting', 'agent_result')
      store.release(lease)
      const task = manager.enqueue(executionWorkInput(store, store.dispatch(parent.effectId)))
      assert.equal(task.durable?.recovery, 'reconcile')
      store.acknowledgeAdmission(parent.effectId, task.id)
      cases.push({ ...parent, taskId: task.id, expected })
    } finally { store.close() }
  }
  engine.start()
  try {
    const deadline = Date.now() + 5_000
    while (!cases.every(entry => manager.getTask(entry.taskId)?.state === entry.expected) || errors.length < 2) {
      assert.ok(Date.now() < deadline, 'Finite handlers must settle or explicitly park')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } finally { await engine.stop() }

  for (const entry of cases) {
    const task = manager.getTask(entry.taskId)!
    const store = openExecutionStore(entry.username)
    try {
      const results = store.events(entry.executionId).filter(event => event.kind === 'work_result')
      assert.equal(task.error?.code, entry.expected === 'failed' ? 'handler_failed' : 'outcome_unknown')
      assert.equal(task.error?.retryable, false)
      assert.equal(results.length, entry.expected === 'failed' ? 1 : 0)
      if (entry.expected === 'failed') {
        assert.equal((results[0].payload as { result: { state: string } }).result.state, 'failed')
        assert.ok(manager.getAllTasks().some(work => work.handler === 'graph.resume'
          && work.durable?.executionId === entry.executionId), 'The known result must admit its parent continuation')
      }
    } finally { store.close() }
  }

  const interrupted = manager.enqueue({ type: 'generic', handler: 'agent.daydreamer', resource: 'local-llm',
    username: 'failure-profile', input: {}, durable: { executionId: 'interrupted-parent', effectId: 'interrupted-effect', recovery: 'reconcile' } })
  manager.claim(interrupted.id)
  const restarted = new UnifiedQueueManager()
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.equal(restarted.getTask(interrupted.id)?.state, 'waiting')
  assert.equal(restarted.getTask(interrupted.id)?.error?.code, 'outcome_unknown')
  assert.equal(restarted.getNextExecutable(work => work.id === interrupted.id), null)
})

test('terminal recovery cancels only never-started admissions and retains claimed or uncertain work', async () => {
  const manager = new UnifiedQueueManager({ historyLimit: 1 })
  manager.configure({ enabled: true, lanes: {
    'local-llm': { maxConcurrent: 8 },
    'vector-index': { maxConcurrent: 1 },
    'remote-llm': { maxConcurrent: 1 },
  } })
  const cases = []
  for (const physical of [false, true]) {
    for (const phase of ['absent', 'enqueue-before-ack', 'admitted', 'claimed-before-accept', 'accepted', 'unknown']) {
      const parent = await fixture('terminal-recovery', 'agent.daydreamer', physical)
      const store = openExecutionStore(parent.username)
      try {
        const lease = store.claim(parent.executionId, definition)
        const input = executionWorkInput(store, store.dispatch(parent.effectId))
        const task = phase === 'absent' ? undefined : manager.enqueue(input)
        if (task && phase !== 'enqueue-before-ack') store.acknowledgeAdmission(parent.effectId, task.id)
        if (task && ['claimed-before-accept', 'accepted', 'unknown'].includes(phase)) {
          assert.ok(manager.claim(task.id))
          if (phase !== 'claimed-before-accept') store.acceptAction(parent.effectId)
          if (phase === 'unknown') {
            manager.requeue(task, { code: 'outcome_unknown', message: 'Worker lost after acceptance', retryable: false })
            if (physical) store.recordResult(parent.executionId, `${parent.effectId}:action`, {
              eventId: `${parent.effectId}:unknown`, kind: 'physical_result', actionId: `${parent.effectId}:action`,
              payload: { outcome: 'unknown' },
            }, true)
          }
        }
        store.settle(lease, 'failed')
        store.release(lease)
        cases.push({ ...parent, input, physical, phase, taskId: task?.id,
          initialEffectStatus: store.dispatch(parent.effectId).status,
          initialWorkState: task?.state,
          protected: ['claimed-before-accept', 'accepted', 'unknown'].includes(phase) })
      } finally { store.close() }
    }
  }
  await recoverDurableExecutions(manager, 30)
  const restarted = new UnifiedQueueManager({ historyLimit: 1 })
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  for (const entry of cases) {
    const store = openExecutionStore(entry.username)
    try {
      const effect = store.dispatch(entry.effectId)
      const receipt = manager.findTask(task => task.durable?.effectId === entry.effectId)!
      assert.ok(receipt)
      assert.equal(effect.workItemId, receipt.id)
      if (entry.taskId) assert.equal(receipt.id, entry.taskId, 'Enqueue-before-ack attaches the original admission')
      if (entry.protected) {
        assert.equal(receipt.state, entry.initialWorkState)
        assert.equal(effect.status, entry.initialEffectStatus)
        assert.equal(receipt.cancellationRequestedAt, undefined, 'Terminal graph failure is not permission to send physical stop')
        assert.equal(store.events(entry.executionId).filter(event => event.kind === 'dispatch_cancelled').length, 0)
        assert.throws(() => store.confirmUndispatched(entry.effectId, { ...receipt, state: 'cancelled' }), /not eligible|does not prove/)
      } else {
        assert.equal(receipt.state, 'cancelled')
        assert.equal(effect.status, 'cancelled')
        assert.equal(manager.enqueue(entry.input).id, receipt.id, 'A late relay returns the same cancelled receipt')
        assert.equal(restarted.enqueue(entry.input).id, receipt.id, 'Non-dispatch survives restart and history eviction')
        assert.equal(restarted.getTask(receipt.id)?.state, 'cancelled')
        assert.equal(store.events(entry.executionId).filter(event => event.kind === 'dispatch_cancelled').length, 1)
        assert.equal(store.events(entry.executionId).some(event => event.kind === 'physical_result'), false)
      }
    } finally { store.close() }
  }

  const originalNow = Date.now
  const afterRetention = Date.now() + 31 * 86_400_000
  Date.now = () => afterRetention
  try { await recoverDurableExecutions(manager, 30) }
  finally { Date.now = originalNow }
  const store = openExecutionStore('terminal-recovery')
  try {
    for (const entry of cases) {
      if (entry.protected) assert.equal(store.get(entry.executionId).status, 'failed')
      else assert.throws(() => store.get(entry.executionId), /Unknown execution/)
    }
  } finally { store.close() }
})

test('cancelled admission commits before publication and rejects conflicting late delivery', () => {
  const manager = new UnifiedQueueManager()
  const input = { type: 'generic' as const, handler: 'agent.daydreamer', username: 'cancelled-admission', input: {},
    durable: { executionId: 'terminal-parent', effectId: 'never-started', recovery: 'reconcile' as const } }
  const events: string[] = []
  manager.addEventListener(event => events.push(event.type))
  manager.setOnQueueChange(() => { throw new Error('Injected cancellation commit failure') })
  assert.throws(() => manager.cancelAdmission(input, 'Parent failed'), /Injected cancellation commit failure/)
  assert.deepEqual(events, [])
  assert.equal(manager.getAllTasks().length, 0)
  assert.equal(manager.getHistory().length, 0)
  let commits = 0
  manager.setOnQueueChange(() => { commits++ })
  const receipt = manager.cancelAdmission(input, 'Parent failed')
  assert.equal(commits, 1)
  assert.deepEqual(events, ['task_cancelled'])
  assert.equal(manager.enqueue(input).id, receipt.id)
  assert.equal(manager.getNextExecutable(), null)
  assert.throws(() => manager.enqueue({ ...input, input: { different: true } }), /conflict/)
  assert.equal(commits, 1)
  const emptyReason = manager.cancelAdmission({ ...input,
    durable: { ...input.durable, effectId: 'empty-reason' },
  }, '')
  assert.equal(emptyReason.state, 'cancelled', 'Reason text is metadata, not the cancellation decision')
  const omittedReason = manager.cancelAdmission({ ...input,
    durable: { ...input.durable, effectId: 'omitted-reason' },
  })
  assert.equal(omittedReason.state, 'cancelled')
  assert.equal(omittedReason.cancellationReason, 'Cancelled')
  assert.equal(manager.getNextExecutable(), null)
})
