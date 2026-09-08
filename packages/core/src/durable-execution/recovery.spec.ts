import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { once } from 'node:events'
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
const { deliverDurableWorkReceipt } = await import('./work-results.js')
const { activeRobotExecutions } = await import('../robot-operator.js')
const { handleHttpRequest } = await import('../api/adapters/http.js')
const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../sessions.js')
beginAuthenticatedRuntime()

function authenticate(username: string): void {
  fs.mkdirSync(path.dirname(systemPaths.usersDb), { recursive: true })
  const database = fs.existsSync(systemPaths.usersDb)
    ? JSON.parse(fs.readFileSync(systemPaths.usersDb, 'utf8')) : { version: 1, users: [] }
  let user = database.users.find((candidate: any) => candidate.username === username)
  if (!user) {
    user = { id: randomUUID(), username, role: 'owner' }
    database.users.push(user)
    fs.writeFileSync(systemPaths.usersDb, JSON.stringify(database))
  }
  selectAuthenticatedSession(createSession(user.id, 'owner').id)
}

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

test('Full Auto sees a pending resume once and stops waiting on a terminally failed execution', async () => {
  const username = 'autonomy-resume-state'
  const store = openExecutionStore(username)
  const manager = new UnifiedQueueManager()
  try {
    const record = store.enter(username, definition, randomUUID(), { context: { cognitiveMode: 'environment' } })
    const lease = store.claim(record.executionId, definition)
    store.settle(lease, 'waiting', 'user_or_autonomy')
    store.release(lease)
    assert.equal(activeRobotExecutions(username)[0].resumePending, false)
    const event = store.deliverEvent(record.executionId, { eventId: 'wake', kind: 'autonomy_trigger', payload: {} })
    const effectId = `${record.executionId}:resume:${event.eventId}`
    assert.equal(activeRobotExecutions(username)[0].resumePending, true)
    const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
    store.acknowledgeAdmission(effectId, task.id)
    assert.ok(manager.claim(task.id))
    store.acceptAction(effectId)
    assert.equal(activeRobotExecutions(username)[0].resumePending, true)
    manager.complete(task.id, false, { code: 'execution_conflict', message: 'Saved definition changed', retryable: false })
    await deliverDurableWorkReceipt(manager.getTask(task.id)!, async input => manager.enqueue(input))
    assert.equal(store.get(record.executionId).status, 'failed')
    assert.deepEqual(activeRobotExecutions(username), [], 'The existing Full Auto entrypoint can now admit its next controller')
  } finally { store.close() }
})

test('recovery retires satisfied queued resumes without claiming model capacity or losing unconsumed evidence', async () => {
  const username = 'satisfied-resume'
  authenticate(username)
  const store = openExecutionStore(username)
  const manager = new UnifiedQueueManager({ lanes: {
    'local-llm': { maxConcurrent: 1, cooldownMs: 2000 },
    'vector-index': { maxConcurrent: 1, cooldownMs: 0 },
    'remote-llm': { maxConcurrent: 5, cooldownMs: 0 },
  } })
  try {
    const record = store.create(username, definition)
    const lease = store.claim(record.executionId, definition)
    const first = store.deliverEvent(record.executionId, { eventId: 'result', kind: 'physical_result', payload: {} })
    const second = store.deliverEvent(record.executionId, { eventId: 'observation', kind: 'observation_received', payload: {} })
    const wakes = store.pendingDispatches().map(effect => {
      const task = manager.enqueue(executionWorkInput(store, effect))
      store.acknowledgeAdmission(effect.effectId, task.id)
      return task
    })
    await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: record.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
      channel_values: { executionTransition: { transitionId: 'first-consumed', processedEventIds: [first.eventId] } },
    }, { source: 'loop', step: 0, parents: {} })
    store.settle(lease, 'waiting', 'observation')
    store.release(lease)
    await recoverDurableExecutions(manager, 30)
    const satisfied = manager.getTask(wakes[0].id)!
    assert.equal(satisfied.state, 'cancelled')
    assert.match(satisfied.cancellationReason ?? '', /already.*processed/i)
    assert.equal(satisfied.startedAt, undefined, 'A satisfied wake never acquired the model lane')
    assert.equal(manager.getTask(wakes[1].id)?.state, 'queued', 'Unconsumed evidence retains its continuation')
    assert.equal(manager.getNextExecutable()?.id, wakes[1].id, 'Retirement must not charge a model cooldown')
    assert.equal(store.get(record.executionId).lastProcessedSequence, first.sequence)
    assert.equal(store.event(record.executionId, second.eventId).sequence, second.sequence)
    await recoverDurableExecutions(manager, 30)
    assert.equal(manager.getTask(wakes[1].id)?.state, 'queued', 'Duplicate recovery preserves the outstanding wake')
    assert.equal(store.get(record.executionId).status, 'waiting')
  } finally { store.close() }
})

test('one execution failure leaves sibling recovery, other profiles and terminal retention independent', async () => {
  fs.mkdirSync(path.dirname(systemPaths.usersDb), { recursive: true })
  fs.writeFileSync(systemPaths.usersDb, JSON.stringify({ version: 1,
    users: [{ id: 'fixture-one', username: 'profile-one', role: 'owner' },
      { id: 'fixture-two', username: 'profile-two', role: 'owner' }] }))
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
  const terminalStore = openExecutionStore(terminal.username)
  terminalStore.db.prepare('UPDATE executions SET updated_at=? WHERE execution_id=?')
    .run(Date.now() - 31 * 86_400_000, terminal.executionId)
  terminalStore.close()
  authenticate('profile-one')
  await assert.rejects(recoverDurableExecutions(manager, 30), error => {
    assert.ok(error instanceof AggregateError)
    assert.match(error.message, /Injected one-execution admission failure/)
    assert.match(error.message, new RegExp(failed.executionId))
    return true
  })
  assert.ok(attempted.includes('fixture.sibling'))
  assert.ok(!attempted.includes('fixture.other'), 'An unrelated profile is not inspected by this recovery')
  authenticate('profile-two')
  await recoverDurableExecutions(manager, 30)
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
  authenticate('profile-one')
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

test('failed resume receipts settle the saved execution without replay', async () => {
  const username = 'resume-failure'
  authenticate(username)
  const manager = new UnifiedQueueManager()
  const entry = await fixture(username, 'fixture.command')
  const store = openExecutionStore(username)
  try {
    const lease = store.claim(entry.executionId, definition)
    store.settle(lease, 'waiting', 'user_or_autonomy')
    store.release(lease)
    const event = store.deliverEvent(entry.executionId, { eventId: 'wake', kind: 'autonomy_trigger', payload: {} })
    const effect = store.dispatch(`${entry.executionId}:resume:${event.eventId}`)
    const task = manager.enqueue(executionWorkInput(store, effect))
    store.acknowledgeAdmission(effect.effectId, task.id)
    manager.claim(task.id)
    manager.complete(task.id, false, { code: 'execution_conflict', message: 'Executable versions changed', retryable: false })
    await deliverDurableWorkReceipt(manager.getTask(task.id)!, async input => manager.enqueue(input), store)
    assert.equal(store.get(entry.executionId).status, 'failed', 'A failed wake cannot remain runnable in Full Auto')
    assert.equal(store.event(entry.executionId, `work:${task.id}:terminal`).kind, 'resume_result')
    const once = store.events(entry.executionId)
    await deliverDurableWorkReceipt(manager.getTask(task.id)!, async input => manager.enqueue(input), store)
    assert.deepEqual(store.events(entry.executionId), once)
    store.deliverEvent(entry.executionId, { eventId: 'wake', kind: 'autonomy_trigger', payload: {} })
    assert.equal(store.pendingDispatches().filter(item => item.kind === 'graph_resume').length, 0)
  } finally { store.close() }
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
  authenticate('terminal-recovery')
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

  const idleStore = openExecutionStore('terminal-recovery')
  try {
    const before = idleStore.db.pragma('data_version', { simple: true })
    await recoverDurableExecutions(manager, 30)
    assert.equal(idleStore.db.pragma('data_version', { simple: true }), before,
      'Replaying cancellation receipts must not write the database')
  } finally { idleStore.close() }

  const store = openExecutionStore('terminal-recovery')
  try {
    store.db.prepare('UPDATE executions SET updated_at=?').run(Date.now() - 31 * 86_400_000)
    await recoverDurableExecutions(manager, 30)
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

test('obsolete unstarted wakeups retire while accepted invocations remain resumable', async () => {
  for (const status of ['completed', 'failed', 'consumed', 'cancelled'] as const) {
    for (const phase of ['admitted', 'accepted', 'legacy-admitted'] as const) {
      const manager = new UnifiedQueueManager()
      const errors: string[] = []
      let calls = 0
      const engine = new ExecutionEngine({ onError: error => errors.push(error.message) }, manager)
      engine.registerHandler('graph.resume', async () => { calls++; return {} })
      const store = openExecutionStore('obsolete-wake')
      try {
        const record = store.create('obsolete-wake', definition)
        let lease = store.claim(record.executionId, definition)
        const event = store.deliverEvent(record.executionId, {
          eventId: randomUUID(), kind: 'observation_received', payload: { observed: true },
        })
        const effectId = `${record.executionId}:resume:${event.eventId}`
        const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
        store.acknowledgeAdmission(effectId, task.id)
        if (phase === 'accepted') {
          assert.throws(() => store.acceptAction(effectId), /live writer/)
          store.release(lease)
          store.acceptAction(effectId)
          lease = store.claim(record.executionId, definition)
        }
        if (status === 'consumed') {
          await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: record.executionId } }, {
            v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
            channel_values: { executionTransition: { transitionId: randomUUID(), processedEventIds: [event.eventId] } },
          }, { source: 'loop', step: 0, parents: {} })
          store.settle(lease, 'waiting', 'next_event')
        } else if (status === 'cancelled') {
          store.cancel(record.executionId, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} })
        } else store.settle(lease, status)
        store.release(lease)
        if (phase === 'legacy-admitted') {
          // Earlier releases left these exact queued wake receipts admitted.
          // The accepting boundary must reconcile them without re-running a graph.
          store.db.prepare("UPDATE execution_outbox SET status='admitted' WHERE effect_id=?").run(effectId)
        }
        assert.ok(manager.claim(task.id))
        await (engine as unknown as { execute(work: typeof task): Promise<void> }).execute(task)
        assert.deepEqual(errors, [], `${status}/${phase} must not retry an obsolete wake`)
        const pendingInvocation = status === 'consumed' && phase === 'accepted'
        assert.equal(calls, pendingInvocation ? 1 : 0,
          'Only the accepted invocation may still have work after its event was consumed')
        assert.equal(manager.getTask(task.id)?.attempt, 0)
        assert.equal(manager.getTask(task.id)?.state, status === 'cancelled' ? 'cancelled' : 'completed')
        assert.equal(store.get(record.executionId).status, status === 'consumed' ? 'waiting' : status)
        assert.equal(store.get(record.executionId).lastProcessedSequence, status === 'consumed' ? 1 : 0)
        if (status !== 'cancelled') assert.equal(store.dispatch(effectId).status, 'completed')
      } finally { store.close() }
    }
  }
})

test('recovery of completed receipts is read-only and services pending HTTP requests', async (t) => {
  const manager = new UnifiedQueueManager({ historyLimit: 1 })
  const parent = await fixture('idle-recovery', 'fixture.finished')
  const store = openExecutionStore(parent.username)
  const server = createServer((request, response) => {
    void handleHttpRequest({ path: request.url!, method: request.method! }).then(result => {
      response.writeHead(result.status, result.headers)
      response.end(result.body)
    }).catch(error => {
      response.writeHead(500)
      response.end(String(error))
    })
  })
  let socket: ReturnType<typeof createConnection> | undefined
  try {
    const task = manager.enqueue(executionWorkInput(store, store.dispatch(parent.effectId)))
    store.acknowledgeAdmission(parent.effectId, task.id)
    manager.claim(task.id)
    store.acceptAction(parent.effectId)
    manager.complete(task.id, true, { observed: true })
    await deliverDurableWorkReceipt(manager.getTask(task.id)!, async input => manager.enqueue(input))
    const lease = store.claim(parent.executionId, definition)
    store.settle(lease, 'completed')
    store.release(lease)
    for (const wake of manager.getAllTasks().filter(work => work.handler === 'graph.resume')) {
      manager.claim(wake.id)
      manager.complete(wake.id, true, { resumed: true })
      await deliverDurableWorkReceipt(manager.getTask(wake.id)!, async input => manager.enqueue(input))
    }
    const before = store.db.pragma('data_version', { simple: true })
    const events = store.events(parent.executionId)
    const exported = manager.exportState()
    assert.equal(exported.history!.length, 1)
    assert.equal(exported.durableReceipts!.length, 1,
      'Recovery must include the durable receipt retained beyond the display history')

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    socket = createConnection(address.port, '127.0.0.1')
    await once(socket, 'connect')
    let recovering = true
    const response = once(socket, 'data').then(([data]) => {
      assert.match(data.toString(), /HTTP\/1.1 401 Unauthorized/)
      assert.match(data.toString(), /Authentication required/)
      return recovering
    })
    socket.write('GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
    authenticate('idle-recovery')
    await recoverDurableExecutions(manager, 30)
    recovering = false
    const httpDuringRecovery = await response
    const committedDuringRecovery = Number(store.db.pragma('data_version', { simple: true })) - Number(before)
    t.diagnostic(JSON.stringify({ committedDuringRecovery, httpDuringRecovery }))
    assert.deepEqual({ committedDuringRecovery, httpDuringRecovery }, {
      committedDuringRecovery: 0, httpDuringRecovery: true,
    })
    assert.deepEqual(store.events(parent.executionId), events)
    assert.throws(() => store.deliverWorkResult(parent.effectId, task.id, {
      state: 'completed', result: { observed: false }, error: null,
    }), /conflict/i, 'A conflicting duplicate must still be rejected')
  } finally {
    socket?.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    store.close()
  }
})

test('a changed executable fails the run once while preserving its definition and checkpoint', async () => {
  const manager = new UnifiedQueueManager()
  const store = openExecutionStore('version-recovery')
  const engine = new ExecutionEngine({}, manager)
  try {
    const record = store.create('version-recovery', definition)
    const lease = store.claim(record.executionId, definition)
    store.settle(lease, 'waiting', 'next_event')
    store.release(lease)
    const event = store.deliverEvent(record.executionId, {
      eventId: randomUUID(), kind: 'observation_received', payload: { observed: true },
    })
    const effectId = `${record.executionId}:resume:${event.eventId}`
    const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
    store.acknowledgeAdmission(effectId, task.id)
    engine.registerHandler('graph.resume', async () => {
      store.assertDefinition(record.executionId, { ...definition, runtimeVersion: 'changed-executable' })
      assert.fail('An incompatible executable must not run')
    })
    const saved = store.get(record.executionId)
    assert.ok(manager.claim(task.id))
    await (engine as unknown as { execute(work: typeof task): Promise<void> }).execute(task)
    assert.equal(manager.getTask(task.id)?.state, 'failed')
    assert.equal(manager.getTask(task.id)?.error?.code, 'execution_conflict')
    assert.equal(manager.getTask(task.id)?.error?.retryable, false)
    assert.equal(manager.getTask(task.id)?.attempt, 0)
    assert.equal(store.get(record.executionId).status, 'failed')
    assert.deepEqual(store.get(record.executionId).definition, saved.definition)
    assert.equal(store.get(record.executionId).checkpointVersion, saved.checkpointVersion)
    assert.deepEqual(store.events(record.executionId)[0], event)
    assert.equal(store.events(record.executionId)[1].kind, 'resume_result')
    assert.equal(store.pendingDispatches().length, 0)
  } finally { store.close() }
})

test('missing execution storage reports unresolved work without recreating it or changing another profile', async () => {
  const { resolvePath } = await import('../storage-client.js')
  const manager = new UnifiedQueueManager()
  const missing = manager.enqueue({ type: 'generic', handler: 'fixture.missing', username: 'missing-recovery', input: {},
    durable: { executionId: 'missing-execution', effectId: 'missing-effect', recovery: 'resume' } })
  manager.claim(missing.id)
  manager.complete(missing.id, true, { observed: true })
  const filename = resolvePath({ username: missing.username, category: 'state', subcategory: 'sessions', relativePath: 'executions.sqlite' }).path!
  assert.ok(filename.startsWith(root + path.sep))
  assert.equal(fs.existsSync(filename), false)
  const sibling = await fixture('present-recovery', 'fixture.present')
  const store = openExecutionStore(sibling.username)
  try {
    manager.enqueue(executionWorkInput(store, store.dispatch(sibling.effectId)))
    authenticate(missing.username)
    await assert.rejects(recoverDurableExecutions(manager, 30), error => {
      assert.ok(error instanceof AggregateError)
      assert.match(error.message, /missing-recovery.*execution storage is missing/)
      return true
    })
    assert.equal(fs.existsSync(filename), false, 'Missing checkpoints must not be recreated from receipts')
    assert.equal(store.dispatch(sibling.effectId).status, 'pending', 'An unrelated profile was not recovered')
    authenticate(sibling.username)
    await recoverDurableExecutions(manager, 30)
    assert.equal(store.dispatch(sibling.effectId).status, 'admitted')
    assert.equal(manager.getTask(missing.id)?.state, 'completed', 'The finite result remains available for recovery')
  } finally { store.close() }
})
