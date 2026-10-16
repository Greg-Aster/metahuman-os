/** Paired software qualification. Requires the sibling gateway test harness;
 * includes the existing graph/Coordinator suite whose fixture is reused here. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { EnvironmentCommandWork } from './types.js'
import { fixture, route, decision, replies, calls, core, manager, username, withUserContext,
  openExecutionStore, queuedInterpretation, executeWork } from './active-task.spec.js'

async function simulatedBody() {
  const gateway = process.env.AINEKIO_SOFTWARE_TEST_GATEWAY
  assert.ok(gateway, 'Set AINEKIO_SOFTWARE_TEST_GATEWAY to the paired Ainekio checkout')
  const child = spawn('python3', ['-u', '-m', 'Emulator.tests.program_ownership_harness'], {
    cwd: path.resolve(gateway), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: 'Master:Slave/software:Emulator:Emulator/tests', AINEKIO_TEST_SESSION: `paired-${randomUUID()}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const read = async () => {
    const timer = setTimeout(() => child.kill(), 10000)
    try {
      const line = await lines.next()
      assert.equal(line.done, false, stderr)
      const value = JSON.parse(line.value!)
      assert.equal(value.error, undefined, value.error)
      return value
    } finally { clearTimeout(timer) }
  }
  let snapshot = (await read()).ready
  const updates = new Map<string, string>()
  const accept = async (value: any) => {
    snapshot = value
    core.recordEnvironmentObservation(value.observation)
    for (const event of value.events) {
      if (event.type === 'environment.feedback') core.recordEnvironmentActionResult(event.feedback)
      if (event.type === 'environment.action.update.result') {
        const requestId = updates.get(`${event.actionId}:${event.revision}`)
        assert.ok(requestId, 'An update reply must belong to a test-dispatched control request')
        core.recordEnvironmentActionResult({ id: `update:${requestId}:${event.status}`, timestamp: event.timestamp,
          type: event.status === 'acknowledged' ? 'completed' : event.status === 'outcome_unknown' ? 'outcome_unknown' : 'rejected',
          actionId: requestId, message: event.message, data: { movementUpdate: event } })
      }
      if (event.type === 'environment.telemetry' && event.telemetry?.locomotionMeasurement)
        await core.recordEnvironmentLocomotionMeasurement(value.observation.sessionId, event.telemetry.locomotionMeasurement,
          async input => manager.enqueue(input), username)
    }
    return value
  }
  return {
    get snapshot() { return snapshot },
    async request(op: string, fields: Record<string, unknown> = {}) {
      if (op === 'update') {
        const action = fields.action as EnvironmentCommandWork
        const update = action.movementUpdate!
        const owner = snapshot.observation.state.activeMovementUpdates
        updates.set(`${update.actionId}:${update.revision}`, action.id)
        fields = { update: { type: 'environment.action.update', version: 1, sessionId: action.sessionId,
          gatewayInstance: owner.gatewayInstance, robotId: owner.robotId, epoch: owner.epoch,
          actionId: update.actionId, bodyLease: action.bodyLease, revision: update.revision,
          validForMs: owner.maxValidityMs, controls: update.controls } }
      }
      child.stdin.write(JSON.stringify({ id: randomUUID(), op, ...fields }) + '\n')
      return accept((await read()).result)
    },
    async close() { child.stdin.end(); await new Promise<void>(resolve => child.once('exit', () => resolve())) },
  }
}

async function acknowledgeControls(f: ReturnType<typeof fixture>, body: Awaited<ReturnType<typeof simulatedBody>>, executionId: string) {
  for (const action of f.received.splice(0)) {
    assert.ok(action.movementUpdate, 'Only steering updates may remain after the original gait starts')
    await body.request('update', { action })
    await body.request('complete', { sequence: body.snapshot.wire.at(-1).seq, kind: 'ack' })
    await body.request('state')
    await f.run(executionId)
  }
  assert.equal(f.received.length, 0, 'Acknowledged unchanged controls do not generate another update')
}

const physicalRoute = {"needsResponse": false, "needsAction": true, "taskContext": ["environment"], "conversationContext": []}
const wave = { kind: 'action', action: { type: 'robotCommand', command: 'wave' } }
const turnGoal = { type: 'move', direction: 'left', continuous: true, durationMs: 0, speed: 40, locomotionGoal: { kind: 'relativeTurn', degrees: 90, tolerance: 2 } }

// The input enters the actual Environment routing graph twice, then the current
// owner combines both turns in its finite interpreter and adopts the new program.
async function interpretedProgram(body: Awaited<ReturnType<typeof simulatedBody>>, next: object) {
  const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
  replies.push(physicalRoute, { program: { steps: [wave] }, taskDecision: decision })
  const initial = await f.run()
  const id = initial.executionId!
  const bootstrap = f.received.shift()!
  await body.request('action', { action: bootstrap })
  await body.request('complete', { actionId: bootstrap.id })
  for (const userMessage of ['Wave again.', 'Then carry out the second instruction.']) {
    replies.push({"needsResponse": false, "needsAction": true, "taskContext": ["environment", "executionContext"], "conversationContext": []}, { program: null, taskDecision: null,
      executionDisposition: 'steer', targetExecutionId: id })
    assert.equal((await f.run(undefined, { userMessage })).status, 'completed')
  }
  await f.run(id)
  const work = queuedInterpretation(id)
  assert.deepEqual(work.input.turns.map((turn: any) => turn.userMessage), ['Wave again.', 'Then carry out the second instruction.'])
  replies.push(physicalRoute, { program: { steps: [wave, { kind: 'action', action: next }] }, taskDecision: decision })
  await executeWork(work)
  await f.run(id)
  const command = f.received.shift()!
  assert.equal(command.command, 'wave')
  assert.deepEqual(command.metadata?.interpretationBody, body.snapshot.receipts[bootstrap.id].data.interpretationBody)
  await body.request('action', { action: command })
  await body.request('complete', { actionId: command.id })
  return { f, id, command }
}

for (const next of [{ type: 'stop' }, turnGoal]) {
  for (const takeover of ['none', 'manual', 'manual-reconnect'] as const) {
    test(`paired interpreted wave -> ${takeover} -> ${next.type} preserves program ownership through recovered checkpoints`, async () => {
      await withUserContext({ username, userId: username, role: 'owner' }, async () => {
        const body = await simulatedBody()
        await body.request('measurement', { measurement: { yaw: { degrees: 0 } } })
        let f: ReturnType<typeof fixture> | undefined
        let id: string | undefined
        try {
          const started = await interpretedProgram(body, next)
          f = started.f; id = started.id
          const ownedFence = body.snapshot.receipts[started.command.id].data.interpretationBody
          if (takeover !== 'none') await body.request('manual')
          if (takeover === 'manual-reconnect') { await body.request('recover'); await body.request('reconnect') }
          const before = body.snapshot.wire.length
          // f.run reopens SQLite and resumes the durable child checkpoint.
          await f.run(id)
          const later = f.received.shift()!
          assert.equal(later.type, next.type)
          await body.request('action', { action: later })
          if (takeover === 'none') {
            assert.deepEqual(later.metadata?.interpretationBody, ownedFence)
            assert.equal(body.snapshot.wire.length, before + 1)
            if (later.type === 'move') {
              await body.request('complete', { actionId: later.id, kind: 'ack' })
              await body.request('measurement', { measurement: { yaw: { degrees: 90 } } })
              await f.run(id)
              const finish = f.received.shift()!
              assert.equal(finish.movementUpdate?.controls.speed, 0)
              await body.request('update', { action: finish })
              await body.request('complete', { sequence: body.snapshot.wire.at(-1).seq, kind: 'ack' })
              await body.request('state')
              await f.run(id)
              const pending = openExecutionStore(username)
              try { assert.notEqual(pending.get(id).status, 'completed') } finally { pending.close() }
            }
            await body.request('complete', { actionId: later.id })
            replies.push({ outcome: 'complete', objective: decision.objective, completionCriteria: decision.completionCriteria, requiredCompletionBasis: 'action_result',
              observationSummary: 'The selected program has terminal receipts.', completionEvidence: 'The selected goal and requested actions completed.', reason: 'Measured goal evidence and original gait termination returned.' })
            assert.equal((await f.run(id)).status, 'completed')
            assert.equal(body.snapshot.receipts[later.id].type, 'completed')
          } else {
            assert.equal(body.snapshot.wire.length, before, 'Neither old Stop nor old movement reaches the body')
            assert.deepEqual(later.metadata?.interpretationBody, ownedFence)
            assert.notEqual(body.snapshot.receipts[later.id].type, 'completed')
            assert.match(body.snapshot.receipts[later.id].message, /ended body owner or session/)
            const store = openExecutionStore(username)
            try { store.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { store.close() }
          }
        } finally { f?.unsubscribe(); await body.close() }
      })
    })
  }
}

for (const disposition of ['cancel', 'steer'] as const) {
  test(`paired spoken Stop routed as ${disposition} reaches cancellation without claiming the original gait stopped`, async () => {
    await withUserContext({ username, userId: username, role: 'owner' }, async () => {
      const body = await simulatedBody()
        await body.request('measurement', { measurement: { yaw: { degrees: 0 } } })
      const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
      try {
        const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../sessions.js')
        const { getUserByUsername } = await import('../users.js')
        const { recoverDurableExecutions } = await import('../durable-execution/recovery.js')
        beginAuthenticatedRuntime()
        selectAuthenticatedSession(createSession(getUserByUsername(username)!.id, 'owner').id)
        replies.push(physicalRoute, { program: { steps: [{ kind: 'action',
          action: turnGoal }] }, taskDecision: decision })
        const initial = await f.run(); const id = initial.executionId!
        const motion = f.received.shift()!
        await body.request('action', { action: motion })
        await body.request('complete', { actionId: motion.id, kind: 'ack' })
        await f.run(id)
        await acknowledgeControls(f, body, id)
        const beforeStop = body.snapshot.wire.length
        replies.push({"needsResponse": false, "needsAction": true, "taskContext": ["environment", "executionContext"], "conversationContext": []}, { program: null, taskDecision: null,
          executionDisposition: disposition, targetExecutionId: id })
        await f.run(undefined, { userMessage: 'Stop what you are doing' })
        const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
        if (disposition === 'cancel') {
          // This is the normal Coordinator recovery/reconciliation owner, not
          // a direct emergency-stop call or a test-issued body command.
          await recoverDurableExecutions(manager, 30)
          const cancellation = core.pendingEnvironmentCancellations(f.observation.sessionId).find(item => item.actionId === motion.id)
          assert.ok(cancellation)
          await body.request('cancel', { cancellation })
          await body.request('complete', { sequence: body.snapshot.wire.at(-1).seq, kind: 'ack' })
          await body.request('state', { wait: .1 })
          assert.equal(body.snapshot.receipts[motion.id].type, 'outcome_unknown')
          const store = openExecutionStore(username)
          try {
            assert.equal(store.get(id).status, 'cancelled')
            assert.equal(store.dispatch(owned.durable!.effectId).status, 'outcome_unknown')
          } finally { store.close() }
        } else {
          // Reproduce the recorded first-selector steer choice. The owning
          // interpreter now receives the same text and selects semantic Stop.
          await f.run(id)
          const pending = queuedInterpretation(id)
          assert.equal(pending.input.turns[0].userMessage, 'Stop what you are doing')
          replies.push(physicalRoute, { program: { steps: [{ kind: 'action', action: { type: 'stop' } }] },
            taskDecision: { ...decision, objective: 'Stop the current motion', completionCriteria: 'Stop command completes' } })
          await executeWork(pending); await f.run(id)
          const stop = f.received.shift()!
          assert.equal(stop.type, 'stop')
          await body.request('action', { action: stop })
          await body.request('complete', { actionId: stop.id })
          // This fixture selected bounded review. Confirm its evidence without
          // confusing the Stop acknowledgement with a gait terminal receipt.
          replies.push(() => {
            const review = JSON.parse(calls.at(-1).messages.at(-1).content)
            assert.equal(review.execution.task.feedback.actionId, stop.id)
            assert.equal(review.execution.task.feedback.type, 'completed')
            assert.ok(review.execution.events.some((event: any) => event.actionId === motion.id
              && event.payload?.feedback?.type === 'accepted'))
            assert.equal(review.execution.events.some((event: any) => event.actionId === motion.id
              && ['completed', 'cancelled'].includes(event.payload?.feedback?.type)), false)
            return { outcome: 'complete', objective: 'Stop the current motion', completionCriteria: 'Stop command completes', reason: 'The selected Stop command has an acknowledgement.',
              requiredCompletionBasis: 'action_result', observationSummary: 'The original gait outcome remains unresolved.',
              completionEvidence: `Stop command ${stop.id} acknowledged; this does not establish the original gait outcome.` }
          })
          assert.equal((await f.run(id)).status, 'waiting', 'Original unresolved gait keeps the execution waiting')
          assert.equal(body.snapshot.receipts[stop.id].type, 'completed')
          assert.equal(body.snapshot.receipts[motion.id].type, 'accepted', 'Stop receipt is not the original gait terminal receipt')
          const store = openExecutionStore(username)
          try { assert.equal(store.dispatch(owned.durable!.effectId).status, 'accepted') } finally { store.close() }
        }
        assert.equal(body.snapshot.wire.length, beforeStop + 1, 'Exactly one stop follows the acknowledged motion and steering update; no emergency API is invoked')
        await body.request('complete', { actionId: motion.id, kind: 'cancelled' })
        assert.equal(body.snapshot.receipts[motion.id].type, 'cancelled')
        const settled = openExecutionStore(username)
        try {
          assert.equal(settled.dispatch(owned.durable!.effectId).status, 'completed')
          assert.equal(settled.events(id).filter(event => event.kind === 'physical_result'
            && event.actionId === motion.id && (event.payload as any).feedback.type === 'cancelled').length, 1)
        } finally { settled.close() }
        if (disposition === 'steer') assert.equal((await f.run(id)).status, 'completed')
        assert.equal(f.received.length, 0, 'Late original reconciliation cannot start another movement')
      } finally { f.unsubscribe(); await body.close() }
    })
  })
}

test('paired manual takeover invalidates a still-pending provider and its late Stop proposal', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const body = await simulatedBody()
        await body.request('measurement', { measurement: { yaw: { degrees: 0 } } })
    const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { entered = resolve })
    let worker: Promise<void> | undefined
    let returned = false
    try {
      replies.push(physicalRoute, { program: { steps: [{ kind: 'action',
        action: turnGoal }] }, taskDecision: decision })
      const started = await f.run(); const id = started.executionId!
      const motion = f.received.shift()!
      await body.request('action', { action: motion })
      await body.request('complete', { actionId: motion.id, kind: 'ack' }); await f.run(id)
      await acknowledgeControls(f, body, id)
        const beforeStop = body.snapshot.wire.length
      replies.push({"needsResponse": false, "needsAction": true, "taskContext": ["environment", "executionContext"], "conversationContext": []}, { program: null, taskDecision: null,
        executionDisposition: 'steer', targetExecutionId: id })
      await f.run(undefined, { userMessage: 'Stop what you are doing' })
      await f.run(id)
      replies.push(async () => { entered(); await blocked; returned = true; return physicalRoute })
      const pending = queuedInterpretation(id)
      worker = executeWork(pending); await reached
      await body.request('manual')
      await body.request('complete', { actionId: motion.id, kind: 'cancelled' })
      await f.run(id)
      await worker
      assert.equal(returned, false, 'Provider remains pending after local cancellation releases its slot')
      assert.equal(manager.getTask(pending.id)?.state, 'cancelled')
      assert.equal(f.received.length, 0)
      const store = openExecutionStore(username)
      try {
        store.deliverEvent(id, { eventId: randomUUID(), kind: 'work_result', payload: {
          effectId: pending.durable!.effectId, result: { state: 'completed', result: { ...pending.input.identity,
            route: physicalRoute, response: JSON.stringify({ program: { steps: [{ kind: 'action', action: { type: 'stop' } }] }, taskDecision: decision }) } },
        } })
      } finally { store.close() }
      release(); await new Promise(resolve => setImmediate(resolve))
      await f.run(id)
      assert.equal(f.received.length, 0, 'Even a late queued proposal cannot override manual control')
      assert.equal(body.snapshot.wire.length, beforeStop + 1, 'Manual takeover adds only its stop; late proposals add no command')
      const settled = openExecutionStore(username)
      try { settled.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { settled.close() }
    } finally { release?.(); await worker; f.unsubscribe(); await body.close() }
  })
})


test('paired lost terminal receipt and cancellation settle on authenticated reconnect without replaying motion', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const body = await simulatedBody()
        await body.request('measurement', { measurement: { yaw: { degrees: 0 } } })
    const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
    try {
      replies.push(physicalRoute, { program: { steps: [{ kind: 'action',
        action: turnGoal }] }, taskDecision: decision })
      const initial = await f.run(); const id = initial.executionId!
      const motion = f.received.shift()!
      await body.request('action', { action: motion })
      await body.request('complete', { actionId: motion.id, kind: 'ack' })
      const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
      const store = openExecutionStore(username)
      try { store.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { store.close() }
      manager.cancel(owned.id, 'User cancelled the old task')
      const cancellation = core.pendingEnvironmentCancellations(f.observation.sessionId).find(item => item.actionId === motion.id)!
      assert.ok(cancellation)
      await body.request('cancel', { cancellation })
      await body.request('complete', { sequence: body.snapshot.wire.at(-1).seq, kind: 'ack' })
      await body.request('state', { wait: .1 })
      assert.equal(owned.state, 'waiting')
      const unknown = body.snapshot.receipts[motion.id]
      assert.equal(unknown.type, 'outcome_unknown')
      assert.notEqual(unknown.data.executionEnded, true)
      replies.push(physicalRoute, { program: { steps: [wave] }, taskDecision: decision })
      const next = await f.run(undefined, { userMessage: 'Please wave' })
      assert.equal(f.received.length, 0, 'The original command is still unresolved before reconnection')
      await body.request('reconnect')
      const ended = body.snapshot.receipts[motion.id]
      assert.equal(ended.type, 'outcome_unknown')
      assert.equal(ended.data.executionEnded, true)
      assert.equal(ended.data.priorOutcome.id, unknown.id)
      assert.equal(owned.state, 'failed')
      assert.equal(manager.hasCurrentBodyLease(owned.id), false)
      const settled = openExecutionStore(username)
      try {
        assert.equal(settled.get(id).status, 'cancelled')
        assert.equal(settled.dispatch(owned.durable!.effectId).status, 'completed')
        assert.equal((settled.findEvent(id, unknown.id)!.payload as any).feedback.type, 'outcome_unknown')
        assert.equal((settled.findEvent(id, ended.id)!.payload as any).feedback.type, 'outcome_unknown')
        assert.equal(settled.events(id).some(event => event.actionId === motion.id
          && (event.payload as any)?.feedback?.type === 'completed'), false)
      } finally { settled.close() }
      core.recordEnvironmentActionResult(ended)
      const replayed = openExecutionStore(username)
      try {
        assert.equal(replayed.events(id).filter(event => event.eventId === ended.id).length, 1)
        assert.equal(replayed.dispatch(owned.durable!.effectId).status, 'completed')
      } finally { replayed.close() }
      const replacement = f.received.shift() ?? core.dispatchEnvironmentActions(f.observation.sessionId, 10)[0]
      assert.equal(replacement.command, 'wave')
      assert.equal(body.snapshot.wire.length, 2, 'Reconnection sends no automatic motion or stop')
      await body.request('action', { action: replacement })
      await body.request('complete', { actionId: replacement.id })
      assert.equal(body.snapshot.wire.length, 3)
      const lateSession = { ...ended, actionId: replacement.id, id: `${replacement.id}-session-ended` }
      core.recordEnvironmentActionResult(lateSession)
      const afterCompleted = openExecutionStore(username)
      try {
        assert.equal(afterCompleted.findEvent(next.executionId!, lateSession.id)?.kind, 'delivery_result')
        const results = afterCompleted.events(next.executionId!).filter(event => event.kind === 'physical_result'
          && event.actionId === replacement.id)
        assert.equal((results.at(-1)!.payload as any).feedback.type, 'completed')
      } finally { afterCompleted.close() }
      await body.request('recover')
      assert.equal(body.snapshot.wire.length, 3, 'Recovery cannot replay either command')
      const late = { ...ended, id: `${ended.id}-late`, type: 'cancelled' as const,
        message: 'Original body cancellation receipt recovered', data: { sequence: ended.data.sequence, epoch: ended.data.epoch } }
      core.recordEnvironmentActionResult(late)
      const reconciled = openExecutionStore(username)
      try {
        assert.equal(reconciled.findEvent(id, late.id)?.parentEventId, ended.id)
        assert.equal((reconciled.findEvent(id, ended.id)!.payload as any).feedback.type, 'outcome_unknown')
      } finally { reconciled.close() }
      assert.equal(f.received.length, 0)
      const cleanup = openExecutionStore(username)
      try { cleanup.cancel(next.executionId!, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { cleanup.close() }
    } finally { f.unsubscribe(); await body.close() }
  })
})


test('speech and movement release only their own ended execution and retain unknown results', async () => {
  const { UnifiedQueueManager } = await import('../queue/unified-queue-manager.js')
  const sessionId = `channels-${randomUUID()}`
  const enqueue = (type: string) => manager.enqueue({ type: 'environment_command', handler: 'environment.command',
    resource: `${type}:${sessionId}`, source: 'environment', username,
    input: { id: randomUUID(), sessionId, type, command: type === 'robotCommand' ? 'wave' : undefined } })
  const movement = enqueue('robotCommand'), speech = enqueue('speak')
  assert.ok(manager.claim(movement.id)); assert.ok(manager.claim(speech.id))
  const nextMovement = enqueue('robotCommand'), nextSpeech = enqueue('speak')
  const feedback = (task: typeof speech, ended = false) => core.recordEnvironmentActionResult({
    id: randomUUID(), actionId: task.input.id, type: 'outcome_unknown', timestamp: new Date().toISOString(),
    message: ended ? 'Session ended; physical outcome remains unknown' : 'Disconnected',
    ...(ended ? { data: { executionEnded: true } } : {}),
  })
  feedback(movement); feedback(speech)
  assert.equal(manager.claim(nextMovement.id), null); assert.equal(manager.claim(nextSpeech.id), null)
  feedback(speech, true)
  assert.equal(speech.state, 'failed'); assert.equal(speech.error?.code, 'outcome_unknown')
  assert.ok(manager.claim(nextSpeech.id)); assert.equal(manager.claim(nextMovement.id), null)
  feedback(movement, true)
  assert.equal(movement.state, 'failed'); assert.equal(movement.error?.code, 'outcome_unknown')
  assert.ok(manager.claim(nextMovement.id))
  manager.cancel(nextMovement.id); manager.acknowledgeCancellation(nextMovement.id)
  manager.cancel(nextSpeech.id); manager.acknowledgeCancellation(nextSpeech.id)
  const restarted = new UnifiedQueueManager()
  restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.equal(restarted.getTask(movement.id)?.state, 'failed')
  assert.equal(restarted.getTask(speech.id)?.state, 'failed')
  assert.equal(restarted.hasCurrentBodyLease(movement.id), false)
  assert.equal(restarted.hasCurrentBodyLease(speech.id), false)
})
