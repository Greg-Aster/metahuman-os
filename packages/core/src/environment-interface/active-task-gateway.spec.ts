/** Paired software qualification. Requires the sibling gateway test harness;
 * includes the existing graph/Coordinator suite whose fixture is reused here. */
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
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
  const accept = (value: any) => {
    snapshot = value
    core.recordEnvironmentObservation(value.observation)
    for (const event of value.events) if (event.type === 'environment.feedback') core.recordEnvironmentActionResult(event.feedback)
    return value
  }
  return {
    get snapshot() { return snapshot },
    async request(op: string, fields: Record<string, unknown> = {}) {
      child.stdin.write(JSON.stringify({ id: randomUUID(), op, ...fields }) + '\n')
      return accept((await read()).result)
    },
    async close() { child.stdin.end(); await new Promise<void>(resolve => child.once('exit', () => resolve())) },
  }
}

const physicalRoute = {"needsResponse": false, "needsAction": true, "taskContext": ["environment"], "conversationContext": []}
const wave = { kind: 'action', action: { type: 'robotCommand', command: 'wave' } }

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

for (const next of [{ type: 'stop' }, { type: 'move', direction: 'forward', durationMs: 500, speed: 40 }]) {
  for (const takeover of ['none', 'manual', 'manual-reconnect'] as const) {
    test(`paired interpreted wave -> ${takeover} -> ${next.type} preserves program ownership through recovered checkpoints`, async () => {
      await withUserContext({ username, userId: username, role: 'owner' }, async () => {
        const body = await simulatedBody()
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
            await body.request('complete', { actionId: later.id })
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
      const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
      try {
        const { beginAuthenticatedRuntime, createSession, selectAuthenticatedSession } = await import('../sessions.js')
        const { getUserByUsername } = await import('../users.js')
        const { recoverDurableExecutions } = await import('../durable-execution/recovery.js')
        beginAuthenticatedRuntime()
        selectAuthenticatedSession(createSession(getUserByUsername(username)!.id, 'owner').id)
        replies.push(physicalRoute, { program: { steps: [{ kind: 'action',
          action: { type: 'robotCommand', command: 'run', continuous: true } }] }, taskDecision: decision })
        const initial = await f.run(); const id = initial.executionId!
        const motion = f.received.shift()!
        await body.request('action', { action: motion })
        await body.request('complete', { actionId: motion.id, kind: 'ack' })
        await f.run(id)
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
          assert.equal((await f.run(id)).status, 'waiting', 'Original unresolved gait keeps the execution waiting')
          assert.equal(body.snapshot.receipts[stop.id].type, 'completed')
          assert.equal(body.snapshot.receipts[motion.id].type, 'accepted', 'Stop receipt is not the original gait terminal receipt')
          const store = openExecutionStore(username)
          try { assert.equal(store.dispatch(owned.durable!.effectId).status, 'accepted') } finally { store.close() }
        }
        assert.equal(body.snapshot.wire.length, 2, 'One motion followed by exactly one stop; no emergency API is invoked')
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
    const f = fixture(body.snapshot.observation.sessionId, false, body.snapshot.observation)
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { entered = resolve })
    let worker: Promise<void> | undefined
    let returned = false
    try {
      replies.push(physicalRoute, { program: { steps: [{ kind: 'action',
        action: { type: 'robotCommand', command: 'run', continuous: true } }] }, taskDecision: decision })
      const started = await f.run(); const id = started.executionId!
      const motion = f.received.shift()!
      await body.request('action', { action: motion })
      await body.request('complete', { actionId: motion.id, kind: 'ack' }); await f.run(id)
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
      assert.equal(body.snapshot.wire.length, 2)
      const settled = openExecutionStore(username)
      try { settled.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { settled.close() }
    } finally { release?.(); await worker; f.unsubscribe(); await body.close() }
  })
})
