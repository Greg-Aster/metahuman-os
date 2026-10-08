import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import type { ActiveTaskState, EnvironmentTaskProgram } from './active-task.js'
import type { EnvironmentFeedback, EnvironmentObservation } from './types.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-task-state-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('State tests prohibit network') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
await import('../index.js')
const { recordEnvironmentObservation } = await import('./store.js')
const { environmentActiveTaskStepNode: step, environmentActiveTaskWaitNode: wait } = await import('../nodes/environment/active-task.node.js')
after(() => fs.rmSync(root, { recursive: true, force: true }))

const decision = { outcome: 'act', objective: 'Find the red cup', completionCriteria: 'Identify the red cup in a fresh image',
  requiredCompletionBasis: 'visual_observation', reason: 'Owner request', objectiveComplete: false }
const motion = { type: 'move' as const, continuous: true, direction: 'forward' as const, speed: 60, forward: 80, turn: 20 }
const program: EnvironmentTaskProgram = { steps: [{ kind: 'action', action: motion }] }
const observation: EnvironmentObservation = { environmentId: 'fixture', adapter: 'ainekio-gateway', sessionId: 'state-fixture',
  timestamp: new Date().toISOString(), capabilities: { actions: ['move', 'captureImage', 'stop'] },
  state: { activeMovementUpdates: { version: 1, available: true, gatewayInstance: 'gateway', robotId: 'p4', epoch: 1,
    maxValidityMs: 2000, maxInFlight: 1, controls: ['speed', 'forward', 'turn'] } } }
recordEnvironmentObservation(observation)

function fixture(activeProgram = program) {
  const dispatches: any[] = []
  const statusEffects: any[] = []
  let task: any = null
  const context = { username: 'fixture', activeProgram, activeTaskDecision: decision, activeTaskSessionId: observation.sessionId,
    graphExecution: { executionId: 'execution', occurrenceId: 'occurrence', task: () => task,
      recordTask: (value: unknown) => { task = value }, recordFrames: () => {},
      dispatch: (value: any) => { (value.kind === 'robot_status' ? statusEffects : dispatches).push(value); return { effectId: `effect-${dispatches.length}` } },
      pendingEvents: () => [], waitForEvent: () => { throw new Error('WAIT') } } } as never
  const state: ActiveTaskState = { stepIndex: 0, evidence: [], updateRevision: 0, action: motion, motionId: 'motion', accepted: true }
  const advance = async (value: ActiveTaskState) => (await step.execute({ state: value }, context, {})).state as ActiveTaskState
  const receive = async (value: ActiveTaskState, actionId: string, type: EnvironmentFeedback['type'], data?: Record<string, unknown>) => {
    const feedback: EnvironmentFeedback = { id: `${actionId}-${type}`, actionId, type, message: `Explicit ${type}`, timestamp: new Date().toISOString(), data }
    return (await wait.execute({ state: { ...value, pendingEvents: [{ kind: 'physical_result', actionId, payload: { feedback } }] } }, context, {})).state as ActiveTaskState
  }
  return { state, advance, receive, context, dispatches, statusEffects, task: () => task }
}

test('steering has separate desired, pending and acknowledged controls', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  assert.equal(sent.acknowledgedControls, undefined)
  assert.equal(sent.desiredControls, JSON.stringify({ speed: 60, forward: 80, turn: 20 }))
  assert.equal(sent.pendingControls?.commandId, f.dispatches[0].actionId)
  const acknowledged = await f.receive(sent, sent.pendingControls!.commandId, 'completed')
  assert.equal(acknowledged.acknowledgedControls, sent.desiredControls)
  assert.equal(acknowledged.pendingControls, undefined)
  assert.equal(acknowledged.done, undefined, 'Control acknowledgement cannot complete motion or the goal')
})

test('a terminal motion receipt is projected as physical evidence while its earlier steering receipt is retained', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const acknowledged = await f.receive(sent, sent.pendingControls!.commandId, 'completed')
  const moved = await f.receive(acknowledged, 'motion', 'completed')
  const final = await f.advance(moved)
  assert.equal(final.steeringResult?.actionId, sent.pendingControls!.commandId)
  assert.equal(f.task().actionId, 'motion')
  assert.equal(f.task().feedback.actionId, 'motion', 'Control acceptance must not replace the physical result')
})

test('failed steering is visible without suppressing an explicitly renewed attempt', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const failed = await f.receive(sent, f.dispatches[0].actionId, 'failed')
  assert.equal(failed.steeringResult?.type, 'failed')
  assert.equal(failed.acknowledgedControls, undefined)
  await f.advance(failed)
  assert.equal(f.task().feedback.message, 'Explicit failed')
  assert.equal(f.dispatches.length, 1, 'A failure must not create a tight retry loop')
  const renewed = await f.advance({ ...failed, retrySteering: true })
  assert.equal(f.dispatches.length, 2)
  assert.equal(renewed.pendingControls?.revision, 2)
})

test('unknown or expired delivery blocks steering until its correlated terminal result', async () => {
  for (const type of ['outcome_unknown', 'expired'] as const) {
    const f = fixture()
    const sent = await f.advance(f.state)
    const uncertain = await f.receive(sent, f.dispatches[0].actionId, type)
    assert.equal(uncertain.steeringResult?.type, type)
    if (type === 'outcome_unknown') {
      assert.equal(uncertain.pendingControls?.commandId, f.dispatches[0].actionId)
      await f.advance({ ...uncertain, retrySteering: true })
      assert.equal(f.dispatches.length, 1)
      const reconciled = await f.receive(uncertain, f.dispatches[0].actionId, 'completed')
      assert.equal(reconciled.pendingControls, undefined)
      assert.equal(reconciled.acknowledgedControls, sent.desiredControls)
    }
  }
})

test('new desired controls do not become acknowledged by an older pending reply', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const revisedProgram: EnvironmentTaskProgram = { steps: [{ kind: 'action', action: { ...motion, turn: -30 } }] }
  const revised = fixture(revisedProgram)
  const pending = await revised.advance(sent)
  const acknowledged = await revised.receive(pending, f.dispatches[0].actionId, 'completed')
  assert.notEqual(acknowledged.acknowledgedControls, pending.desiredControls)
  await revised.advance(acknowledged)
  assert.equal(revised.dispatches[0].payload.input.movementUpdate.controls.turn, -30)
  await assert.rejects(() => revised.receive(acknowledged, 'unrelated-command', 'completed'), /WAIT/)
})

test('unsupported steering is an explicit planner result with no dispatch', async () => {
  recordEnvironmentObservation({ ...observation, state: { activeMovementUpdates: { version: 2, available: false } } })
  try {
    const f = fixture()
    const state = await f.advance(f.state)
    assert.equal(f.dispatches.length, 0)
    assert.equal(state.steeringResult?.type, 'rejected')
    assert.match(f.task().feedback.message, /steering.*v1/i)
  } finally { recordEnvironmentObservation(observation) }
})

test('capture receipt alone never satisfies a visual objective', async () => {
  const capture: EnvironmentTaskProgram = { steps: [{ kind: 'action', action: { type: 'captureImage' } }] }
  const f = fixture(capture)
  const state = { ...f.state, action: { type: 'captureImage' as const }, snapshotId: 'motion' }
  const captured = await f.receive(state, 'motion', 'completed')
  assert.equal(captured.stepIndex, 0)
  assert.equal(captured.done, undefined)
  assert.equal(captured.captureCompleted, true)
})

test('cancelled task state cannot consume late results or dispatch more work', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const result = await wait.execute({ state: { ...sent, done: true,
    pendingEvents: [{ kind: 'physical_result', actionId: f.dispatches[0].actionId, payload: { feedback: { type: 'completed' } } }] } }, f.context, {})
  assert.equal(result.continue, false)
  assert.equal(result.state.acknowledgedControls, undefined)
  await f.advance({ ...sent, done: true })
  assert.equal(f.dispatches.length, 1)
})

for (const outcome of ['positive', 'negative', 'ambiguous', 'failed', 'stale'] as const) {
  test(`correlated ${outcome} perception leaves truthful visual task state`, async () => {
    const capture: EnvironmentTaskProgram = { steps: [{ kind: 'action', action: { type: 'captureImage' } }] }
    const f = fixture(capture)
    const evidence = `Remote image evidence: ${outcome}`
    const identification = { matchesTarget: outcome === 'positive', completionSatisfied: outcome === 'positive',
      outcome: outcome === 'positive' ? 'positive' : outcome === 'ambiguous' ? 'ambiguous' : 'negative', description: evidence, evidence }
    const state = { ...f.state, action: { type: 'captureImage' as const }, captureCompleted: true,
      identificationEffectId: 'image-effect', identificationRequest: { effectId: 'image-effect', frameId: 'frame', stepIndex: 0,
        gatewayInstance: 'gateway', epoch: 1, ...(outcome === 'stale' ? { expiresAt: new Date(Date.now() - 1).toISOString() } : {}) },
      pendingEvents: [{ kind: 'work_result', payload: { effectId: 'image-effect', result: outcome === 'failed'
        ? { state: 'failed', error: { message: 'Remote server unavailable' } } : { state: 'completed', result: identification } } }] }
    const received = (await wait.execute({ state }, f.context, {})).state as ActiveTaskState
    const final = await f.advance(received)
    assert.equal(final.objectiveComplete, outcome === 'positive')
    assert.equal(f.task().decision.objectiveComplete, outcome === 'positive')
    assert.equal(final.perceptionOutcome, outcome)
    if (outcome !== 'positive') assert.equal(f.task().decision.outcome, 'continue', 'The existing LLM-led Goal Review must receive incomplete objectives')
    if (outcome === 'failed') assert.match(f.task().decision.reason, /Remote server unavailable/)
    assert.equal(f.dispatches.length, 0, 'A perception result cannot invent a motion command')
  })
}

test('duplicate and reordered update replies cannot acknowledge a newer revision', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const first = sent.pendingControls!
  const acknowledged = await f.receive(sent, first.commandId, 'completed')
  const second = { ...acknowledged, pendingControls: { ...first, commandId: 'new-command', revision: 2, controls: '{"turn":-20}' } }
  await assert.rejects(() => f.receive(second, first.commandId, 'completed'), /WAIT/)
  await assert.rejects(() => f.receive(second, 'new-command', 'completed', { movementUpdate: {
    version: 1, sessionId: observation.sessionId, actionId: 'motion', revision: 1 } }), /WAIT/)
  assert.equal(second.pendingControls.revision, 2)
  assert.equal(second.acknowledgedControls, first.controls)
})

test('stale image correlation is explicit before remote admission', async () => {
  const f = fixture({ steps: [{ kind: 'action', action: { type: 'captureImage' } }] })
  const state = { ...f.state, action: { type: 'captureImage' as const }, snapshotId: 'snapshot', captureRequestedAt: new Date().toISOString(),
    pendingEvents: [{ kind: 'observation_received', actionId: 'snapshot', payload: { environmentObservation: {
      ...observation, visual: { id: 'old', timestamp: '2020-01-01T00:00:00Z', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' } } } }] }
  const received = (await wait.execute({ state }, f.context, {})).state as ActiveTaskState
  const final = await f.advance(received)
  assert.equal(final.perceptionOutcome, 'stale')
  assert.equal(final.objectiveComplete, false)
  assert.equal(f.dispatches.length, 0)
})

test('generated motion is admitted asynchronously and user steering remains responsive', async () => {
  const f = fixture({ steps: [{ kind: 'generatedMotion', description: 'Wave at the owner' }] })
  const pending = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  assert.equal(f.dispatches[0].payload.handler, 'environment.generate-motion')
  assert.equal(pending.generationEffectId, 'effect-1')
  assert.equal(pending.motionId, undefined, 'Inference cannot admit body execution before its result')
  const received = await wait.execute({ state: { ...pending, pendingEvents: [{ kind: 'user_steering', payload: { userMessage: 'Cancel that request' } }] } }, f.context, {})
  assert.equal(received.continue, true)
  assert.equal(received.state.userInput.userMessage, 'Cancel that request')
  await assert.rejects(() => wait.execute({ state: { ...pending, pendingEvents: [{ kind: 'work_result',
    payload: { effectId: 'other-effect', result: { state: 'completed', result: { valid: true } } } }] } }, f.context, {}), /WAIT/)
})

test('a replacement program cannot bypass uncertain delivery from the earlier motion', async () => {
  const f = fixture()
  const sent = await f.advance(f.state)
  const uncertain = await f.receive(sent, f.dispatches[0].actionId, 'outcome_unknown')
  const replacement = fixture({ steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] })
  await replacement.advance({ ...uncertain, awaitingReplacement: true, retrySteering: true })
  assert.equal(replacement.dispatches.length, 0)
  assert.equal(replacement.task().feedback.type, 'outcome_unknown')
})

test('failed asynchronous motion generation reaches the planner without dispatching a body command', async () => {
  const f = fixture({ steps: [{ kind: 'generatedMotion', description: 'Wave at the owner' }] })
  const pending = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  const received = await wait.execute({ state: { ...pending, pendingEvents: [{ kind: 'work_result',
    payload: { effectId: pending.generationEffectId, result: { state: 'failed', error: { message: 'Remote motion server unavailable' } } } }] } }, f.context, {})
  const final = await f.advance(received.state)
  assert.equal(final.done, true)
  assert.equal(final.objectiveComplete, false)
  assert.equal(f.task().decision.outcome, 'continue')
  assert.match(f.task().decision.reason, /Remote motion server unavailable/)
  assert.equal(f.dispatches.length, 1, 'Only the original remote generation job was admitted')
})

test('active action changes and physical receipts reach Robot Status without a semantic refresh', async () => {
  const f = fixture();
  const running = await f.advance(f.state);
  assert.equal(f.statusEffects.at(-1).payload.sources.lastAction.actionId, 'motion');
  assert.equal(f.statusEffects.at(-1).payload.sources.lastAction.status, 'active');
  const effectCount = f.statusEffects.length;
  await f.advance(running);
  assert.equal(f.statusEffects.length, effectCount, 'Unchanged active ticks do not repeat the projection');
  const completed = await f.receive(running, 'motion', 'completed');
  await f.advance(completed);
  const action = f.statusEffects.at(-1).payload.sources.lastAction;
  assert.equal(action.actionId, 'motion');
  assert.equal(action.type, 'move');
  assert.equal(action.status, 'completed');
  assert.equal(action.completedAt, f.task().feedback.observedAt);
});

const search: EnvironmentTaskProgram = { steps: [{ kind: 'behavior', motion, target: 'cup',
  completionCriteria: 'cup visible', candidateLabels: ['cup'], identifyEveryFrames: 3, steering: null }] }
const identified = { matchesTarget: true, completionSatisfied: true, outcome: 'positive' as const,
  description: 'Cup visible', evidence: 'Correlated cup image' }

test('Finish waits for the original gait terminal receipt, not its control ACK', async () => {
  const f = fixture(search)
  const finishing = await f.advance({ ...f.state, identification: identified })
  const update = f.dispatches.find(item => item.payload.input.movementUpdate)
  assert.equal(update.payload.input.movementUpdate.actionId, 'motion')
  assert.equal(update.payload.input.movementUpdate.controls.speed, 0)
  assert.equal(f.dispatches.some(item => item.payload.input.type === 'stop'), false)
  const accepted = await f.receive(finishing, update.actionId, 'completed')
  assert.equal(accepted.stepIndex, 0)
  assert.equal(accepted.done, undefined)
  const complete = await f.receive(accepted, 'motion', 'completed')
  assert.equal(complete.stepIndex, 1)
  assert.equal(complete.visualCompletionSatisfied, true)
})

for (const reason of ['failed', 'stale', 'finish-timeout'] as const) {
  test(`${reason} requires bounded cancellation confirmation and retains unknown until a late terminal receipt`, async () => {
    const f = fixture(search)
    const state = { ...f.state, ...(reason === 'failed' ? { identificationError: 'Required remote inference failed' }
      : reason === 'stale' ? { feedbackRequiredSince: Date.now() - 3000 }
        : { finishRequestedAt: Date.now() - 6000, identification: identified }) }
    const cancelling = await f.advance(state)
    assert.ok(cancelling.cancellationRequestedAt)
    assert.equal(cancelling.done, undefined)
    assert.equal(cancelling.objectiveComplete, false)
    const deadline = f.dispatches.find(item => item.payload.handler === 'environment.active-task-deadline')
    assert.ok(Date.parse(deadline.payload.notBefore) <= Date.now() + 2000)
    const unknown = await f.advance({ ...cancelling, cancellationRequestedAt: Date.now() - 3000 })
    assert.equal(unknown.feedback?.type, 'outcome_unknown')
    assert.equal(unknown.done, undefined)
    const terminal = await f.receive(unknown, 'motion', 'cancelled')
    const failed = await f.advance(terminal)
    assert.equal(failed.done, true)
    assert.equal(failed.objectiveComplete, false)
  })
}

test('deadline events and late original results cannot change a replacement action', async () => {
  const f = fixture()
  const state = { ...f.state, motionId: 'replacement', deadlineEffectId: 'new-deadline', pendingEvents: [
    { kind: 'work_result', payload: { effectId: 'old-deadline', result: { state: 'completed' } } },
    { kind: 'physical_result', actionId: 'motion', payload: { feedback: { actionId: 'motion', type: 'cancelled' } } },
  ] }
  await assert.rejects(() => wait.execute({ state }, f.context, {}), /WAIT/)
  assert.equal(f.dispatches.length, 0)
})

test('delayed image inference discards expired evidence while fresh local feedback keeps the gait usable', async () => {
  const now = Date.now()
  recordEnvironmentObservation({ ...observation, state: { ...observation.state,
    body: { authenticated: true, cameraReady: true, robotId: 'p4' },
    gateway: { robots: { p4: { epoch: 1, connection_state: 'online' } } },
    perception: { version: 1, timeBasis: 'gateway_receipt', robotId: 'p4', epoch: 1, gatewayInstance: 'gateway',
      frameCounter: 2, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10000).toISOString(),
      backend: 'fixture', model: 'fixture', summary: 'Fresh local feedback', objects: [], uncertainties: [] },
  } })
  try {
    const f = fixture(search)
    const state = { ...f.state, identificationEffectId: 'slow-image', lastIdentifiedFrame: 1,
      identificationRequest: { effectId: 'slow-image', frameId: 'old-image', stepIndex: 0,
        gatewayInstance: 'gateway', epoch: 1, expiresAt: new Date(now - 1).toISOString() },
      pendingEvents: [{ kind: 'work_result', payload: { effectId: 'slow-image', result: { state: 'completed', result: identified } } }] }
    const received = (await wait.execute({ state }, f.context, {})).state as ActiveTaskState
    assert.equal(received.identificationError, undefined)
    assert.equal(received.identification, undefined, 'Expired evidence cannot finish the objective')
    assert.equal(received.lastIdentifiedFrame, undefined, 'A new image must be identified')
    assert.equal(received.cancellationRequestedAt, undefined)
    assert.equal(received.motionId, 'motion')
    const active = await f.advance({ ...f.state, snapshotId: 'pending-capture' })
    const previous = (await import('./store.js')).getLatestEnvironmentObservation(observation.sessionId)!
    recordEnvironmentObservation({ ...previous, state: { ...previous.state, perception: {
      ...(previous.state!.perception as object), frameCounter: 3, expiresAt: new Date(now + 20000).toISOString(),
    } } })
    const refreshed = await f.advance(active)
    assert.equal(refreshed.deadlineEffectId, active.deadlineEffectId, 'Fresh frames reuse the existing earlier deadline')
    assert.equal(f.dispatches.filter(item => item.payload.handler === 'environment.active-task-deadline').length, 1)
  } finally { recordEnvironmentObservation(observation) }
})

async function deliverInterpretation(state: ActiveTaskState, context: any) {
  assert.ok(state.interpretation, 'The active owner must dispatch a finite interpretation job')
  return wait.execute({ state: { ...state, pendingEvents: [...(state.pendingEvents ?? []),
    { kind: 'work_result', payload: { effectId: state.interpretation.effectId,
      result: { state: 'completed', result: { ...state.interpretation, route: {}, response: '{}' } } } }] } }, context, {})
}

for (const termination of ['finish', 'cancel'] as const) {
  test(`buffered instructions during ${termination} route from settled state before another ongoing behavior`, async () => {
    const f = fixture({ steps: [...search.steps, ...search.steps] })
    let state = await f.advance({ ...f.state, ...(termination === 'finish'
      ? { identification: identified } : { identificationError: 'Required feedback failed' }) })
    const instructions = ['Tell me what happened.', 'Actually, stay here and explain.'].map((userMessage, index) => ({
      kind: 'user_steering', payload: { userMessage, ttsGeneration: index + 1, sessionId: observation.sessionId },
    }))
    state = (await wait.execute({ state: { ...state, pendingEvents: instructions } }, f.context, {})).state
    state = await f.advance(state)
    assert.equal(f.dispatches.at(-1).payload.handler, 'environment.interpret')
    assert.deepEqual(f.dispatches.at(-1).payload.input.turns.map((turn: any) => turn.userMessage), instructions.map(event => event.payload.userMessage))
    // A result may arrive during termination, but cannot bypass its receipt.
    state = (await deliverInterpretation(state, f.context)).state
    assert.equal(state.userInput?.activeTaskContinuation, undefined)
    state = await f.receive(state, 'motion', 'outcome_unknown')
    state = await f.advance(state)
    assert.equal(state.done, undefined)
    assert.equal(state.feedback?.type, 'outcome_unknown')
    state = await f.receive(state, 'motion', termination === 'finish' ? 'completed' : 'cancelled')
    state = await f.advance(state)
    state = await f.advance(state)
    const routed = await deliverInterpretation(state, f.context)
    assert.equal(routed.continue, false)
    assert.equal(routed.state.userInput.ttsGeneration, 2)
    assert.deepEqual(routed.state.userInput.pendingInstructionTurns.map((turn: any) => turn.userMessage), instructions.map(event => event.payload.userMessage))
    const continuation = routed.state.userInput.activeTaskContinuation
    for (const field of ['userInput', 'motionId', 'action', 'pendingControls', 'finishRequestedAt', 'cancellationRequestedAt'])
      assert.equal(continuation.state[field], undefined, field)
    assert.equal(continuation.state.completedActionId, 'motion')
    assert.equal(continuation.state.done, true)
    assert.equal(continuation.decision.outcome, 'continue')
    assert.equal((await f.advance(continuation.state)).done, true)
    assert.equal(f.dispatches.some(item => item.payload.input.type === 'move' && !item.payload.input.movementUpdate), false)
  })
}

for (const queueOwner of ['checkpoint', 'execution'] as const) {
  test(`input queued after the Finish receipt in ${queueOwner} is routed before the next phase`, async () => {
    const f = fixture({ steps: [...search.steps, ...search.steps] })
    const finishing = await f.advance({ ...f.state, identification: identified })
    const first = { kind: 'user_steering', payload: { userMessage: 'Wait for me.', ttsGeneration: 1 } }
    const latest = { kind: 'user_steering', payload: { userMessage: 'Explain first.', ttsGeneration: 2 } }
    const terminal = { kind: 'physical_result', actionId: 'motion', payload: { feedback: {
      id: 'done', actionId: 'motion', type: 'completed', message: 'Finished', timestamp: new Date().toISOString() } } }
    const events = [terminal, first, latest]
    const context = queueOwner === 'execution' ? { ...(f.context as any), graphExecution: {
      ...(f.context as any).graphExecution, pendingEvents: () => events, waitForEvent: () => events.shift(),
    } } : f.context
    let state = (await wait.execute({ state: { ...finishing, pendingEvents: queueOwner === 'checkpoint' ? events : [] } }, context, {})).state
    state = (await wait.execute({ state }, context, {})).state
    state = await f.advance(state)
    const received = await deliverInterpretation(state, context)
    assert.equal(received.continue, false)
    const { activeTaskContinuation, pendingInstructionTurns } = received.state.userInput
    assert.deepEqual(pendingInstructionTurns.map((turn: any) => turn.userMessage), [first.payload.userMessage, latest.payload.userMessage])
    assert.equal(activeTaskContinuation.state.stepIndex, 1)
    assert.equal(activeTaskContinuation.state.motionId, undefined)
    assert.deepEqual(activeTaskContinuation.state.evidence, [identified.evidence])
    assert.equal(f.dispatches.some(item => item.payload.input.type === 'move' && !item.payload.input.movementUpdate), false)
  })
}

test('an applied proposal retains its turn attribution while newer input remains queued for the active owner', async () => {
  const { executionEventWaitNode } = await import('../nodes/utility/execution-event-wait.node.js')
  const queue = [{ kind: 'user_steering', payload: { userMessage: 'New instruction', ttsGeneration: 2 } }]
  const supplied = { userMessage: 'Interpreted instruction', ttsGeneration: 1, environmentInterpretation: { revision: 1 } }
  const result = await executionEventWaitNode.execute({ receivedInput: supplied }, {
    _graphExecutorIteration: 1, graphExecution: { pendingEvents: () => queue, waitForEvent: () => queue.shift() },
  } as never, { drain: true, userGraph: 'environment' })
  assert.equal(result.invocation.context.userMessage, supplied.userMessage)
  assert.equal(result.invocation.context.ttsGeneration, 1)
  assert.equal(queue.length, 1)
})

for (const change of ['manual takeover', 'reconnect', 'gateway replacement'] as const) {
  test(`${change} discards a late interpretation without taking back motion or losing pending text`, async () => {
    const f = fixture()
    let state = (await wait.execute({ state: { ...f.state, pendingEvents: [{ kind: 'user_steering',
      payload: { userMessage: 'Keep moving and explain.', sessionId: observation.sessionId } }] } }, f.context, {})).state
    state = await f.advance(state)
    const obsolete = { ...state.interpretation! }
    const changed = structuredClone(observation)
    if (change === 'manual takeover') changed.state!.gateway = { robots: { p4: { body_command_sequence: 999 } } }
    else if (change === 'reconnect') (changed.state!.activeMovementUpdates as any).epoch = 2
    else (changed.state!.activeMovementUpdates as any).gatewayInstance = 'replacement'
    recordEnvironmentObservation(changed)
    try {
      state = await f.advance(state)
      assert.match(state.interpretationError!, /ownership or session changed/)
      assert.equal(state.interpretation, undefined)
      const received = await wait.execute({ state: { ...state, pendingEvents: [
        { kind: 'work_result', payload: { effectId: obsolete.effectId, result: { state: 'completed', result: obsolete } } },
        { kind: 'perception_received', payload: {} },
      ] } }, f.context, {})
      assert.equal(received.state.userInput.activeTaskContinuation, undefined)
      assert.equal(received.state.userInput.userMessage, 'Keep moving and explain.')
      assert.equal(f.dispatches.filter(item => item.payload.handler === 'environment.interpret').length, 1)
      const cleanup = f.dispatches.find(item => item.payload.handler === 'environment.cancel-owned-work')
      assert.equal(cleanup.payload.input.interpretationEffectId, obsolete.effectId)
      assert.equal(cleanup.payload.input.actionId, undefined, 'Discarding inference does not issue an unscoped Stop')
    } finally { recordEnvironmentObservation(observation) }
  })
}

test('checkpoint recovery keeps interpretation identity and does not duplicate its admission', async () => {
  const f = fixture()
  let state = (await wait.execute({ state: { ...f.state, pendingEvents: [{ kind: 'user_steering',
    payload: { userMessage: 'How is it going?', sessionId: observation.sessionId } }] } }, f.context, {})).state
  state = await f.advance(state)
  const recovered = await f.advance(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(recovered.interpretation, state.interpretation)
  assert.equal(f.dispatches.filter(item => item.payload.handler === 'environment.interpret').length, 1)
  const applied = await deliverInterpretation(recovered, f.context)
  assert.equal(applied.continue, false)
  assert.equal(applied.state.userInput.activeTaskContinuation.state.motionId, 'motion')
  assert.equal(applied.state.userInput.activeTaskContinuation.state.interpretation, undefined)
})

test('a correlated owned cancellation fence refreshes interpretation without treating Stop as termination evidence', async () => {
  const f = fixture(search)
  let state = (await wait.execute({ state: { ...f.state, pendingEvents: [{ kind: 'user_steering',
    payload: { userMessage: 'Explain after stopping.', sessionId: observation.sessionId } }] } }, f.context, {})).state
  state = await f.advance({ ...state, identificationError: 'Feedback failed' })
  const changed = structuredClone(observation)
  changed.state!.gateway = { robots: { p4: { body_command_sequence: 7 } } }
  recordEnvironmentObservation(changed)
  try {
    state = await f.advance(state)
    assert.ok(state.interpretationError)
    state = await f.receive(state, 'motion', 'outcome_unknown', {
      cancellationBody: [observation.sessionId, 'gateway', 'p4', 1, 7],
    })
    state = await f.advance(state)
    assert.equal(state.interpretationError, undefined)
    const pending = await deliverInterpretation(state, f.context)
    assert.equal(pending.continue, true)
    assert.equal(pending.state.userInput.activeTaskContinuation, undefined)
    assert.equal(pending.state.feedback.type, 'outcome_unknown')
    assert.equal(pending.state.done, undefined)
    changed.state!.gateway = { robots: { p4: { body_command_sequence: 999 } } }
    recordEnvironmentObservation(changed)
    const manual = await f.advance(pending.state)
    assert.ok(manual.interpretationError, 'An earlier owned Stop cannot authorize takeover from a later manual command')
  } finally { recordEnvironmentObservation(observation) }
})

test('a ready interpretation reconciles a queued original terminal receipt before applying any continuation', async () => {
  const f = fixture()
  let state = (await wait.execute({ state: { ...f.state, pendingEvents: [{ kind: 'user_steering',
    payload: { userMessage: 'Keep going.', sessionId: observation.sessionId } }] } }, f.context, {})).state
  state = await f.advance(state)
  state.interpretationResult = { ...state.interpretation!, route: {}, response: '{}' }
  const received = await f.receive(state, 'motion', 'completed')
  assert.equal(received.userInput?.activeTaskContinuation, undefined)
  assert.equal(received.motionId, undefined)
  const settled = await f.advance(received)
  assert.equal(settled.interpretationResult, undefined, 'The old motion snapshot must be reinterpreted')
  assert.equal(settled.interpretation?.motionId, undefined)
  assert.equal(settled.interpretation?.stepIndex, 1)
})

test('a receipt from another session cannot apply even when its effect envelope matches', async () => {
  const f = fixture()
  let state = (await wait.execute({ state: { ...f.state, pendingEvents: [{ kind: 'user_steering',
    payload: { userMessage: 'Turn.', sessionId: observation.sessionId } }] } }, f.context, {})).state
  state = await f.advance(state)
  const received = await wait.execute({ state: { ...state, pendingEvents: [{ kind: 'work_result', payload: {
    effectId: state.interpretation!.effectId, result: { state: 'completed', result: { ...state.interpretation, sessionId: 'other-session' } },
  } }] } }, f.context, {})
  assert.equal(received.continue, true)
  assert.equal(received.state.interpretationResult, undefined)
  assert.match(received.state.interpretationError, /mismatched execution, session or revision/)
  assert.equal(received.state.userInput.userMessage, 'Turn.')
})

test('routing combined input to another execution preserves every turn and the existing active owner', async () => {
  const { environmentActionParserNode } = await import('../nodes/environment/action-parser.node.js')
  const { executionEventOutNode } = await import('../nodes/utility/execution-event-out.node.js')
  const f = fixture()
  const continuation = { program, decision, state: f.state }
  const selection = await environmentActionParserNode.execute({
    response: JSON.stringify({ executionDisposition: 'steer', targetExecutionId: 'other', response: '', program: null, taskDecision: null }),
    activeExecutions: [{ executionId: 'other', canSteer: true }],
  }, { ...(f.context as any), activeTaskContinuation: continuation, environmentInterpretation: { executionId: 'execution' } }, {})
  assert.deepEqual(selection.program, program)
  assert.equal(selection.continueHere, true)
  const turns = [{ userMessage: 'Answer this.', ttsGeneration: 1 }, { userMessage: 'And slow down.', ttsGeneration: 2 }]
  await executionEventOutNode.execute({ selection: selection.executionSelection },
    { ...(f.context as any), pendingInstructionTurns: turns }, {})
  const events = f.dispatches.filter(dispatch => dispatch.kind === 'execution_event')
  assert.deepEqual(events.map(event => event.payload.context.userMessage), turns.map(turn => turn.userMessage))
  assert.deepEqual(events.map(event => event.payload.context.ttsGeneration), [1, 2])
  assert.ok(events.every(event => event.payload.executionId === 'other'))
  assert.equal(f.state.motionId, 'motion')
})
