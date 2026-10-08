/** Opt-in recorded-image qualification using existing Core/Coordinator and gateway owners. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fixture, route, decision, replies, core, manager, username, withUserContext,
  openExecutionStore, queuedInterpretation, executeWork, instruction } from './active-task.spec.js'

for (const ending of ['expiry-confirmed', 'expiry-unknown', 'explicit-cancel'] as const) test(`recorded YOLO frames: ${ending}`, { timeout: 90000 }, async () => {
  assert.ok(process.env.AINEKIO_SOFTWARE_TEST_GATEWAY)
  assert.ok(process.env.AINEKIO_SOFTWARE_TEST_PYTHON)
  assert.ok(process.env.AINEKIO_YOLO_WEIGHTS && process.env.AINEKIO_RECORDED_IMAGE,
    'This opt-in qualification requires explicitly selected local weights and a public/approved recording')
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const artifacts = path.join(process.env.AINEKIO_PERCEPTION_ARTIFACTS!, ending)
    fs.mkdirSync(artifacts, { recursive: true })
    const child = spawn(process.env.AINEKIO_SOFTWARE_TEST_PYTHON!, ['-u', '-m', 'Emulator.tests.perception_harness'], {
      cwd: process.env.AINEKIO_SOFTWARE_TEST_GATEWAY, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '.:Master:Slave/software:Emulator:Emulator/tests',
        AINEKIO_TEST_SESSION: `recorded-perception-${randomUUID()}`, CUDA_VISIBLE_DEVICES: '',
        YOLO_OFFLINE: 'true', YOLO_AUTOINSTALL: 'false', ULTRALYTICS_AUTOINSTALL: 'false', OMP_NUM_THREADS: '4', AINEKIO_PERCEPTION_ARTIFACTS: artifacts },
    })
    let stderr = ''
    child.stderr.on('data', value => { stderr += value })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const read = async () => {
      const timer = setTimeout(() => child.kill(), 80000)
      try {
        const line = await lines.next(); assert.equal(line.done, false, stderr)
        const value = JSON.parse(line.value!); assert.equal(value.error, undefined, value.error); return value
      } finally { clearTimeout(timer) }
    }
    const ready = await read()
    assert.deepEqual(ready.classes, { 0: 'person' }, 'Report the evaluated checkpoint class set honestly')
    const f = fixture(ready.ready.observation.sessionId, false, ready.ready.observation)
    const evidence: any = { ending, recognition: { ...ready, ready: undefined }, startedAt: Date.now(), source: 'recorded public image; offline CPU YOLO; synthetic body and scripted instruction selection', frames: [], commands: [] }
    let id: string | undefined, release: (() => void) | undefined, worker: Promise<void> | undefined
    let speechRelease: (() => void) | undefined, speechWorker: Promise<void> | undefined, speechJob: any, interpretation: any
    const request = async (op: string, fields: Record<string, any> = {}) => {
      child.stdin.write(JSON.stringify({ op, ...fields }) + '\n')
      const snapshot = (await read()).result
      core.recordEnvironmentObservation(snapshot.observation)
      for (const event of snapshot.events) {
        if (event.type === 'environment.feedback') core.recordEnvironmentActionResult(event.feedback)
        if (event.type === 'environment.telemetry' && event.telemetry.kind === 'vision.recognition') {
          const perception = event.telemetry.perception
          assert.equal(await core.recordEnvironmentPerception(snapshot.observation.sessionId, perception,
            async input => manager.enqueue(input)), true)
          evidence.frames.push({ counter: perception.frameCounter, objects: perception.objects,
            observedAt: perception.observedAt, expiresAt: perception.expiresAt, receivedAt: Date.now(),
            observationAgeMs: Date.now() - Date.parse(perception.observedAt), processing: event.telemetry.processing })
        }
        if (event.type === 'environment.action.update.result') {
          assert.equal(event.actionId, fields.action.movementUpdate.actionId)
          assert.equal(event.revision, fields.action.movementUpdate.revision)
          assert.equal(event.status, 'acknowledged', JSON.stringify(event))
          core.recordEnvironmentActionResult({ id: `update:${fields.action.id}:${event.status}`,
            actionId: fields.action.id, type: 'completed', timestamp: event.timestamp,
            message: event.message, data: { movementUpdate: event } })
        }
      }
      return snapshot
    }
    const flushCommands = async () => {
      // Reconcile each ACK before inspecting the newest desired controls.
      for (let receipt = 0; receipt < 3 && f.received.length; receipt++) {
        for (const action of f.received.splice(0)) {
          assert.ok(action.movementUpdate, 'Perception must update the original motion, never create another gait')
          const snapshot = await request('action', { action })
          evidence.commands.push({ at: Date.now(), frameCounter: evidence.frames.at(-1)?.counter, action, wire: snapshot.wire.at(-1),
            frameToCommandMs: Date.now() - Date.parse(evidence.frames.at(-1).observedAt) })
        }
        await f.run(id)
      }
      assert.equal(f.received.length, 0, 'Steering must settle without an unbounded test-driver loop')
    }
    try {
      await request('frame', { counter: 1, position: 'left' })
      const behavior = { kind: 'behavior', target: 'the single visible person in the recorded replay', completionCriteria: 'Continue until explicitly changed.',
        motion: { type: 'move', continuous: true, direction: 'forward', speed: 40, forward: 60, turn: 0 },
        candidateLabels: ['person'], identifyEveryFrames: 100, steering: { label: 'person', gain: 100 } }
      replies.push({ ...route, needsVision: false, needsResponse: true }, { program: { steps: [behavior] }, taskDecision: { ...decision,
        objective: 'Continuously follow the image position of the visible person.', completionCriteria: 'Continue until cancelled; detector presence does not complete the objective.' } })
      id = (await f.run()).executionId!
      const motion = f.received.shift()!
      assert.equal(motion.continuous, true)
      const admission = await request('action', { action: motion })
      assert.ok(admission.wire.length, JSON.stringify({ motion, receipt: admission.receipts[motion.id] }))
      await request('complete', { actionId: motion.id, kind: 'ack' })
      // A correlated still may be selected by the existing behavior's identify
      // phase. Leave that request pending; this trial sends no image to an LLM.
      f.received.splice(0).forEach(action => assert.equal(action.type, 'captureImage'))
      await f.run(id); await flushCommands()
      // Real production conversation work, with only provider completion held.
      speechJob = manager.getAllTasks().find(task => task.handler === 'environment.conversation' && task.durable?.executionId === id && task.state === 'queued')
      assert.ok(speechJob)
      let speechEntered!: () => void
      const speechStarted = new Promise<void>(resolve => { speechEntered = resolve })
      const speechBlocked = new Promise<void>(resolve => { speechRelease = resolve })
      replies.push(async () => { speechEntered(); await speechBlocked; return 'Delayed description.' })
      speechWorker = executeWork(speechJob); await Promise.race([speechStarted, speechWorker.then(() => { throw new Error('Conversation ended before entering provider') })])
      evidence.speechStartedAt = Date.now()
      instruction(id, f.observation.sessionId, 'Describe your progress while continuing.')
      await f.run(id)
      let entered!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      const blocked = new Promise<void>(resolve => { release = resolve })
      replies.push(async () => { entered(); await blocked; return { ...route, needsVision: false } })
      interpretation = queuedInterpretation(id)
      worker = executeWork(interpretation); await Promise.race([started, worker.then(() => { throw new Error('Interpretation ended before entering provider') })])
      evidence.interpretationStartedAt = Date.now()
      for (const [counter, position] of [[2, 'center'], [3, 'right'], [4, 'left'], [5, 'right'], [6, 'lost']] as const) {
        await request('frame', { counter, position })
        assert.equal(manager.getTask(interpretation.id)?.state, 'leased')
        assert.equal(manager.getTask(speechJob.id)?.state, 'leased')
        await f.run(id); await flushCommands()
      }
      assert.deepEqual(evidence.frames.at(-1).objects, [], 'Target loss is a real detector result')
      assert.equal(evidence.commands.at(-1).action.movementUpdate.controls.turn, 0, 'Fresh target loss returns to the selected base controls')
      evidence.targetLossResponseMs = evidence.commands.at(-1).frameToCommandMs
      const turns = evidence.commands.map((item: any) => item.action.movementUpdate.controls.turn)
      assert.ok(turns.some((value: number) => value > 0) && turns.some((value: number) => value < 0),
        'Actual detected boxes on both sides must produce opposite steering corrections')
      assert.ok(evidence.commands.every((item: any) => item.action.movementUpdate.actionId === motion.id))
      const frameCount = evidence.frames.length
      const stale = await request('frame', { counter: 7, position: 'left', ageSeconds: 2 })
      assert.equal(evidence.frames.length, frameCount, 'Expired recorded frames never become behavior observations')
      assert.equal(stale.processing.staleFrames, 1)
      const owned = manager.findTask(task => task.input?.id === motion.id)!
      if (ending === 'explicit-cancel') {
        evidence.cancelRequestedAt = Date.now()
        manager.cancel(owned.id, 'Operator requested cancellation in isolated visual demo')
      }
      // Fresh frames deliberately retain an earlier wake; that wake can
      // schedule the current frame's expiry without creating per-frame timers.
      for (let wake = 0; wake < 3 && !manager.findTask(task => task.input?.id === motion.id)?.cancellationRequestedAt; wake++) {
        const deadline = manager.getAllTasks().find(task => task.handler === 'environment.active-task-deadline'
          && task.durable?.executionId === id && task.state === 'queued')!
        assert.ok(deadline)
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(deadline.notBefore!) - Date.now() + 10)))
        await executeWork(deadline); await f.run(id)
      }
      assert.ok(manager.findTask(task => task.input?.id === motion.id)?.cancellationRequestedAt,
        'Loss of required recognition still requests owned termination while interpretation is blocked')
      evidence.deadlineRequestedCancellation = ending !== 'explicit-cancel'
      evidence.cancelRequestedAt ??= Date.now()
      evidence.expiryToCancellationMs = evidence.cancelRequestedAt - Date.parse(evidence.frames.at(-1).expiresAt)
      evidence.pendingAtCancellation = { interpretation: manager.getTask(interpretation.id)?.state, conversation: manager.getTask(speechJob.id)?.state }
      assert.deepEqual(evidence.pendingAtCancellation, { interpretation: 'leased', conversation: 'leased' })
      evidence.lastMetrics = stale.processing
      const cancellation = core.pendingEnvironmentCancellations(f.observation.sessionId).find(item => item.actionId === motion.id)
      assert.ok(cancellation)
      const sent = await request('cancel', { cancellation })
      evidence.stopSentAt = Date.now()
      const stop = sent.wire.at(-1)
      assert.equal(stop.t, 'stop')
      await request('complete', { sequence: stop.seq, kind: 'ack' })
      if (ending !== 'expiry-unknown') await request('complete', { actionId: motion.id, kind: 'cancelled', fields: { code: 'stop' } })
      if (ending === 'expiry-unknown') await new Promise(resolve => setTimeout(resolve, 2100))
      const ended = await request('state', { wait: .1 })
      assert.equal(ended.wire.filter((command: any) => command.t === 'stop').length, 1)
      assert.equal(ended.receipts[motion.id].type, ending === 'expiry-unknown' ? 'outcome_unknown' : 'cancelled')
      assert.equal(ended.receipts[motion.id].actionId, motion.id)
      evidence.resultAt = Date.parse(ended.receipts[motion.id].timestamp)
      evidence.resultObservedAt = Date.now()
      evidence.cancelToResultMs = evidence.resultAt - evidence.cancelRequestedAt
      evidence.bodyWire = ended.wire
      evidence.termination = ended.receipts[motion.id]
      assert.equal(ended.wire.filter((command: any) => command.name === 'walk' && command.update === undefined).length, 1, 'Exactly one gait admission')
      await f.run(id)
      const settled = openExecutionStore(username)
      try { evidence.coreTask = settled.task(id); assert.equal(evidence.coreTask.actionStatus, ended.receipts[motion.id].type); assert.notEqual(evidence.coreTask.decision.objectiveComplete, true) } finally { settled.close() }
      evidence.completed = true
    } finally {
      if (id) {
        const store = openExecutionStore(username)
        try { store.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) }
        finally { store.close() }
      }
      for (const job of [speechJob, interpretation]) if (job) manager.cancel(job.id, 'Isolated trial ended')
      release?.(); speechRelease?.(); await Promise.all([worker, speechWorker])
      replies.length = 0
      if (evidence.completed) {
        evidence.lateJobStates = [speechJob, interpretation].map(job => manager.getTask(job.id)?.state)
        assert.deepEqual(evidence.lateJobStates, ['cancelled', 'cancelled'])
        const late = await request('state')
        assert.deepEqual(late.wire, evidence.bodyWire, 'Late provider completions cannot dispatch another command')
      }
      f.unsubscribe(); child.stdin.end()
      await new Promise<void>(resolve => child.once('exit', () => resolve()))
      fs.writeFileSync(path.join(artifacts, 'trace.json'), JSON.stringify(evidence, null, 2))
    }
  })
})
