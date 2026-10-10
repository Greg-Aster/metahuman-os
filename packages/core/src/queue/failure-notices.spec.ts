import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-failure-notices-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network or robot actions in this fixture') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const { UnifiedQueueManager } = await import('./unified-queue-manager.js')
const { deliverWorkFailureNotice } = await import('./failure-notices.js')
const { loadBufferForUser } = await import('../conversation-buffer.js')
const { createUser } = await import('../users.js')
const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../sessions.js')
const { recoverDurableExecutions } = await import('../durable-execution/recovery.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { ExecutionCheckpointer } = await import('../durable-execution/checkpointer.js')
const { executionWorkInput } = await import('../durable-execution/coordinator-outbox.js')
const username = 'notice-fixture'
const user = createUser(username, 'fixture-only-password', 'owner')
const other = createUser('other-notice-fixture', 'fixture-only-password', 'standard')
beginAuthenticatedRuntime()
selectAuthenticatedSession(createSession(user.id, 'owner').id)
const graphPath = path.join(root, 'etc/cognitive-graphs/system-event.json')
fs.mkdirSync(path.dirname(graphPath), { recursive: true })
fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/system-event.json', import.meta.url), graphPath)
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

function fail(manager: InstanceType<typeof UnifiedQueueManager>, profile = username) {
  const task = manager.enqueue({ type: 'generic', handler: 'environment.conversation', source: 'environment',
    username: profile, maxAttempts: 1, input: {} })
  assert.ok(manager.claim(task.id))
  assert.equal(manager.requeue(task, 'Simulated llama.cpp connection closed'), false)
  assert.equal(task.failureNoticePending, true)
  return task
}

test('a terminal conversation failure reaches the existing System Buffer once across restart and receipt replay', async () => {
  const before = new UnifiedQueueManager()
  const task = fail(before)
  const manager = new UnifiedQueueManager()
  manager.importState(JSON.parse(JSON.stringify(before.exportState())))
  const restored = manager.getTask(task.id)!
  // Simulate a crash after the buffer commits but before the queue records its acknowledgement.
  const acknowledge = manager.acknowledgeFailureNotice.bind(manager)
  manager.acknowledgeFailureNotice = () => { throw new Error('Interrupted notice acknowledgement') }
  await assert.rejects(deliverWorkFailureNotice(restored, manager), /Interrupted notice acknowledgement/)
  assert.equal(restored.failureNoticePending, true)
  manager.acknowledgeFailureNotice = acknowledge
  await deliverWorkFailureNotice(restored, manager)
  await deliverWorkFailureNotice(restored, manager)
  const notices = loadBufferForUser(username, 'system').messages.filter(entry => entry.meta?.taskId === task.id)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].meta?.severity, 'error')
  assert.match(notices[0].content, /Conversation response failed\nSimulated llama.cpp connection closed/)
  assert.equal(restored.failureNoticePending, false)
  assert.equal(restored.state, 'failed', 'Publishing a notice never claims the work succeeded')
  assert.equal(loadBufferForUser(username, 'conversation').messages.length, 0)
})

test('Coordinator recovery delivers only the authenticated profile and retains notices beyond dashboard history trimming', async () => {
  const manager = new UnifiedQueueManager({ historyLimit: 1 })
  const first = fail(manager)
  const second = fail(manager)
  const foreign = fail(manager, other.username)
  assert.equal(manager.getHistory().length, 3, 'Unpublished notices cannot be discarded by history trimming')
  const restored = new UnifiedQueueManager({ historyLimit: 1 })
  restored.importState(JSON.parse(JSON.stringify(manager.exportState())))
  await recoverDurableExecutions(restored, 30)
  const entries = loadBufferForUser(username, 'system').messages
  for (const task of [first, second]) assert.equal(entries.filter(entry => entry.meta?.taskId === task.id).length, 1)
  assert.equal(restored.getTask(foreign.id)?.failureNoticePending, true)
  assert.equal(loadBufferForUser(other.username, 'system').messages.length, 0)
  assert.equal(restored.getHistory().length, 1, 'Delivered notices no longer retain old dashboard entries')
})

test('notice delivery failure remains pending and preserves the original work error until recovery succeeds', async () => {
  const manager = new UnifiedQueueManager()
  const task = fail(manager)
  fs.renameSync(graphPath, `${graphPath}.saved`)
  try {
    await assert.rejects(deliverWorkFailureNotice(task, manager), /system buffer admission workflow/)
    assert.equal(task.failureNoticePending, true)
    assert.equal(task.error?.message, 'Simulated llama.cpp connection closed')
  } finally { fs.renameSync(`${graphPath}.saved`, graphPath) }
  await recoverDurableExecutions(manager, 30)
  assert.equal(task.failureNoticePending, false)
})

test('retrying, successful and cancelled jobs do not create terminal failure notices', () => {
  const manager = new UnifiedQueueManager()
  const task = manager.enqueue({ type: 'generic', handler: 'fixture', source: 'system', username, maxAttempts: 2, input: {} })
  manager.claim(task.id)
  assert.equal(manager.requeue(task, 'temporary error'), true)
  assert.equal(task.failureNoticePending, undefined)
  manager.claim(task.id)
  manager.complete(task.id, true, {})
  assert.equal(task.failureNoticePending, undefined)
  const cancelled = manager.enqueue({ type: 'generic', handler: 'fixture', source: 'system', username, input: {} })
  manager.cancel(cancelled.id, 'User cancelled')
  assert.equal(cancelled.failureNoticePending, undefined)
  const failed = manager.enqueue({ type: 'generic', handler: 'fixture', source: 'system', username, input: {} })
  manager.claim(failed.id)
  manager.complete(failed.id, false, 'Final failure')
  assert.equal(failed.failureNoticePending, true)
})

test('execution retention preserves undelivered notices before and after checkpoint retirement', async () => {
  for (const alreadyRetired of [false, true]) {
    const manager = new UnifiedQueueManager()
    const store = openExecutionStore(username)
    const definition = { graphId: 'notice-retention-fixture', graphHash: 'v1', runtimeVersion: 'v1',
      checkpointSchemaVersion: 1, nodeVersions: {} }
    const record = store.create(username, definition)
    const lease = store.claim(record.executionId, definition)
    const saver = new ExecutionCheckpointer(store, lease)
    const effectId = randomUUID()
    try {
      await saver.put({ configurable: { thread_id: record.executionId } }, {
        v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_versions: {}, versions_seen: {},
        channel_values: { executionTransition: { transitionId: randomUUID(), dispatches: [{
          effectId, kind: 'coordinator_work', payload: { type: 'generic', handler: 'fixture',
            source: 'system', username, input: {}, maxAttempts: 1 },
        }] } },
      }, { source: 'loop', step: 0, parents: {} })
      const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
      store.acknowledgeAdmission(effectId, task.id)
      manager.claim(task.id)
      manager.complete(task.id, false, 'Failure pending at retention')
      store.deliverWorkResult(effectId, task.id, { state: task.state, result: null, error: task.error })
      store.settle(lease, 'completed')
      store.release(lease)
      if (alreadyRetired) await saver.deleteThread(record.executionId)
      else store.db.prepare('UPDATE executions SET updated_at=0 WHERE execution_id=?').run(record.executionId)

      fs.renameSync(graphPath, `${graphPath}.saved`)
      try {
        await assert.rejects(recoverDurableExecutions(manager, 30), /Failure notice delivery failed/)
        assert.equal(manager.getTask(task.id)?.failureNoticePending, true)
        if (alreadyRetired) assert.ok(store.retirements().includes(record.executionId))
        else assert.ok(store.list().some(item => item.executionId === record.executionId))
      } finally { fs.renameSync(`${graphPath}.saved`, graphPath) }

      await recoverDurableExecutions(manager, 30)
      assert.equal(loadBufferForUser(username, 'system').messages.filter(entry => entry.meta?.taskId === task.id).length, 1)
      assert.equal(manager.getTask(task.id), null)
      assert.equal(store.list().some(item => item.executionId === record.executionId), false)
      assert.equal(store.retirements().includes(record.executionId), false)
    } finally { store.close() }
  }
})
