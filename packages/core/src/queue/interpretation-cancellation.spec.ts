import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, mock, test } from 'node:test'
import type { InstructionInterpretation } from '../environment-interface/interpretation.js'
import type { TaskInput } from './types.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-interpretation-cancellation-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Network access is forbidden in this Coordinator fixture') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)

// A simulated read-only interpreter deliberately ignores its abort signal, as
// an unresponsive provider would. Queue capacity and durable receipts stay real.
const pending = new Map<number, {
  signal: AbortSignal
  resolve: (value: InstructionInterpretation) => void
  reject: (error: Error) => void
}>()
const interpretation = await import('../environment-interface/interpretation.js')
mock.module(new URL('../environment-interface/interpretation.ts', import.meta.url).href, { namedExports: {
  ...interpretation,
  interpretInstructions: async (input: { identity: InstructionInterpretation }, _username: string, signal: AbortSignal) => {
    if (input.identity.revision === 2) return { ...input.identity, response: 'Current proposal' }
    return new Promise<InstructionInterpretation>((resolve, reject) => {
      pending.set(input.identity.revision, { signal, resolve, reject })
    })
  },
} })
const { ExecutionEngine } = await import('./execution-engine.js')
const { UnifiedQueueManager } = await import('./unified-queue-manager.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { executionWorkInput } = await import('../durable-execution/coordinator-outbox.js')
const { recoverDurableExecutions } = await import('../durable-execution/recovery.js')
const { createUser, getUserByUsername } = await import('../users.js')
const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../sessions.js')
const username = 'interpretation-cancellation-fixture'
createUser(username, 'fixture-only-password', 'owner')
beginAuthenticatedRuntime()
selectAuthenticatedSession(createSession(getUserByUsername(username)!.id, 'owner').id)
after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Coordinator must progress while the obsolete provider remains pending')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

for (const lateOutcome of ['proposal', 'rejection'] as const) {
  test(`superseded interpretation releases its lane before an abort-ignoring provider returns a late ${lateOutcome}`, async () => {
    const manager = new UnifiedQueueManager()
    const errors: Error[] = []
    const engine = new ExecutionEngine({ wakeFallbackMs: 250, onError: error => errors.push(error) }, manager)
    // This spec observes proposal receipts; the active-task owner is exercised
    // by its separate real-graph regressions, rather than a replacement handler.
    engine.unregisterHandler('graph.resume')
    const store = openExecutionStore(username)
    const definition = { graphId: 'interpretation-cancellation', graphHash: 'fixture', runtimeVersion: 'fixture',
      checkpointSchemaVersion: 1, nodeVersions: {} }
    const execution = store.create(username, definition)
    const executionId = execution.executionId
    const identity = (revision: number): InstructionInterpretation => ({ executionId, sessionId: 'simulated-body',
      revision, stepIndex: 0, body: '["simulated-body","gateway","robot",1,1]' })
    const admit = (handler: string, input: TaskInput['input'], resource = 'local-llm') => {
      const effectId = randomUUID()
      store.db.transaction(() => store.commitTransition(executionId, effectId, { transitionId: effectId,
        dispatches: [{ effectId, kind: 'coordinator_work', payload: {
          type: 'generic', handler, username, input, resource, source: 'environment', maxAttempts: 1,
        } }],
      }))()
      const job = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
      store.acknowledgeAdmission(effectId, job.id)
      return job
    }
    const old = admit('environment.interpret', { identity: identity(1), turns: [{ userMessage: 'Wave' }], context: {} })
    engine.start()
    try {
      await waitFor(() => pending.has(1))
      assert.equal(manager.getTask(old.id)!.state, 'leased')
      const replacement = admit('environment.interpret', { identity: identity(2),
        turns: [{ userMessage: 'Wave' }, { userMessage: 'Then sit' }], context: {} })
      assert.equal(manager.getNextExecutable()?.id, undefined, 'The obsolete job still owns the single LLM lane')
      const cancellation = admit('environment.cancel-owned-work', {
        interpretationEffectId: old.durable!.effectId, reason: 'New instruction revision',
      }, `execution:${executionId}`)
      await waitFor(() => manager.getTask(cancellation.id)?.state === 'completed'
        && manager.getTask(old.id)?.state === 'cancelled'
        && manager.getTask(replacement.id)?.state === 'completed')
      assert.ok(pending.get(1)!.signal.aborted)
      assert.equal(manager.getTask(replacement.id)!.result?.response, 'Current proposal')
      const oldProvider = pending.get(1)!
      const events = store.events(executionId)
      assert.ok(events.some(event => event.kind === 'work_result'
        && (event.payload as any).effectId === replacement.durable!.effectId))
      if (lateOutcome === 'proposal') oldProvider.resolve({ ...identity(1), response: 'Obsolete Stop proposal' })
      else oldProvider.reject(new Error('Detached provider failed after cancellation'))
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(manager.getTask(old.id)!.state, 'cancelled')
      assert.equal(manager.getTask(old.id)!.result, undefined)
      assert.deepEqual(store.events(executionId), events, 'Late provider output cannot commit a proposal receipt')
      assert.equal(manager.getAllTasks().some(task => task.type === 'environment_command'), false)

      const cancelled = admit('environment.interpret', { identity: identity(3), turns: [{ userMessage: 'Keep walking' }], context: {} })
      await waitFor(() => pending.has(3))
      store.cancel(executionId, { eventId: randomUUID(), kind: 'user_cancelled', payload: { reason: 'Owner cancelled' } })
      await recoverDurableExecutions(manager, 30)
      await waitFor(() => manager.getTask(cancelled.id)?.state === 'cancelled')
      assert.equal(store.get(executionId).status, 'cancelled')
      assert.ok(pending.get(3)!.signal.aborted, 'Execution cancellation does not await provider completion')
      pending.get(3)!.resolve({ ...identity(3), response: 'Late cancelled execution proposal' })
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(manager.getTask(cancelled.id)!.result, undefined)
      assert.deepEqual(errors, [])
    } finally {
      for (const [revision, work] of pending) work.resolve(identity(revision))
      pending.clear()
      await engine.stop()
      store.close()
    }
  })
}
