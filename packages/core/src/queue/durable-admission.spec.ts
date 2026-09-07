import assert from 'node:assert/strict'
import test from 'node:test'
import { UnifiedQueueManager } from './unified-queue-manager.js'
import type { TaskInput } from './types.js'
import { WorkCommitUncertainError } from './types.js'

const action = (): TaskInput => ({
  type: 'environment_command', handler: 'environment.command', resource: 'body:test',
  source: 'environment', username: 'fixture', input: { sessionId: 'test-body', type: 'robotCommand', command: 'walk' },
  durable: { executionId: 'execution', effectId: 'effect', recovery: 'reconcile' },
})

test('durable admission survives terminal-history eviction and process restart', () => {
  const manager = new UnifiedQueueManager({ historyLimit: 1 })
  const first = manager.enqueue(action())
  manager.claim(first.id)
  manager.complete(first.id, true, { completed: true })
  const other = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'other' } })
  manager.claim(other.id)
  manager.complete(other.id, true)
  assert.equal(manager.getHistory().length, 1)
  const restarted = new UnifiedQueueManager({ historyLimit: 1 })
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.equal(restarted.enqueue(action()).id, first.id)
  assert.equal(restarted.enqueue(action()).state, 'completed')
  assert.equal(restarted.getAllTasks().length, 0)
  assert.throws(() => restarted.enqueue({ ...action(), input: { command: 'dance' } }), /conflict/i)
})

test('admission is acknowledged and emitted only after durable persistence', () => {
  const manager = new UnifiedQueueManager()
  const emitted: string[] = []
  manager.addEventListener(event => emitted.push(event.type))
  manager.setOnQueueChange(() => { throw new Error('disk unavailable') })
  assert.throws(() => manager.enqueue(action()), /disk unavailable/)
  assert.deepEqual(emitted, [])
  assert.equal(manager.getNextExecutable(), null)
  assert.throws(() => manager.enqueue(action()), /disk unavailable/)
  let saved = false
  manager.setOnQueueChange(() => { saved = true })
  const accepted = manager.enqueue(action())
  assert.equal(saved, true)
  assert.equal(manager.getAllTasks().length, 1)
  assert.ok(accepted.id)
})

test('failed lifecycle writes roll back and may be retried without losing the receipt', () => {
  const manager = new UnifiedQueueManager()
  const task = manager.enqueue(action())
  let fail = true
  manager.setOnQueueChange(() => { if (fail) throw new Error('disk unavailable') })
  assert.throws(() => manager.claim(task.id), /disk unavailable/)
  assert.equal(manager.getTask(task.id)?.state, 'queued')
  fail = false
  assert.equal(manager.claim(task.id)?.state, 'leased')
  fail = true
  const events: string[] = []
  manager.addEventListener(event => events.push(event.type))
  assert.throws(() => manager.wait(task.id, 'test wait'), /disk unavailable/)
  assert.deepEqual(events, [])
  assert.equal(manager.getTask(task.id)?.state, 'leased')
  assert.throws(() => manager.complete(task.id, true), /disk unavailable/)
  assert.equal(manager.getTask(task.id)?.state, 'leased')
  fail = false
  manager.complete(task.id, true)
  assert.equal(manager.getTask(task.id)?.state, 'completed')
})

test('admission identity is immutable, restart-stable, and includes causal metadata', () => {
  const manager = new UnifiedQueueManager()
  const request = { ...action(), input: { command: 'walk', optional: undefined }, correlationId: 'execution', parentTaskId: 'parent', metadata: { owner: 'test' } }
  const task = manager.enqueue(request)
  request.input.command = 'dance'
  assert.equal(manager.getTask(task.id)?.input.command, 'walk')
  assert.throws(() => { task.input.command = 'dance' }, TypeError)
  request.input.command = 'walk'
  const restarted = new UnifiedQueueManager()
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.throws(() => { restarted.getTask(task.id)!.durable!.effectId = 'changed' }, TypeError)
  assert.throws(() => { restarted.getTask(task.id)!.durable = { ...request.durable!, effectId: 'changed' } }, TypeError)
  assert.equal(restarted.enqueue(request).id, task.id)
  assert.throws(() => restarted.enqueue({ ...request, correlationId: 'other' }), /conflict/i)
  assert.throws(() => restarted.enqueue({ ...request, parentTaskId: 'other' }), /conflict/i)
  assert.throws(() => restarted.enqueue({ ...request, metadata: { owner: 'other' } }), /conflict/i)
})

test('each lifecycle mutation commits once before its event', () => {
  const manager = new UnifiedQueueManager()
  let commits = 0
  manager.setOnQueueChange(() => { commits++ })
  const observed: number[] = []
  manager.addEventListener(() => observed.push(commits))
  const task = manager.enqueue(action())
  assert.equal(commits, 1)
  manager.claim(task.id)
  assert.equal(commits, 2)
  manager.complete(task.id, true)
  assert.equal(commits, 3)
  assert.deepEqual(observed, [1, 2, 3])
})

test('an uncertain published commit preserves its identity and cannot dispatch until confirmed', () => {
  const manager = new UnifiedQueueManager()
  let published: ReturnType<typeof manager.exportState> | undefined
  manager.setOnQueueChange(() => {
    published = JSON.parse(JSON.stringify(manager.exportState()))
    throw new WorkCommitUncertainError('directory sync failed after rename')
  })
  assert.throws(() => manager.enqueue(action()), WorkCommitUncertainError)
  const id = published!.items![0].id
  assert.throws(() => manager.getNextExecutable(), WorkCommitUncertainError)
  assert.throws(() => manager.claim(id), WorkCommitUncertainError)
  assert.equal(manager.getTask(id)?.state, 'queued')
  manager.setOnQueueChange(() => { published = JSON.parse(JSON.stringify(manager.exportState())) })
  assert.equal(manager.enqueue(action()).id, id)
  assert.equal(manager.claim(id)?.id, id)
})

test('restart preserves cancellation and parks uncertain physical work instead of resending', () => {
  const manager = new UnifiedQueueManager()
  const cancelled = manager.enqueue(action())
  manager.claim(cancelled.id)
  manager.cancel(cancelled.id)
  const uncertain = manager.enqueue({ ...action(), resource: 'body:other', input: { ...action().input, sessionId: 'other-body' }, durable: { ...action().durable!, effectId: 'uncertain' } })
  manager.claim(uncertain.id)
  const restarted = new UnifiedQueueManager()
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.equal(restarted.getTask(cancelled.id)?.state, 'waiting')
  assert.ok(restarted.getTask(cancelled.id)?.cancellationRequestedAt)
  assert.equal(restarted.getTask(uncertain.id)?.state, 'waiting')
  assert.equal(restarted.getTask(uncertain.id)?.error?.code, 'outcome_unknown')
  assert.equal(restarted.getNextExecutable(), null)
})

test('physical cancellation retains ownership and stop preempts without being fenced by a later move', () => {
  const manager = new UnifiedQueueManager()
  const first = manager.enqueue(action())
  manager.claim(first.id)
  const lease = manager.assertBodyLease(first.id)
  manager.cancel(first.id)
  manager.requeue(first, 'lost transport')
  manager.expire(first.id)
  manager.releaseWaiting(Date.now() + 60_000)
  assert.equal(manager.getTask(first.id)?.state, 'waiting')
  const next = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'next' } })
  assert.equal(manager.claim(next.id), null)
  const stop = manager.enqueue({ ...action(), resource: 'environment-stop:test-body', input: { ...action().input, type: 'stop' }, durable: { ...action().durable!, effectId: 'stop' } })
  manager.claim(stop.id)
  assert.ok(manager.assertBodyLease(stop.id).generation > lease.generation)
  assert.throws(() => manager.assertBodyLease(first.id), /Stale body/)
  assert.equal(manager.claim(next.id), null)
  manager.acknowledgeCancellation(first.id)
  assert.equal(manager.claim(next.id), null)
  manager.complete(stop.id, true)
  assert.equal(manager.getTask(next.id)?.state, 'cancelled', 'Stop supersedes pre-existing queued motion')
  const afterStop = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'after-stop' } })
  assert.ok(manager.claim(afterStop.id))
  assert.ok(manager.assertBodyLease(afterStop.id).generation > manager.getTask(stop.id)!.bodyLease!.generation)
  assert.throws(() => manager.assertBodyLease(first.id), /Stale body/)
})

test('stop admission and supersession commit together or roll back together', () => {
  const manager = new UnifiedQueueManager()
  const first = manager.enqueue(action())
  const second = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'second' } })
  const stop = { ...action(), input: { ...action().input, type: 'stop' },
    resource: 'environment-stop:test-body', durable: { ...action().durable!, effectId: 'stop' } }
  const events: string[] = []
  manager.addEventListener(event => events.push(event.type))
  manager.setOnQueueChange(() => { throw new Error('Controlled admission write failure') })
  assert.throws(() => manager.enqueue(stop), /Controlled admission write failure/)
  assert.deepEqual(events, [], 'Failed admission cannot publish partial cancellation')
  assert.equal(manager.getTask(first.id)?.state, 'queued')
  assert.equal(manager.getTask(second.id)?.state, 'queued')
  assert.equal(manager.getAllTasks().length, 2, 'The failed stop is not partially admitted')

  let commits = 0
  manager.setOnQueueChange(() => { commits++ })
  const admitted = manager.enqueue(stop)
  assert.equal(commits, 1, 'All superseded items and the stop share one ledger commit')
  assert.equal(manager.getTask(first.id)?.state, 'cancelled')
  assert.equal(manager.getTask(second.id)?.state, 'cancelled')
  assert.equal(manager.enqueue(stop).id, admitted.id)
  assert.equal(commits, 1, 'Idempotent retry needs no partial supersession recovery')
  manager.claim(admitted.id)
  manager.complete(admitted.id, true, { fakeStopTerminal: true })
  assert.equal(manager.getNextExecutable(), null, 'Pre-stop queued movements cannot run afterward')
})
