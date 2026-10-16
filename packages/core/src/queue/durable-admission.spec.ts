import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { UnifiedQueueManager } from './unified-queue-manager.js'
import type { TaskInput } from './types.js'
import { WorkCommitUncertainError } from './types.js'

const action = (): TaskInput => ({
  type: 'environment_command', handler: 'environment.command', resource: 'body:test',
  source: 'environment', username: 'fixture', input: { sessionId: 'test-body', type: 'robotCommand', command: 'walk' },
  durable: { executionId: 'execution', effectId: 'effect', recovery: 'reconcile' },
})

test('feedback resumes wait for the current graph owner while inference and body work remain independent', () => {
  const manager = new UnifiedQueueManager()
  const initial = manager.enqueue({ type: 'generic', handler: 'environment.observation',
    resource: 'local-llm', source: 'environment', username: 'fixture', input: {} })
  assert.ok(manager.claim(initial.id))
  const releaseWriter = manager.attachExecution(initial.id, 'conversation')
  const resume = (effectId: string) => manager.enqueue({ type: 'generic', handler: 'graph.resume',
    resource: 'execution:conversation', source: 'environment', username: 'fixture', input: { executionId: 'conversation' },
    durable: { executionId: 'conversation', effectId, recovery: 'resume' } })
  const feedback = resume('display-result')
  const result = resume('inference-result')
  const inference = manager.enqueue({ type: 'generic', handler: 'environment.conversation',
    resource: 'environment-conversation', source: 'environment', username: 'fixture', input: {},
    durable: { executionId: 'conversation', effectId: 'inference', recovery: 'resume' } })
  assert.equal(manager.claim(feedback.id), null)
  assert.ok(manager.claim(inference.id), 'Inference does not need execution ownership')
  assert.ok(manager.claim(manager.enqueue(action()).id), 'Movement remains independent')
  releaseWriter()
  assert.ok(manager.claim(feedback.id), 'Releasing ownership makes feedback immediately runnable')
  assert.equal(initial.state, 'leased', 'Other work after a child graph must not retain its writer ownership')
  assert.equal(manager.claim(result.id), null)
  manager.complete(feedback.id, true)
  assert.ok(manager.claim(result.id), 'The saved answer does not wait for a lease deadline')
  assert.equal(result.notBefore, undefined)
  assert.equal(result.wakeAt, undefined)
})

test('interrupted display delivery settles across restart while movement and speech retain ownership', () => {
  const manager = new UnifiedQueueManager()
  const motion = manager.enqueue(action())
  const speech = manager.enqueue({ ...action(), resource: 'environment-speech:test-body',
    input: { sessionId: 'test-body', type: 'speak' },
    durable: { executionId: 'conversation', effectId: 'speech', recovery: 'reconcile' } })
  const displayInput: TaskInput = { ...action(), resource: 'environment-display:test-body',
    input: { sessionId: 'test-body', type: 'faceExpression', expression: 'happy' },
    durable: { executionId: 'expression', effectId: 'face', recovery: 'reconcile' } }
  const display = manager.enqueue(displayInput)
  for (const work of [motion, speech, display]) assert.ok(manager.claim(work.id))
  assert.equal(manager.assertBodyLease(display.id).channel, 'display')
  const next = manager.enqueue({ ...displayInput, durable: { ...displayInput.durable!, effectId: 'next' } })
  assert.equal(manager.claim(next.id), null, 'Display commands keep their wire order')
  const recovered = new UnifiedQueueManager()
  recovered.importState(JSON.parse(JSON.stringify(manager.exportState())))
  for (const work of [motion, speech]) {
    assert.equal(recovered.getTask(work.id)?.state, 'waiting')
    assert.ok(recovered.hasCurrentBodyLease(work.id))
  }
  assert.equal(recovered.getTask(display.id)?.state, 'failed')
  assert.equal(recovered.getTask(display.id)?.error?.code, 'outcome_unknown')
  assert.ok(recovered.claim(next.id))
  assert.ok(recovered.hasCurrentBodyLease(motion.id))
  assert.ok(recovered.hasCurrentBodyLease(speech.id))
})

test('display replacement supersedes unsent states within a layer and releases only its token', () => {
  const manager = new UnifiedQueueManager()
  const face = (id: string, fields: Record<string, unknown>) => manager.enqueue({ ...action(),
    resource: 'environment-display:test-body', input: { sessionId: 'test-body', type: 'faceExpression',
      expression: 'thinking', displayToken: id, ...fields },
    durable: { ...action().durable!, effectId: id } })
  const old = face('old', { displayBackground: true })
  const front = face('front', { displayBackground: false })
  const current = face('current', { displayBackground: true })
  assert.equal(old.state, 'cancelled')
  assert.equal(old.startedAt, undefined)
  assert.equal(front.state, 'queued')
  const oldRelease = face('old-release', { displayRelease: true, displayToken: 'old' })
  assert.equal(current.state, 'queued', 'An old turn release cannot supersede a newer turn')
  face('conditional-release', { displayRelease: true, displayToken: 'current', displayIfToken: 'different' })
  assert.equal(current.state, 'queued', 'A conditional release that cannot match must not discard its setter')
  const currentRelease = face('current-release', { displayRelease: true, displayToken: 'current' })
  assert.equal(current.state, 'cancelled')
  assert.equal(currentRelease.state, 'queued')
  assert.equal(oldRelease.state, 'queued', 'Release may still clear a previously displayed token')
  assert.equal(front.state, 'queued')
})

test('conditional expressions preserve prerequisites and display failures never replay', () => {
  const manager = new UnifiedQueueManager()
  const base = { ...action(), resource: 'environment-display:test-body',
    input: { sessionId: 'test-body', type: 'faceExpression', expression: 'thinking', displayToken: 'turn', displayBackground: true } }
  const first = manager.enqueue(base)
  const conditional = manager.enqueue({ ...base, input: { ...base.input, expression: 'sad', displayIfToken: 'turn' },
    durable: { ...base.durable!, effectId: 'conditional' } })
  assert.equal(first.state, 'queued')
  assert.ok(manager.claim(first.id))
  assert.equal(manager.requeue(first, { code: 'outcome_unknown', message: 'disconnect', retryable: false }), false)
  assert.equal(first.state, 'failed')
  assert.equal(first.error?.code, 'outcome_unknown')
  assert.ok(manager.claim(conditional.id))
})

test('legacy disconnected display backlog is settled and superseded during recovery', () => {
  const old = new UnifiedQueueManager()
  const base = { ...action(), resource: 'environment-display:test-body',
    input: { sessionId: 'test-body', type: 'faceExpression', expression: 'thinking', displayToken: 'turn', displayBackground: true } }
  const sent = old.enqueue(base)
  assert.ok(old.claim(sent.id))
  old.wait(sent.id, 'outcome_unknown: disconnect')
  const saved = old.exportState()
  const pending = { ...saved.items![0]!, id: 'pending-face', state: 'queued' as const,
    startedAt: undefined, bodyLease: undefined, waitingReason: undefined, leaseOwner: undefined,
    durable: { ...base.durable!, effectId: 'pending' } }
  const release = { ...pending, id: 'release-face', input: { ...base.input, displayRelease: true },
    durable: { ...base.durable!, effectId: 'release' } }
  saved.items!.push(pending, release)
  const recovered = new UnifiedQueueManager()
  recovered.importState(JSON.parse(JSON.stringify(saved)))
  assert.equal(recovered.getTask(sent.id)?.state, 'failed')
  assert.equal(recovered.getTask(sent.id)?.error?.code, 'outcome_unknown')
  assert.equal(recovered.getTask(pending.id)?.state, 'cancelled')
  assert.equal(recovered.getNextExecutable()?.id, release.id)
  assert.ok(recovered.claim(release.id))
})

test('display replacement and release retain admission order when timestamps tie, including restart', () => {
  const manager = new UnifiedQueueManager()
  for (const effectId of ['set', 'release']) manager.enqueue({ ...action(),
    resource: 'environment-display:test-body',
    input: { sessionId: 'test-body', type: 'faceExpression', displayRelease: effectId === 'release' },
    durable: { ...action().durable!, effectId } })
  const saved = manager.exportState()
  const tasks = saved.items
  assert.ok(tasks)
  tasks[0]!.id = 'z-set'
  tasks[1]!.id = 'a-release'
  tasks[1]!.createdAt = tasks[0]!.createdAt
  const restored = new UnifiedQueueManager()
  restored.importState(saved)
  assert.equal(restored.getNextExecutable()!.id, 'z-set')
  assert.ok(restored.claim('z-set'))
  restored.complete('z-set', true)
  assert.equal(restored.getNextExecutable()!.id, 'a-release')
})

for (const speechFirst of [true, false]) {
  test(`speech and movement retain independent ownership and receipts (speech first: ${speechFirst})`, () => {
    const manager = new UnifiedQueueManager()
    const movement = manager.enqueue(action())
    const speechInput: TaskInput = { ...action(), resource: 'environment-speech:test-body',
      input: { sessionId: 'test-body', type: 'speak' },
      durable: { executionId: 'conversation', effectId: 'speech', recovery: 'reconcile' } }
    const speech = manager.enqueue(speechInput)
    const first = speechFirst ? speech : movement
    const second = speechFirst ? movement : speech
    assert.ok(manager.claim(first.id))
    assert.ok(manager.claim(second.id), 'Audio and motion may run concurrently across executions')
    const movementLease = manager.assertBodyLease(movement.id)
    const speechLease = manager.assertBodyLease(speech.id)
    assert.equal(movementLease.channel, undefined)
    assert.equal(speechLease.channel, 'speech')
    assert.equal(speechLease.bodyId, movementLease.bodyId)
    const nextMovement = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'move-next' } })
    const nextSpeech = manager.enqueue({ ...speechInput, durable: { ...speechInput.durable!, effectId: 'speech-next' } })
    assert.equal(manager.claim(nextMovement.id), null)
    assert.equal(manager.claim(nextSpeech.id), null, 'Separate channels do not overlap two speaker playbacks')
    const restored = new UnifiedQueueManager()
    restored.importState(JSON.parse(JSON.stringify(manager.exportState())))
    assert.equal(restored.getTask(speech.id)?.state, 'waiting')
    assert.equal(restored.getTask(movement.id)?.state, 'waiting')
    assert.deepEqual(restored.getTask(speech.id)?.bodyLease, speechLease)
    assert.deepEqual(restored.assertBodyLease(movement.id), movementLease)
    assert.equal(restored.getNextExecutable()?.id, nextSpeech.id, 'Interrupted speech cannot block a new delivery')
    restored.complete(movement.id, true, { completed: true })
    assert.ok(restored.claim(nextMovement.id), 'Speech playback cannot hold the next movement')
    assert.deepEqual(restored.getTask(speech.id)?.bodyLease, speechLease, 'A new motion cannot rewrite a speech receipt')
    restored.cancel(speech.id, 'Explicit speech cancellation')
    assert.ok(restored.claim(nextSpeech.id))
    restored.acknowledgeCancellation(speech.id)
    assert.ok(restored.hasCurrentBodyLease(nextMovement.id))
    assert.ok(restored.hasCurrentBodyLease(nextSpeech.id))
    assert.equal(restored.hasCurrentBodyLease(speech.id), false)
    const stop = restored.enqueue({ ...action(), resource: 'environment-stop:test-body',
      input: { sessionId: 'test-body', type: 'stop' }, durable: { ...action().durable!, effectId: 'stop' } })
    assert.ok(restored.claim(stop.id))
    assert.equal(restored.hasCurrentBodyLease(nextMovement.id), false, 'Stop still fences movement')
    assert.ok(restored.hasCurrentBodyLease(nextSpeech.id), 'A movement stop does not invalidate concurrent speech receipts')
  })
}

test('configured model capacity becomes available on completion without a timed post-job pause', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../../../../etc/queue.json', import.meta.url), 'utf8'))
  const manager = new UnifiedQueueManager(config)
  const enqueue = () => manager.enqueue({ type: 'generic', handler: 'test.model', resource: 'local-llm',
    source: 'system', username: 'fixture', input: {} })
  const first = enqueue()
  const next = enqueue()
  assert.ok(manager.claim(first.id))
  assert.equal(manager.claim(next.id), null, 'The selected model capacity still serializes work')
  manager.complete(first.id, true)
  assert.ok(manager.claim(next.id), 'Completion, not an arbitrary extra timeout, releases capacity')
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

test('lifecycle commits identify changed work without revisiting immutable historical payloads', () => {
  const manager = new UnifiedQueueManager()
  const first = manager.enqueue({ ...action(), input: { ...action().input, context: 'retained evidence '.repeat(2000) } })
  manager.claim(first.id)
  manager.complete(first.id, true, { receipt: 'completed' })
  Object.defineProperty(first, 'result', { enumerable: true,
    get() { throw new Error('Untouched history was read during another task update') } })
  const changes: string[][] = []
  manager.setOnQueueChange(ids => { changes.push([...ids]) })
  const second = manager.enqueue({ ...action(), durable: { ...action().durable!, effectId: 'second' } })
  manager.claim(second.id)
  manager.appendOutput(second.id, 'selected action')
  manager.attachExecution(second.id, 'parent-execution')
  manager.complete(second.id, true, { receipt: 'second completed' })
  assert.equal(changes.length, 5)
  assert.ok(changes.every(ids => ids.length === 1 && ids[0] === second.id))
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
  assert.equal(manager.hasCurrentBodyLease(id), true)
  manager.setOnQueueChange(() => { throw new WorkCommitUncertainError('receipt sync is uncertain') })
  assert.throws(() => manager.wait(id, 'Awaiting adapter'), WorkCommitUncertainError)
  assert.equal(manager.hasCurrentBodyLease(id), false, 'An uncertain Coordinator commit cannot grant a wire handshake')
  assert.throws(() => manager.assertBodyLease(id), /Stale body ownership/)
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
  assert.equal(restarted.getTask(cancelled.id)?.startedAt, manager.getTask(cancelled.id)?.startedAt)
  assert.ok(restarted.getTask(cancelled.id)?.cancellationRequestedAt)
  assert.equal(restarted.getTask(uncertain.id)?.state, 'waiting')
  assert.equal(restarted.getTask(uncertain.id)?.startedAt, manager.getTask(uncertain.id)?.startedAt,
    'Physical recovery preserves the historical claim receipt while clearing the process lease')
  assert.equal(restarted.getTask(uncertain.id)?.leaseOwner, undefined)
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
  assert.equal(manager.hasCurrentBodyLease(first.id), false)
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
