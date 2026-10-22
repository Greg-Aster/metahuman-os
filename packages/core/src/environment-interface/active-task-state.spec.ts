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
const { executionContextNode } = await import('../nodes/utility/execution-context.node.js')
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

for (const basis of ['action_result', 'visual_observation', 'environment_state', 'response']) {
  test(`a finished finite program settles only its selected receipt completion basis (${basis})`, async () => {
    const f = fixture()
    Object.assign(f.context, { activeTaskDecision: { ...decision, requiredCompletionBasis: basis, continuationPolicy: 'none' } })
    const received = await f.receive(f.state, 'motion', 'completed')
    const state = await f.advance(received)
    const complete = basis === 'action_result'
    assert.equal(state.done, true)
    assert.equal(state.objectiveComplete, complete)
    assert.equal(f.task().decision.objective, decision.objective)
    assert.equal(f.task().decision.outcome, complete ? 'complete' : decision.outcome)
    assert.equal(f.task().actionStatus, 'completed', 'Physical result is independent of remaining objective interpretation')
    assert.deepEqual(f.task().feedback, { actionId: 'motion', type: 'completed', message: 'Explicit completed', observedAt: received.feedback!.timestamp })
    assert.equal(f.dispatches.length, 0)
    assert.deepEqual(await f.advance(state), state, 'Re-entry preserves the settled result without dispatch')
  })
}

test('multi-step receipt completion waits for every selected action and ignores unrelated receipts', async () => {
  const f = fixture({ steps: [
    { kind: 'action', action: { type: 'robotCommand', command: 'bow' } },
    { kind: 'action', action: { type: 'robotCommand', command: 'wave' } },
  ] })
  Object.assign(f.context, { activeTaskDecision: { ...decision, requiredCompletionBasis: 'action_result', continuationPolicy: 'none' } })
  await assert.rejects(() => f.receive(f.state, 'unrelated', 'completed'), /WAIT/)
  const first = await f.receive(f.state, 'motion', 'completed')
  assert.equal(first.stepIndex, 1)
  assert.notEqual(first.objectiveComplete, true)
  const second = await f.receive({ ...first, motionId: 'second', action: { type: 'robotCommand', command: 'wave' } }, 'second', 'completed')
  const final = await f.advance(second)
  assert.equal(final.objectiveComplete, true)
  assert.equal(final.evidence.length, 2)
  assert.equal(f.task().feedback.actionId, 'second')
})

for (const type of ['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'] as const) {
  test(`finite receipt objective does not complete on ${type}`, async () => {
    const f = fixture({ steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] })
    Object.assign(f.context, { activeTaskDecision: { ...decision, requiredCompletionBasis: 'action_result', continuationPolicy: 'none' } })
    const result = await f.receive({ ...f.state, action: { type: 'robotCommand', command: 'bow' } }, 'motion', type)
    const final = await f.advance(result)
    assert.equal(final.objectiveComplete, false)
    assert.equal(f.task().decision.outcome, 'failed', 'A terminal failure cannot request continuation of a one-off receipt objective')
    assert.equal(f.task().actionStatus, type)
    assert.equal(f.task().feedback.type, type)
    assert.equal(f.dispatches.length, 0)
  })
}

test('bounded objectives remain open after one program returns', async () => {
  const f = fixture()
  Object.assign(f.context, { activeTaskDecision: { ...decision, requiredCompletionBasis: 'action_result', continuationPolicy: 'bounded' } })
  const result = await f.advance(await f.receive(f.state, 'motion', 'completed'))
  assert.equal(result.done, true)
  assert.equal(result.objectiveComplete, false)
  assert.equal(f.task().decision.outcome, decision.outcome)
})

test('a failed program preserves the selected goal decision without manufacturing continued pursuit', async () => {
  const f = fixture({ steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] })
  Object.assign(f.context, { activeTaskDecision: { ...decision, requiredCompletionBasis: 'action_result', continuationPolicy: 'bounded' } })
  const result = await f.advance(await f.receive({ ...f.state, action: { type: 'robotCommand', command: 'bow' } }, 'motion', 'rejected'))
  assert.equal(result.done, true)
  assert.equal(result.objectiveComplete, false)
  assert.equal(f.task().decision.outcome, decision.outcome)
  assert.equal(f.task().feedback.type, 'rejected')
  assert.deepEqual(await f.advance(result), result)
  assert.equal(f.dispatches.length, 0, 'A retained goal does not dispatch another program on re-entry')
})

test('Goal Review confirms returned actions and does not generate tasks from text-only or unfinished work', async () => {
  const f = fixture()
  const graphExecution = (f.context as any).graphExecution
  Object.assign(graphExecution, { events: () => [], activeExecutions: () => [] })
  const read = () => executionContextNode.execute({}, f.context, {})
  const base = { actionId: 'motion', decision: { ...decision, outcome: 'continue' },
    feedback: { actionId: 'motion', type: 'completed', message: 'done' } }
  for (const basis of ['visual_observation', 'environment_state', 'action_result']) {
    for (const type of ['completed', 'failed', 'rejected', 'expired', 'cancelled']) {
      graphExecution.recordTask({ ...base, decision: { ...base.decision, requiredCompletionBasis: basis }, feedback: { ...base.feedback, type } })
      assert.equal((await read()).needsGoalReview, true, `${basis}: ${type}`)
    }
  }
  for (const task of [
    { ...base, feedback: null },
    { ...base, actionId: '' },
    { ...base, feedback: { ...base.feedback, actionId: 'other' } },
    { ...base, feedback: { ...base.feedback, type: 'outcome_unknown' } },
    { ...base, feedback: { ...base.feedback, type: 'accepted' } },
    { ...base, decision: { ...base.decision, requiredCompletionBasis: 'response' } },
    { ...base, decision: { ...base.decision, requiredCompletionBasis: 'user_input', outcome: 'request_user' } },
    { ...base, decision: { ...base.decision, objectiveComplete: true, outcome: 'complete' } },
    { ...base, desireId: 'agency-owned' },
  ]) {
    graphExecution.recordTask(task)
    assert.equal((await read()).needsGoalReview, false, JSON.stringify(task))
  }
})

test('unfinished goals retain continuation independently of action or review eligibility', async () => {
  const f = fixture()
  const execution = (f.context as any).graphExecution
  Object.assign(execution, { events: () => [], activeExecutions: () => [] })
  for (const basis of ['visual_observation', 'environment_state', 'action_result', 'user_input', 'response']) {
    execution.recordTask({ objective: 'Find the target', decision: { ...decision,
      outcome: 'continue', requiredCompletionBasis: basis, continuationPolicy: 'none' },
      actionId: '', feedback: null })
    const result = await executionContextNode.execute({}, f.context, {})
    assert.equal(result.hasActiveTask, true)
    assert.equal(result.needsGoalReview, false, 'No returned action requires review')
    assert.equal(result.awaitContext, true, `${basis}: unfinished goal must survive`)
  }
  for (const task of [null,
    ...['complete', 'cancel', 'abandon', 'failed'].map(outcome => ({ decision: { ...decision, outcome } })),
    { desireId: 'agency-owned', decision: { ...decision, outcome: 'continue' } },
  ]) {
    execution.recordTask(task)
    const result = await executionContextNode.execute({}, f.context, {})
    assert.equal(result.awaitContext, false, 'Do not continue terminal, absent, or Agency-owned goals')
    assert.equal(result.needsGoalReview, false)
  }
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

for (const imageFirst of [false, true]) {
  test(`capture completes its own step with receipt and image (imageFirst=${imageFirst})`, async () => {
    const capture: EnvironmentTaskProgram = { steps: [
      { kind: 'action', action: { type: 'captureImage' } },
      { kind: 'action', action: { type: 'robotCommand', command: 'wave' } },
    ] }
    const f = fixture(capture)
    let state: ActiveTaskState = { ...f.state, action: { type: 'captureImage' }, snapshotId: 'motion' }
    const image = { id: 'frame', timestamp: new Date().toISOString(), dataUrl: 'data:image/jpeg;base64,/9j/2Q==', metadata: { actionId: 'motion' } }
    const receiveImage = async () => { state = (await wait.execute({ state: { ...state, pendingEvents: [{ kind: 'observation_received',
      actionId: 'motion', payload: { environmentObservation: { ...observation, visual: image } } }] } }, f.context, {})).state }
    if (imageFirst) await receiveImage()
    else state = await f.receive(state, 'motion', 'completed')
    assert.equal(state.stepIndex, 0, 'Neither receipt nor image alone advances a capture')
    if (imageFirst) state = await f.receive(state, 'motion', 'completed')
    else await receiveImage()
    assert.equal(state.stepIndex, 1)
    assert.deepEqual(state.capturedFrameIds, ['frame'])
    assert.match(state.evidence[0], /frame/)
    assert.equal(f.dispatches.length, 0, 'Capture completion does not ask a model to prove later steps')
    // The integration test covers dispatch; here supply the later action receipt.
    state = await f.receive({ ...state, action: { type: 'robotCommand', command: 'wave' }, motionId: 'wave-action' }, 'wave-action', 'completed')
    state = await f.advance(state)
    assert.equal(state.done, true)
    assert.equal(state.objectiveComplete, false, 'The model-owned result review still receives captured evidence')
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
  assert.equal(f.task().decision.outcome, decision.outcome)
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

for (const reason of ['failed', 'finish-timeout'] as const) {
  test(`${reason} requires bounded cancellation confirmation and retains unknown until a late terminal receipt`, async () => {
    const f = fixture(search)
    const state = { ...f.state, ...(reason === 'failed' ? { identificationError: 'Required remote inference failed' }
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

test('missing tracking feedback returns evidence to planning without cancelling commanded movement', async () => {
  const f = fixture(search)
  const first = await f.advance({ ...f.state, snapshotId: 'pending-capture' })
  assert.equal(first.identificationError, undefined)
  assert.equal(first.cancellationRequestedAt, undefined)
  assert.equal(first.motionId, 'motion')
  assert.equal(first.planningRequired, true)
  assert.equal(first.trackingFeedback?.status, 'unavailable')
  assert.equal(f.dispatches.some(item => item.payload.handler === 'environment.active-task-deadline'), false)
  assert.equal(f.dispatches.some(item => item.payload.handler === 'environment.cancel-owned-work'), false)
  const continued = await f.advance({ ...first, planningRequired: undefined })
  assert.equal(continued.planningRequired, undefined, 'An unchanged gap does not repeatedly invoke the planner')
  assert.equal(continued.motionId, 'motion')
})

test('a slow camera gap keeps the last turn, reports the gap once and steers again on fresh evidence', async () => {
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  const f = fixture({ steps: [{ ...search.steps[0], steering: { label: 'cup', gain: 100 } } as any] })
  const frame = (counter: number, x: number) => recordEnvironmentObservation({ ...observation,
    timestamp: new Date(now).toISOString(), state: { ...observation.state,
      body: { authenticated: true, cameraReady: true, robotId: 'p4' },
      gateway: { robots: { p4: { epoch: 1, connection_state: 'online' } } },
      perception: { version: 1, timeBasis: 'gateway_receipt', robotId: 'p4', epoch: 1, gatewayInstance: 'gateway',
        frameCounter: counter, observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString(),
        backend: 'fixture', model: 'fixture', summary: 'Cup',
        objects: [{ label: 'cup', box: { x, y: .2, width: .2, height: .4 } }], uncertainties: [] },
    } })
  try {
    frame(1, .1)
    let state = await f.advance({ ...f.state, snapshotId: 'pending-capture' })
    assert.equal(JSON.parse(state.pendingControls!.controls).turn, 50)
    state = await f.receive(state, state.pendingControls!.commandId, 'completed')
    const updates = () => f.dispatches.filter(item => item.payload.input.movementUpdate)
    now += 1600 // The next frame arrives later than the previous frame's validity.
    state = await f.advance(state)
    assert.equal(state.identificationError, undefined)
    assert.equal(state.cancellationRequestedAt, undefined)
    assert.equal(state.planningRequired, true)
    assert.equal(state.trackingFeedback?.status, 'unavailable')
    assert.equal(updates().length, 1, 'Expiry does not reset the turn to the unsteered base motion')
    now += 20000
    state = await f.advance({ ...state, planningRequired: undefined })
    assert.equal(state.planningRequired, undefined)
    assert.equal(state.motionId, 'motion')
    assert.equal(f.dispatches.some(item => item.payload.handler === 'environment.cancel-owned-work'
      && item.payload.input.actionId === 'motion'), false)
    frame(2, .7)
    state = await f.advance(state)
    assert.equal(state.trackingFeedback?.status, 'current')
    assert.ok(Math.abs(JSON.parse(state.pendingControls!.controls).turn + 10) < 1e-8)
    assert.equal(state.motionId, 'motion', 'Recovery updates the original movement, without restart')
  } finally { Date.now = realNow; recordEnvironmentObservation(observation) }
})

test('expired image interpretation with a detector gap cannot cancel the active movement', async () => {
  const f = fixture(search)
  const state = { ...f.state, snapshotId: 'pending-capture', identificationEffectId: 'slow-image', lastIdentifiedFrame: 1,
    identificationRequest: { effectId: 'slow-image', frameId: 'old-image', stepIndex: 0,
      gatewayInstance: 'gateway', epoch: 1, expiresAt: new Date(Date.now() - 1).toISOString() },
    pendingEvents: [{ kind: 'work_result', payload: { effectId: 'slow-image', result: { state: 'completed', result: identified } } }] }
  const received = (await wait.execute({ state }, f.context, {})).state as ActiveTaskState
  assert.equal(received.perceptionOutcome, 'stale')
  assert.equal(received.identification, undefined, 'Old image evidence cannot establish current completion')
  assert.equal(received.identificationError, undefined)
  const continued = await f.advance(received)
  assert.equal(continued.motionId, 'motion')
  assert.equal(continued.cancellationRequestedAt, undefined)
  assert.equal(continued.planningRequired, true)
})

test('the existing task planning handoff carries missing feedback and the original motion identity', async () => {
  const { environmentActiveTaskNode } = await import('../nodes/environment/active-task.node.js')
  const graphDir = path.join(root, 'etc', 'cognitive-graphs')
  fs.mkdirSync(graphDir, { recursive: true })
  fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/robot-active-task-mode.json', import.meta.url),
    path.join(graphDir, 'robot-active-task-mode.json'))
  const state: ActiveTaskState = { stepIndex: 0, evidence: [], updateRevision: 3,
    motionId: 'original-motion', action: motion, accepted: true, planningRequired: true,
    trackingFeedback: { status: 'unavailable', queryId: 'selected-target' } }
  const output = await environmentActiveTaskNode.execute({ program: search, taskDecision: decision,
    sessionId: observation.sessionId }, { username: 'fixture', graphExecution: {
      callGraph: async () => ({ nodes: new Map([['wait', { definition: { type: 'environment_active_task_wait' },
        status: 'completed', outputs: { state } }]]) }), frame: () => undefined, task: () => ({ decision }),
    } } as any, {})
  assert.equal(output.finished, false)
  assert.equal(output.completed, false)
  assert.deepEqual(output.planningResult.environmentTaskEvidence.trackingFeedback, state.trackingFeedback)
  assert.equal(output.planningResult.environmentTaskEvidence.motionId, 'original-motion')
  assert.equal(output.planningResult.activeTaskContinuation.state.motionId, 'original-motion')
  assert.equal(output.planningResult.activeTaskContinuation.state.planningRequired, undefined)
})

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

for (const nextAction of [{ type: 'stop' as const }, { type: 'move' as const, direction: 'forward' as const, continuous: true, durationMs: 0, locomotionGoal: { kind: 'relativeTurn' as const, degrees: 90, tolerance: 2 } }]) {
  test(`interpreted wave retains correlated ownership for later ${nextAction.type} across checkpoint and manual takeover`, async () => {
    const bridge = await import('./store.js')
    bridge.setEnvironmentBridgeEnabled(true)
    const unsubscribe = bridge.subscribeEnvironmentActions(observation.sessionId, () => {})
    const before = [observation.sessionId, 'gateway', 'p4', 1, 10]
    const owned = [...before.slice(0, 4), 11]
    const live = (sequence: number) => ({ ...observation, capabilities: { ...observation.capabilities,
      actions: [...observation.capabilities.actions, 'robotCommand' as const], robotCommands: ['wave'] },
      state: { ...observation.state, body: { authenticated: true, robotId: 'p4' },
        gateway: { robots: { p4: { epoch: 1, body_command_sequence: sequence } } },
        locomotionMeasurement: { yaw: { available: true, source: 'imu', robotId: 'p4', referenceId: 'boot', observedAt: new Date().toISOString(), degrees: 0, uncertaintyDegrees: null } } } })
    recordEnvironmentObservation(live(10))
    try {
      const f = fixture({ steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } },
        { kind: 'action', action: nextAction }] })
      let state = await f.advance({ stepIndex: 0, evidence: [], updateRevision: 0, interpretationFence: JSON.stringify(before) })
      assert.equal(state.interpretationFence, JSON.stringify(before), 'Admission must not consume program ownership')
      assert.deepEqual(f.dispatches[0].payload.input.metadata.interpretationBody, before)
      state = await f.receive(state, state.motionId!, 'completed', { interpretationBody: owned })
      assert.equal(state.interpretationFence, JSON.stringify(owned), 'Only this action receipt advances expected ownership')
      // A recovered checkpoint sees a newer live command from the manual path.
      // Gateway regressions drive that actual path; Core must not adopt it here.
      state = JSON.parse(JSON.stringify(state))
      recordEnvironmentObservation(live(12))
      state = await f.advance(state)
      assert.deepEqual(f.dispatches.at(-1).payload.input.metadata.interpretationBody, owned)
      assert.equal(state.interpretationFence, JSON.stringify(owned))
    } finally { unsubscribe(); recordEnvironmentObservation(observation) }
  })
}

test('unrelated, reordered and reconnected receipts cannot advance interpreted program ownership', async () => {
  const f = fixture()
  const before = [observation.sessionId, 'gateway', 'p4', 1, 10]
  const state = { ...f.state, interpretationFence: JSON.stringify(before) }
  await assert.rejects(() => f.receive(state, 'other-execution-action', 'completed', {
    interpretationBody: [...before.slice(0, 4), 90] }), /WAIT/)
  for (const receipt of [[...before.slice(0, 4), 9], [observation.sessionId, 'gateway', 'p4', 2, 90],
    ['other-session', 'gateway', 'p4', 1, 90], [observation.sessionId, 'other-gateway', 'p4', 1, 90],
    [observation.sessionId, 'gateway', 'p4', 1, '90']]) {
    const received = await f.receive(state, 'motion', 'status', { interpretationBody: receipt })
    assert.equal(received.interpretationFence, state.interpretationFence)
  }
  const pending = { ...state, pendingControls: { commandId: 'update', motionId: 'motion', revision: 2, controls: '{}' } }
  await assert.rejects(() => f.receive(pending, 'update', 'completed', { interpretationBody: [...before.slice(0, 4), 90],
    movementUpdate: { actionId: 'motion', revision: 1, sessionId: observation.sessionId, version: 1 } }), /WAIT/)
  const unknown = await f.receive(state, 'motion', 'outcome_unknown', { interpretationBody: [...before.slice(0, 4), 11] })
  assert.equal(unknown.feedback?.type, 'outcome_unknown')
  assert.equal(unknown.stepIndex, 0, 'Owned dispatch evidence is never terminal motion evidence')
})

// Restricted demo tests exercise the existing step/wait owner. Observations and
// receipts here are synthetic; the separate paired replay runs the real detector.
async function singlePersonFixture(run: (f: any) => Promise<void>) {
  const realNow = Date.now
  let clock = realNow()
  Date.now = () => clock
  const { interpretationBody } = await import('./interpretation.js')
  const { personFrameKey } = await import('./active-task.js')
  const f = fixture({ steps: [{ ...search.steps[0], target: 'candidate person',
    motion: { ...motion, locomotionGoal: { kind: 'visual', target: 'candidate person', completionCriteria: 'Observe the selected person' } },
    candidateLabels: ['person'], steering: { label: 'person', gain: 100 } } as any] })
  const { setEnvironmentBridgeEnabled, subscribeEnvironmentActions } = await import('./store.js')
  setEnvironmentBridgeEnabled(true)
  const unsubscribe = subscribeEnvironmentActions(observation.sessionId, () => {})
  const frame = (counter: number, count: number, offset = 0, ttl = 1000, x = .2) => {
    const at = clock + offset
    const perception = { version: 1, timeBasis: 'gateway_receipt', robotId: 'p4', epoch: 1, gatewayInstance: 'gateway',
      frameCounter: counter, observedAt: new Date(at).toISOString(), expiresAt: new Date(at + ttl).toISOString(),
      backend: 'synthetic', model: 'count-only', summary: 'Candidate persons, identity unknown',
      objects: Array.from({ length: count }, () => ({ label: 'person', box: { x, y: .2, width: .2, height: .4 } })), uncertainties: [] }
    recordEnvironmentObservation({ ...observation, state: { ...observation.state,
      body: { authenticated: true, cameraReady: true, robotId: 'p4' },
      gateway: { robots: { p4: { epoch: 1, connection_state: 'online' } } }, perception } })
    return personFrameKey(perception as any)
  }
  frame(1, 1)
  let state: ActiveTaskState = { ...f.state, snapshotId: 'pending-capture',
    interpretationFence: interpretationBody(observation) }
  const advance = async () => { state = await f.advance(state); return state }
  const terminal = async (type = 'cancelled') => { state = await f.receive(state, 'motion', type as any); return advance() }
  const resume = async (candidateFrame = state.personLoss?.candidateFrame, extra = {}) => {
    state = (await wait.execute({ state: { ...state, pendingEvents: [{ kind: 'single_person_resume', payload: {
      executionId: 'execution', sessionId: observation.sessionId, confirmCandidate: true, resume: true, candidateFrame, ...extra },
    }] } }, f.context, {})).state
    return state
  }
  try { await run({ ...f, frame, advance, terminal, resume, state: () => state,
    tick: (ms: number) => { clock += ms }, replace: (value: ActiveTaskState) => { state = value }, now: () => clock }) }
  finally { Date.now = realNow; unsubscribe(); recordEnvironmentObservation(observation) }
}

for (const count of [0, 2]) test(`single-person behavior cancels on first fresh ${count}-person observation without steering`, async () => {
  await singlePersonFixture(async f => {
    f.frame(2, count)
    const state = await f.advance()
    assert.equal(state.personLoss.startedAt, f.now())
    assert.equal(state.personLoss.expiresAt, f.now() + 3000)
    assert.equal(state.cancellationRequestedAt, f.now())
    assert.equal(state.objectiveComplete, false)
    assert.equal(f.dispatches.filter((d: any) => d.payload.handler === 'environment.cancel-owned-work' && d.payload.input.actionId === 'motion').length, 1)
    assert.equal(f.dispatches.some((d: any) => d.payload.input.movementUpdate), false)
    await f.advance()
    assert.equal(f.dispatches.filter((d: any) => d.payload.handler === 'environment.cancel-owned-work' && d.payload.input.actionId === 'motion').length, 1)
  })
})

test('restricted reacquisition counts three distinct successive fresh frames spanning one second', async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance(); await f.terminal()
    f.tick(100); f.frame(3, 1); await f.advance()
    f.tick(600); await f.advance(); await f.advance()
    assert.equal(f.state().personLoss.consecutive, 1, 'Repeated reads of the same frame do not count')
    f.frame(4, 1); await f.advance()
    assert.equal(f.state().personLoss.candidateFrame, undefined)
    f.tick(500); const candidate = f.frame(5, 1); await f.advance()
    assert.equal(f.state().personLoss.consecutive, 3)
    assert.equal(f.state().personLoss.candidateFrame, candidate)
    assert.equal(f.state().motionId, undefined, 'Reappearance never resumes movement')
    await f.resume('old-frame')
    assert.ok(f.state().personLoss.resumeRejection)
    await f.resume(candidate, { resume: false })
    assert.ok(f.state().personLoss)
    await f.resume(candidate)
    assert.equal(f.state().personLoss, undefined)
    assert.equal(f.state().completedActionId, 'motion')
    const resumed = await f.advance()
    assert.ok(resumed.motionId)
    assert.notEqual(resumed.motionId, 'motion')
    assert.equal(f.dispatches.filter((d: any) => d.payload.input.type === 'move' && !d.payload.input.movementUpdate).length, 1)
    await assert.rejects(() => f.resume(candidate), /WAIT/)
    assert.equal(f.dispatches.filter((d: any) => d.payload.input.type === 'move' && !d.payload.input.movementUpdate).length, 1)
  })
})

test('stale frames and a new ambiguous frame break the candidate streak without extending its window', async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance(); await f.terminal()
    const end = f.state().personLoss.expiresAt
    f.tick(100); f.frame(3, 1); await f.advance()
    f.tick(600); f.frame(4, 1, -2000); await f.advance()
    assert.equal(f.state().personLoss.consecutive, 0)
    assert.equal(f.state().personLoss.candidateFrame, undefined)
    f.frame(5, 1); await f.advance()
    f.tick(500); f.frame(6, 2); await f.advance()
    assert.equal(f.state().personLoss.consecutive, 0)
    assert.equal(f.state().personLoss.expiresAt, end)
    f.tick(2000); f.frame(7, 1); await f.advance()
    assert.equal(f.state().personLoss.windowExpired, true)
    assert.equal(f.state().personLoss.candidateFrame, undefined)
    assert.equal(f.state().objectiveComplete, false)
  })
})

test('missing original terminal survives window expiry and later receipt reconciliation; Stop ACK cannot resume', async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance()
    for (const [counter, delay] of [[3, 100], [4, 600], [5, 500]]) {
      f.tick(delay); f.frame(counter, 1); await f.advance()
    }
    const candidate = f.state().personLoss.candidateFrame
    assert.ok(candidate)
    await assert.rejects(() => f.receive(f.state(), 'stop-command', 'completed'), /WAIT/)
    await f.resume(candidate)
    assert.equal(f.state().motionId, 'motion')
    f.tick(1900); f.frame(6, 1); await f.advance()
    assert.equal(f.state().personLoss.windowExpired, true)
    assert.equal(f.state().feedback.type, 'outcome_unknown')
    assert.equal(f.state().motionId, 'motion')
    assert.equal(f.state().done, undefined)
    await f.resume(candidate)
    assert.ok(f.state().personLoss)
    await f.terminal()
    assert.equal(f.state().completedActionId, 'motion')
    assert.equal(f.state().motionId, undefined)
    assert.equal(f.state().feedback.type, 'cancelled')
    assert.equal(f.state().personLoss.windowExpired, true)
    assert.equal(f.dispatches.some((d: any) => d.payload.input.type === 'move'), false)
  })
})

for (const change of ['manual', 'reconnect']) test(`candidate resume cannot reclaim ownership after ${change}`, async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance(); await f.terminal()
    for (const [counter, delay] of [[3, 100], [4, 600], [5, 500]]) {
      f.tick(delay); f.frame(counter, 1); await f.advance()
    }
    const { getLatestEnvironmentObservation } = await import('./store.js')
    const current = getLatestEnvironmentObservation(observation.sessionId)!
    if (change === 'manual') (current.state!.gateway as any).robots.p4.body_command_sequence = 999
    else (current.state!.activeMovementUpdates as any).epoch = 2
    recordEnvironmentObservation(current)
    await f.resume()
    assert.ok(f.state().personLoss.resumeRejection)
    assert.equal(f.state().motionId, undefined)
  })
})

test('checkpoint recovery preserves the loss window and unknown receipt identity', async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance()
    const saved = JSON.parse(JSON.stringify(f.state()))
    f.tick(3100); f.replace(saved); await f.advance()
    assert.equal(f.state().personLoss.startedAt, saved.personLoss.startedAt)
    assert.equal(f.state().motionId, saved.motionId)
    assert.equal(f.state().feedback.type, 'outcome_unknown')
    await f.terminal()
    assert.equal(f.state().feedback.actionId, saved.motionId)
    assert.equal(f.state().objectiveComplete, false)
  })
})

test('IDENTITY LIMITATION: one person replacing another evades the count-only rule', async () => {
  await singlePersonFixture(async f => {
    const first = await f.advance()
    f.tick(100); f.frame(2, 1, 0, 1000, .7)
    f.replace(await f.receive(first, first.pendingControls.commandId, 'completed'))
    const replaced = await f.advance()
    assert.equal(replaced.personLoss, undefined)
    assert.equal(replaced.cancellationRequestedAt, undefined)
    assert.notEqual(replaced.desiredControls, first.desiredControls)
    // This explicitly demonstrates a limitation, not stable-target qualification.
    assert.equal(replaced.motionId, first.motionId)
  })
})

test('owned cancellation advances the resume fence only from its correlated terminal receipt', async () => {
  await singlePersonFixture(async f => {
    f.frame(2, 0); await f.advance()
    const { getLatestEnvironmentObservation } = await import('./store.js')
    const { interpretationBody } = await import('./interpretation.js')
    const current = getLatestEnvironmentObservation(observation.sessionId)!
    ;(current.state!.gateway as any).robots.p4.body_command_sequence = 1
    recordEnvironmentObservation(current)
    const fence = JSON.parse(interpretationBody(current))
    f.replace(await f.receive(f.state(), 'motion', 'cancelled', { interpretationBody: fence, cancellationBody: fence }))
    await f.advance()
    for (const [counter, delay] of [[3, 100], [4, 600], [5, 500]]) {
      f.tick(delay); f.frame(counter, 1)
      const next = getLatestEnvironmentObservation(observation.sessionId)!
      ;(next.state!.gateway as any).robots.p4.body_command_sequence = 1
      recordEnvironmentObservation(next)
      await f.advance()
    }
    assert.equal(f.state().interpretationFence, JSON.stringify(fence))
    await f.resume()
    assert.equal(f.state().personLoss, undefined)
    const resumed = await f.advance()
    assert.notEqual(resumed.motionId, 'motion')
    const command = f.dispatches.find((d: any) => d.payload.input.id === resumed.motionId)
    assert.deepEqual(command.payload.input.metadata.interpretationBody, fence)
  })
})

test('restricted loss cannot advance to a later phase or apply an interpreted replacement', async () => {
  await singlePersonFixture(async f => {
    ;(f.context as any).activeProgram.steps.push({ kind: 'action', action: { type: 'robotCommand', command: 'wave' } })
    f.frame(2, 2); await f.advance(); await f.terminal()
    f.tick(3100); await f.advance()
    assert.equal(f.state().stepIndex, 0)
    assert.equal(f.state().objectiveComplete, false)
    assert.equal(f.dispatches.some((d: any) => d.payload.input.command === 'wave'), false)
    const { environmentActiveTaskNode } = await import('../nodes/environment/active-task.node.js')
    await assert.rejects(() => environmentActiveTaskNode.execute({ program }, {
      ...(f.context as any), activeTaskContinuation: { program, state: f.state(), decision },
    }, {}), /operator selection and termination reconciliation/)
  })
})


test('person steering reports missing initial feedback and retains the existing perception subscription', async () => {
  const f = fixture({ steps: [{ ...search.steps[0], steering: { label: 'person', gain: 100 } } as any] })
  const initial: ActiveTaskState = { stepIndex: 0, evidence: [], updateRevision: 0 }
  const state = await f.advance(initial)
  assert.equal(state.motionId, undefined, 'No movement is admitted before a fresh candidate')
  assert.equal(state.planningRequired, true)
  assert.equal(state.trackingFeedback?.status, 'unavailable')
  assert.equal(f.dispatches.some(effect => effect.payload.handler === 'environment.active-task-deadline'), false)
  let reason: string | undefined
  ;(f.context as any).graphExecution.waitForEvent = (value: string) => { reason = value; throw new Error('WAIT') }
  await assert.rejects(wait.execute({ state: { ...state, planningRequired: undefined } }, f.context, {}), /WAIT/)
  assert.equal(reason, `active_task:${observation.sessionId}:perception`)
  assert.equal(f.dispatches.some(effect => effect.payload.type === 'environment_command'), false)
})

for (const outcome of ['resume', 'unknown', 'manual', 'reconnect', 'expired', 'stale'] as const) {
  test(`operator candidate HTTP request reaches existing owner: ${outcome}`, async () => {
    const { openExecutionStore } = await import('../durable-execution/storage.js')
    const { getQueueSystem } = await import('../queue/queue-system.js')
    const { handleHttpRequest } = await import('../api/adapters/http.js')
    const { handleConfirmQueueCandidate } = await import('../api/handlers/unified-queue.js')
    const { beginAuthenticatedRuntime, getAuthenticatedRuntimeId } = await import('../sessions.js')
    if (!getAuthenticatedRuntimeId()) beginAuthenticatedRuntime()
    fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
    fs.copyFileSync(new URL('../../../../etc/queue.json', import.meta.url), path.join(root, 'etc/queue.json'))
    const system = getQueueSystem()
    await singlePersonFixture(async f => {
      const store = openExecutionStore('fixture')
      try {
        const definition = { graphId: 'operator-candidate-fixture', graphHash: 'test', runtimeVersion: 'test', checkpointSchemaVersion: 1, nodeVersions: {} }
        const execution = store.create('fixture', definition)
        f.context.graphExecution.executionId = execution.executionId
        const lease = store.claim(execution.executionId, definition)
        store.settle(lease, 'waiting', `active_task:${observation.sessionId}:perception`); store.release(lease)
        f.frame(2, 0); await f.advance()
        if (outcome === 'unknown') await f.terminal('outcome_unknown')
        else await f.terminal()
        f.tick(100); f.frame(3, 1); await f.advance()
        f.tick(500); f.frame(4, 1); await f.advance()
        f.tick(500); f.frame(5, 1); await f.advance()
        const projected = f.task()
        assert.ok(projected.personResume.candidateFrame)
        assert.equal(projected.personResume.terminationConfirmed, outcome !== 'unknown')
        store.db.transaction(() => store.commitTransition(execution.executionId, 'candidate-checkpoint', {
          transitionId: 'candidate-projection', task: projected,
        }))()
        // The existing queue view reads the committed projection, not a UI state store.
        assert.deepEqual(system.getExecutions('fixture').find(item => item.executionId === execution.executionId)?.personResume, JSON.parse(JSON.stringify(projected.personResume)))
        const body = { action: 'confirm_person_candidate', sessionId: observation.sessionId,
          candidateFrame: projected.personResume.candidateFrame, confirmCandidate: true, resume: true }
        const user = { userId: 'fixture', username: 'fixture', role: 'owner' as const, isAuthenticated: true }
        const request = { path: `/api/unified-queue/executions/${execution.executionId}`, method: 'POST' as const,
          params: { id: execution.executionId }, user, body }
        assert.equal((await handleConfirmQueueCandidate({ ...request, user: { ...user, isAuthenticated: false } })).status, 401)
        assert.equal((await handleConfirmQueueCandidate({ ...request, user: { ...user, role: 'standard' } })).status, 403)
        assert.equal((await handleConfirmQueueCandidate({ ...request, user: { ...user, username: 'other-profile' } })).status, 404)
        assert.equal((await handleConfirmQueueCandidate({ ...request, body: { ...body, resume: false } })).status, 400)
        const response = await handleHttpRequest({ path: request.path, method: 'POST', body,
          headers: { host: '127.0.0.1:4321' }, resolvedUser: user, userContextEstablished: true })
        assert.equal(response.status, 202, String(response.body))
        const admitted = JSON.parse(String(response.body))
        assert.equal(admitted.status, 'requested', 'Admission does not claim resumed movement')
        const event = store.event(execution.executionId, admitted.eventId)
        assert.equal(event.kind, 'single_person_resume')
        const wakes = () => system.getAllTasks().filter(work => work.handler === 'graph.resume'
          && work.input.executionId === execution.executionId)
        assert.equal(wakes().length, 1, 'The existing Coordinator owns the wake')
        assert.equal((await handleConfirmQueueCandidate(request)).status, 202)
        assert.equal(wakes().length, 1, 'Repeated confirmation cannot enqueue another resume')
        assert.equal(f.dispatches.filter((d: any) => d.payload.input.type === 'move').length, 0)
        if (outcome === 'expired') f.tick(3000)
        if (outcome === 'stale') { f.tick(1); f.frame(6, 1) }
        if (outcome === 'manual' || outcome === 'reconnect') {
          const { getLatestEnvironmentObservation } = await import('./store.js')
          const current = getLatestEnvironmentObservation(observation.sessionId)!
          recordEnvironmentObservation({ ...current, state: { ...current.state,
            gateway: { robots: { p4: { body_command_sequence: 99 } } },
            ...(outcome === 'reconnect' ? { activeMovementUpdates: { ...current.state?.activeMovementUpdates as object, epoch: 2 } } : {}) } })
        }
        // Recovered state consumes the exact durable HTTP event through the real
        // active-task wait/step owners. No motion can be sent by the HTTP handler.
        const received = await wait.execute({ state: { ...JSON.parse(JSON.stringify(f.state())), pendingEvents: [event] } }, f.context, {})
        f.replace(received.state); await f.advance()
        const motions = () => f.dispatches.filter((d: any) => d.payload.input.type === 'move' && !d.payload.input.movementUpdate)
        assert.equal(motions().length, outcome === 'resume' ? 1 : 0)
        if (outcome === 'resume') {
          assert.notEqual(f.state().motionId, 'motion')
          assert.equal(f.task().personResume, undefined)
          await assert.rejects(() => wait.execute({ state: { ...f.state(), pendingEvents: [event] } }, f.context, {}), /WAIT/)
          assert.equal(motions().length, 1)
        } else {
          assert.ok(f.state().personLoss.resumeRejection)
          if (outcome === 'unknown') assert.equal(f.state().feedback.type, 'outcome_unknown')
        }
        system.cancelExecution('fixture', execution.executionId, 'Isolated test complete')
        assert.equal((await handleConfirmQueueCandidate(request)).status, 409)
      } finally { store.close() }
    })
    await system.dispose()
  })
}


const visionFrame = { id: 'retained-source-frame', timestamp: new Date().toISOString(),
  dataUrl: 'data:image/jpeg;base64,/9j/2Q==', metadata: { robotId: 'p4', gatewayInstance: 'gateway', epoch: 1, counter: 12 } }
const emptyVisionState = (): ActiveTaskState => ({ stepIndex: 0, updateRevision: 0, evidence: [] })
async function visionWorkResult(f: ReturnType<typeof fixture>, state: ActiveTaskState, effectId: string, result: unknown) {
  return (await wait.execute({ state: { ...state, pendingEvents: [{ kind: 'work_result', payload: {
    effectId, result: { state: 'completed', result },
  } }] } }, f.context, {})).state as ActiveTaskState
}

test('finite acquisition reads then reasons under the same task without movement or completion authority', async () => {
  const f = fixture({ steps: [{ kind: 'vision', operation: 'acquire', target: 'my keys' }] })
  const reading = await f.advance(emptyVisionState())
  assert.equal(f.dispatches[0].payload.handler, 'environment.visual-read')
  const read = await visionWorkResult(f, reading, reading.visionEffectId!, { visual: visionFrame })
  const identifying = await f.advance(read)
  assert.equal(f.dispatches[1].payload.handler, 'environment.identify')
  assert.equal(f.dispatches[1].payload.input.purpose, 'locate')
  assert.deepEqual(f.dispatches[1].payload.input.image, visionFrame)
  const acquisition = { purpose: 'locate', outcome: 'found', frame: { id: visionFrame.id, timestamp: visionFrame.timestamp, metadata: visionFrame.metadata },
    candidates: [{ box: { x: .1, y: .2, width: .3, height: .4 }, description: 'keys', evidence: 'Visible keyring' }] }
  const received = await visionWorkResult(f, identifying, identifying.identificationEffectId!, acquisition)
  assert.equal(received.stepIndex, 1)
  assert.deepEqual(received.acquisition, acquisition)
  assert.deepEqual(received.capturedFrameIds, [visionFrame.id])
  const planning = await f.advance(received)
  assert.equal(planning.planningRequired, true)
  assert.notEqual(planning.done, true)
  const handoff = await wait.execute({ state: planning }, f.context, {})
  assert.equal(handoff.continue, false)
  assert.notEqual(planning.objectiveComplete, true)
  assert.ok(f.dispatches.every(work => work.payload.type === 'generic'))
})

test('visual selection sends retained source bytes and joins the existing bridge result', async () => {
  const f = fixture({ steps: [{ kind: 'vision', operation: 'select', frameId: visionFrame.id,
    description: 'keys', box: { x: .1, y: .2, width: .3, height: .4 } }] })
  ;(f.context as any).graphExecution.frame = (id: string) => id === visionFrame.id ? visionFrame : undefined
  const sent = await f.advance(emptyVisionState())
  assert.equal(f.dispatches[0].payload.handler, 'environment.visual-read')
  assert.deepEqual(f.dispatches[0].payload.input.vision.frame, visionFrame)
  assert.equal(f.dispatches[0].payload.input.vision.frameId, undefined)
  const result = { operation: 'select', queryId: 'selected-keys', referenceFrameId: visionFrame.id }
  const received = await visionWorkResult(f, sent, sent.visionEffectId!, { vision: result })
  assert.equal(received.stepIndex, 1)
  assert.equal(received.queryId, 'selected-keys')
  assert.deepEqual(received.visionResult, result)
  assert.ok(f.dispatches.every(work => work.payload.type === 'generic'))
})

test('finished vision configuration returns evidence for planning without interrupting remaining program steps', async () => {
  for (const trailing of [false, true]) {
    const search = { kind: 'vision', operation: 'search', labels: ['chair'] } as const
    const f = fixture({ steps: [{ ...search, labels: [...search.labels] },
      ...(trailing ? [{ kind: 'vision' as const, operation: 'release' as const }] : [])] })
    const sent = await f.advance(emptyVisionState())
    const result = { operation: 'search', queryId: 'chair-search', classes: ['chair'], tracking: true }
    const received = await visionWorkResult(f, sent, sent.visionEffectId!, { vision: result })
    assert.deepEqual(received.visionResult, result)
    assert.equal(received.planningRequired === true, !trailing)
    assert.notEqual(received.objectiveComplete, true)
    const next = await f.advance(received)
    if (trailing) {
      assert.equal(f.dispatches[1].payload.input.vision.operation, 'release')
    } else {
      assert.equal((await wait.execute({ state: next }, f.context, {})).continue, false)
      assert.notEqual(next.done, true)
      assert.equal(f.dispatches.length, 1)
    }
  }
})

for (const outcome of ['positive', 'negative', 'ambiguous'] as const) {
  test(`stationary visual behavior returns its ${outcome} assessment without another capture or goal completion`, async () => {
    const f = fixture({ steps: [{ kind: 'behavior', target: 'keys', completionCriteria: 'Keys are visible',
      motion: null, candidateLabels: ['keys'], identifyEveryFrames: 1, steering: null }] })
    const previousFeedback: EnvironmentFeedback = { id: 'previous-completed', actionId: 'previous-action', type: 'completed',
      message: 'Previous action completed', timestamp: new Date().toISOString() }
    const sent = await f.advance({ ...emptyVisionState(), image: visionFrame, completedActionId: 'previous-action',
      feedback: previousFeedback, evidence: ['Previous action completed'] })
    assert.equal(sent.identificationError, undefined)
    assert.equal(sent.motionId, undefined)
    assert.equal(sent.identificationRequest?.expiresAt, undefined)
    assert.equal(f.dispatches.length, 1)
    assert.equal(f.dispatches[0].payload.handler, 'environment.identify')
    const assessment = { matchesTarget: outcome === 'positive', completionSatisfied: outcome === 'positive', outcome,
      description: 'Returned image assessment', evidence: 'Evidence from this captured frame' }
    const identified = await visionWorkResult(f, sent, sent.identificationEffectId!, assessment)
    const ready = await f.advance(identified)
    assert.equal(f.dispatches.length, 1, 'An accepted stationary assessment returns to planning before another capture')
    const finishedPhase = (await wait.execute({ state: ready }, f.context, {})).state as ActiveTaskState
    assert.equal(finishedPhase.stepIndex, 1)
    assert.equal(finishedPhase.visualCompletionSatisfied, outcome === 'positive')
    assert.equal(finishedPhase.planningRequired, true)
    assert.deepEqual(JSON.parse(finishedPhase.evidence[1]).result, assessment)
    assert.deepEqual(JSON.parse(finishedPhase.evidence[1]).frameIds, [visionFrame.id])
    assert.equal(finishedPhase.completedActionId, 'previous-action')
    assert.deepEqual(finishedPhase.feedback, previousFeedback)
    const final = await f.advance(finishedPhase)
    assert.equal((await wait.execute({ state: final }, f.context, {})).continue, false)
    assert.notEqual(final.objectiveComplete, true, 'Finishing an observation is not proof of whole-goal success')
    assert.equal(f.task().decision.objectiveComplete, false)
    assert.equal(f.dispatches.length, 1, 'Stationary assessment cannot issue Finish or other servo work')
    const { environmentActiveTaskNode } = await import('../nodes/environment/active-task.node.js')
    const graphDir = path.join(root, 'etc', 'cognitive-graphs')
    fs.mkdirSync(graphDir, { recursive: true })
    fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/robot-active-task-mode.json', import.meta.url),
      path.join(graphDir, 'robot-active-task-mode.json'))
    const output = await environmentActiveTaskNode.execute({ program: (f.context as any).activeProgram,
      taskDecision: decision, sessionId: observation.sessionId }, { username: 'fixture', graphExecution: {
      callGraph: async () => ({ nodes: new Map([['wait', { definition: { type: 'environment_active_task_wait' },
        status: 'completed', outputs: { state: final } }]]) }),
      frame: (id: string) => id === visionFrame.id ? visionFrame : undefined, task: f.task,
    } } as any, {})
    assert.equal(output.completed, false)
    assert.deepEqual(JSON.parse(output.planningResult.environmentTaskEvidence.evidence[1]).result, assessment)
    assert.deepEqual(output.planningResult.activeTaskContinuation.state.feedback, previousFeedback)
    assert.equal(output.planningResult.activeTaskContinuation.state.planningRequired, undefined)
    assert.equal(output.resultObservation.visual.id, visionFrame.id)
  })
}

test('stationary assessment preserves remaining programmed steps before the planning handoff', async () => {
  const f = fixture({ steps: [{ kind: 'behavior', target: 'keys', completionCriteria: 'Keys are visible',
    motion: null, candidateLabels: ['keys'], identifyEveryFrames: 1, steering: null },
    { kind: 'vision', operation: 'release' }] })
  const sent = await f.advance({ ...emptyVisionState(), image: visionFrame })
  const assessment = { matchesTarget: false, completionSatisfied: false, outcome: 'negative',
    description: 'No keys visible', evidence: 'No matching target in this frame' }
  const identified = await visionWorkResult(f, sent, sent.identificationEffectId!, assessment)
  const ready = await f.advance(identified)
  assert.equal(f.dispatches.length, 1)
  const observed = (await wait.execute({ state: ready }, f.context, {})).state as ActiveTaskState
  assert.equal(observed.stepIndex, 1)
  assert.notEqual(observed.planningRequired, true)
  const releasing = await f.advance(observed)
  assert.equal(f.dispatches.length, 2)
  assert.equal(f.dispatches[1].payload.input.vision.operation, 'release')
  const released = await visionWorkResult(f, releasing, releasing.visionEffectId!, { vision: { operation: 'release' } })
  assert.equal(released.stepIndex, 2)
  assert.equal(released.planningRequired, true)
  assert.deepEqual(JSON.parse(released.evidence[0]).result, assessment)
  assert.deepEqual(JSON.parse(released.evidence[1]).result, { operation: 'release' })
  assert.notEqual(released.objectiveComplete, true)
})

test('selected-track steering follows that instance across reordered same-class detections', async () => {
  const f = fixture({ steps: [{ ...search.steps[0], steering: { label: 'cup', gain: 100, trackId: 'query-a:2' } } as any] })
  const objects = [
    { label: 'cup', trackId: 'query-a:1', box: { x: .1, y: .2, width: .2, height: .3 } },
    { label: 'cup', trackId: 'query-a:2', box: { x: .7, y: .2, width: .2, height: .3 } },
  ]
  const observe = (counter: number, items: typeof objects) => {
    const now = Date.now()
    recordEnvironmentObservation({ ...observation, state: { ...observation.state,
      body: { authenticated: true, cameraReady: true, robotId: 'p4' },
      gateway: { robots: { p4: { epoch: 1, connection_state: 'online' } } }, perception: {
      version: 1, timeBasis: 'gateway_receipt', robotId: 'p4', epoch: 1, gatewayInstance: 'gateway',
      frameCounter: counter, queryId: 'selected-cup', observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 1000).toISOString(), backend: 'fixture', model: 'fixture',
      summary: 'Two cups', objects: items, uncertainties: [],
    } } })
  }
  try {
    observe(1, objects)
    const sent = await f.advance({ ...f.state, snapshotId: 'pending-capture' })
    const updates = () => f.dispatches.filter(item => item.payload.input?.movementUpdate)
    assert.equal(updates().length, 1)
    assert.equal(updates()[0].payload.input.movementUpdate.actionId, 'motion')
    assert.ok(Math.abs(updates()[0].payload.input.movementUpdate.controls.turn - (-10)) < 1e-9)
    const acknowledged = await f.receive(sent, sent.pendingControls!.commandId, 'completed')
    observe(2, [objects[1], objects[0]])
    await f.advance(acknowledged)
    assert.equal(updates().length, 1, 'Detection order cannot change selected-instance steering')
    observe(3, [{ ...objects[1], box: { ...objects[1].box, x: .3 } }, objects[0]])
    await f.advance(acknowledged)
    assert.equal(updates().length, 2)
    assert.ok(Math.abs(updates()[1].payload.input.movementUpdate.controls.turn - 30) < 1e-9)
    assert.equal(updates()[1].payload.input.movementUpdate.revision, 2)
    assert.equal(updates()[1].payload.input.movementUpdate.actionId, 'motion')
  } finally { recordEnvironmentObservation(observation) }
})


test('acquisition continuation preserves instruction admission and consumes no synthetic user event', async () => {
  const { executionEventWaitNode } = await import('../nodes/utility/execution-event-wait.node.js')
  const entry = { role: 'user', content: 'Find my keys', timestamp: 123, meta: { idempotencyKey: 'original-turn' } }
  const workResult = { environmentTaskEvidence: { kind: 'vision_acquisition', frameId: visionFrame.id },
    activeTaskContinuation: { program: { steps: [{ kind: 'vision', operation: 'acquire', target: 'my keys' }] }, state: { stepIndex: 1 } } }
  const context = { _graphExecutorIteration: 1, userMessage: entry.content,
    graphExecution: { pendingEvents: () => [], waitForEvent: () => { throw new Error('No new user event exists') } } }
  const inputs = { workResult, instructionEntry: entry }
  const result = await executionEventWaitNode.execute(inputs, context as any, { drain: true, resultGraph: 'environment' })
  assert.equal(result.invocation.graph, 'environment')
  assert.equal(result.invocation.context.userMessageEntry, entry)
  assert.deepEqual(result.invocation.context.environmentTaskEvidence, workResult.environmentTaskEvidence)
  assert.deepEqual(result.invocation.context.executionEvents, [])
  assert.equal(result.invocation.context.userMessage, undefined, 'The child inherits the original request, not a fabricated new message')
  const later = await executionEventWaitNode.execute(inputs, { ...context, _graphExecutorIteration: 2 } as any, { drain: true })
  assert.equal(later.invocation, null, 'A later event-tail pass cannot replay the acquisition handoff')
  const autonomous = await executionEventWaitNode.execute(inputs, context as any, { drain: true, resultGraph: 'environment' })
  assert.equal(autonomous.invocation.graph, 'environment')
  const pending = [{ kind: 'user_steering', payload: { userMessage: 'Release the target', userMessageEntry: { ...entry, content: 'Release the target' } } }]
  const correction = await executionEventWaitNode.execute(inputs, { ...context,
    graphExecution: { pendingEvents: () => pending, waitForEvent: () => pending.shift() } } as any,
    { drain: true, userGraph: 'environment', resultGraph: 'environment' })
  assert.equal(correction.invocation.graph, 'environment')
  assert.equal(correction.invocation.context.userMessage, 'Release the target')
  assert.deepEqual(correction.invocation.context.environmentTaskEvidence, workResult.environmentTaskEvidence)
})


test('ended-session evidence releases a continuous task without completing its objective or running its next step', async () => {
  const f = fixture({ steps: [...program.steps, { kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] })
  let state = await f.receive(f.state, 'motion', 'outcome_unknown')
  state = await f.advance(state)
  assert.equal(state.done, undefined)
  const ended = await f.receive(state, 'motion', 'outcome_unknown', { executionEnded: true,
    sessionReplacement: { previous: { gatewayInstance: 'gateway', epoch: 1 }, current: { gatewayInstance: 'gateway', epoch: 2 } } })
  const before = f.dispatches.length
  const finished = await f.advance(ended)
  assert.equal(finished.done, true)
  assert.equal(finished.objectiveComplete, false)
  assert.equal(finished.motionId, undefined)
  assert.equal(finished.feedback?.type, 'outcome_unknown')
  assert.equal(f.task().feedback.executionEnded, true)
  assert.equal(finished.stepIndex, 0)
  assert.equal(f.dispatches.slice(before).some(item => item.payload.type === 'environment_command'), false)
  const graphExecution = (f.context as any).graphExecution
  Object.assign(graphExecution, { events: () => [], activeExecutions: () => [] })
  assert.equal((await executionContextNode.execute({}, f.context, {})).needsGoalReview, true,
    'The existing reviewer receives the unresolved objective once execution has ended')
})

for (const operation of ['acquire', 'select'] as const) {
  test(`unretained ${operation} reference returns failure evidence without retrying or dispatching`, async () => {
    const f = fixture({ steps: [operation === 'acquire'
      ? { kind: 'vision', operation, target: 'user', referenceFrameId: 'None' }
      : { kind: 'vision', operation, frameId: 'None', description: 'user', box: { x: .1, y: .2, width: .3, height: .4 } }] })
    ;(f.context as any).graphExecution.frame = () => undefined
    const result = await f.advance({ ...emptyVisionState(), image: visionFrame })
    assert.equal(result.done, true)
    assert.equal(result.objectiveComplete, false)
    assert.equal(typeof result.identificationError, 'string')
    assert.match(String(result.identificationError), /not retained by this execution/)
    assert.equal(result.failure, undefined, 'A missing reference is not a physical receipt')
    assert.equal(f.dispatches.length, 0)
    assert.equal((await wait.execute({ state: result }, f.context, {})).continue, false)
    const replay = await f.advance(result)
    assert.equal(replay.identificationError, result.identificationError)
    assert.equal(f.dispatches.length, 0)
  })
}

test('locomotion endpoint requests Finish once and requires original terminal receipt, not update ACK', async () => {
  const goal = { kind: 'distance' as const, direction: 'forward' as const, metres: 1, tolerance: .05 }
  const action = { ...motion, locomotionGoal: goal }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  const source = { available: true, source: 'calibrated-ground-plane', robotId: 'p4', referenceId: 'plane', observedAt: new Date().toISOString(),
    xMetres: 0, yMetres: 0, headingDegrees: 0, uncertaintyMetres: .02 }
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, locomotionMeasurement: { position: { ...source, xMetres: 1 } } } })
  const state = { ...f.state, action, locomotion: { initial: { position: source }, latest: { position: source }, reached: false } }
  let result = await f.advance(state)
  assert.equal(result.locomotion?.reached, true)
  assert.equal(JSON.parse(result.pendingControls!.controls).speed, 0)
  const finishId = result.pendingControls!.commandId
  result = await f.advance(result)
  assert.equal(f.dispatches.length, 1, 'repeated observation does not issue another Finish while the exact update is pending')
  result = await f.receive(result, finishId, 'completed')
  assert.equal(result.stepIndex, 0)
  result = await f.receive(result, 'motion', 'completed')
  assert.equal(result.stepIndex, 1)
  assert.match(result.evidence.join('\n'), /locomotionGoal/)
  recordEnvironmentObservation(observation)
})

test('locomotion missing evidence does not start; evidence loss finishes existing motion and remains incomplete', async () => {
  const action = { ...motion, locomotionGoal: { kind: 'relativeTurn' as const, degrees: 90, tolerance: 2 } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, locomotionMeasurement: { yaw: { available: false, reason: 'IMU unavailable' } } } })
  const notStarted = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  assert.equal(notStarted.done, true)
  assert.equal(f.dispatches.length, 0)
  assert.equal(notStarted.objectiveComplete, false)
  let running = await f.advance({ ...f.state, action })
  assert.equal(JSON.parse(running.pendingControls!.controls).speed, 0)
  running = await f.receive(running, 'motion', 'completed')
  assert.equal(running.stepIndex, 0)
  assert.equal(running.objectiveComplete, false)
  assert.match(running.identificationError!.toString(), /IMU unavailable/)
  recordEnvironmentObservation(observation)
})

test('locomotion uses the source expiry deadline to finish when telemetry falls silent', async t => {
  const now = Date.now()
  t.mock.timers.enable({ apis: ['Date'], now })
  const action = { ...motion, locomotionGoal: { kind: 'relativeTurn' as const, degrees: 90, tolerance: 2 } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  const source = { available: true, source: 'imu', robotId: 'p4', referenceId: 'boot', observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 50).toISOString(), degrees: 0, uncertaintyDegrees: null }
  recordEnvironmentObservation({ ...observation, timestamp: new Date(now).toISOString(), state: { ...observation.state, locomotionMeasurement: { yaw: source } } })
  let result = await f.advance({ ...f.state, action })
  assert.equal(result.deadlineAt, now + 50)
  const wake = result.deadlineEffectId
  if (result.pendingControls) result = await f.receive(result, result.pendingControls.commandId, 'completed')
  t.mock.timers.setTime(now + 51)
  result = (await wait.execute({ state: { ...result, pendingEvents: [{ kind: 'work_result', payload: { effectId: wake, result: { state: 'completed' } } }] } }, f.context, {})).state
  result = await f.advance(result)
  assert.equal(JSON.parse(result.pendingControls!.controls).speed, 0)
  assert.equal(result.locomotion?.reached, false)
  assert.match(result.locomotion!.incomplete!, /unavailable/)
  t.mock.timers.reset()
  recordEnvironmentObservation(observation)
})

test('locomotion wait subscribes only to its selected sensor event channel', async () => {
  const action = { ...motion, locomotionGoal: { kind: 'relativeTurn' as const, degrees: 90, tolerance: 2 } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  let reason = ''
  ;(f.context as any).graphExecution.waitForEvent = (value: string) => { reason = value; throw new Error('WAIT') }
  await assert.rejects(wait.execute({ state: { ...f.state, action } }, f.context, {}), /WAIT/)
  assert.equal(reason, `active_task:${observation.sessionId}:perception:locomotion`)
})

test('locomotion metric target acquisition sends the exact retained frame before any gait admission', async () => {
  const target = { frameId: 'retained-source', frameTimestamp: new Date().toISOString(), box: { x: .1, y: .2, width: .3, height: .4 },
    groundContact: { x: .25, y: .6 } }
  const action = { ...motion, locomotionGoal: { kind: 'approach' as const, target, proximity: { kind: 'metric' as const, metres: 1, tolerance: .1 } } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  ;(f.context as any).graphExecution.frame = (id: string) => id === target.frameId ? { id, timestamp: target.frameTimestamp,
    dataUrl: 'data:image/jpeg;base64,c291cmNl', metadata: { robotId: 'p4', epoch: 3 } } : undefined
  let result = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  const request = f.dispatches[0].payload
  assert.equal(request.handler, 'environment.visual-read')
  assert.deepEqual(request.input.vision.groundContact, target.groundContact)
  assert.equal(request.input.vision.sourceFrame.jpeg, 'c291cmNl')
  assert.equal(request.input.vision.sourceFrame.frameId, 'retained-source')
  assert.equal(result.motionId, undefined)
  result = (await wait.execute({ state: { ...result, pendingEvents: [{ kind: 'work_result', payload: {
    effectId: result.visionEffectId, result: { state: 'completed', result: { vision: { locomotionMeasurement: { target: {
      available: false, reason: 'Ground point could not be tracked', source: 'calibrated-ground-plane', robotId: 'p4', referenceId: 'plane',
      frameId: target.frameId, observedAt: target.frameTimestamp, uncertaintyMetres: null,
    } } } } } } }] } }, f.context, {})).state
  assert.equal(result.stepIndex, 0, 'Range acquisition is not completion of the selected approach')
  result = await f.advance(result)
  assert.equal(result.done, true)
  assert.equal(result.objectiveComplete, false)
  assert.equal(f.dispatches.filter(d => d.payload.handler === 'environment.command').length, 0)
})

test('locomotion follow passes its selected ending condition to the existing asynchronous evaluator', async () => {
  const now = new Date().toISOString()
  const target = { frameId: 'target-frame', frameTimestamp: now, box: { x: .2, y: .2, width: .3, height: .4 }, trackId: 'track', groundContact: { x: .3, y: .6 } }
  const goal = { kind: 'follow' as const, target, proximity: { kind: 'metric' as const, metres: 1, tolerance: .1 }, endingCondition: 'The target reaches the doorway' }
  const action = { ...motion, locomotionGoal: goal }
  const f = fixture({ steps: [{ kind: 'behavior', motion: action, target: 'selected target', completionCriteria: 'Different phase text', candidateLabels: [], identifyEveryFrames: 10, steering: null }] })
  const measurement = { target: { available: true, source: 'calibrated-ground-plane', robotId: 'p4', referenceId: 'plane',
    frameId: 'current-frame', observedAt: now, trackId: 'track', groundContact: target.groundContact, rangeMetres: 1, uncertaintyMetres: .02 } }
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, locomotionMeasurement: measurement } })
  const state = { ...f.state, action, locomotionTargetAcquired: true, image: { id: 'current-frame', timestamp: now, dataUrl: 'data:image/jpeg;base64,c291cmNl' } }
  const result = await f.advance(state)
  const inference = f.dispatches.find(d => d.payload?.handler === 'environment.identify')
  assert.equal(inference.payload.input.completionCriteria, goal.endingCondition)
  assert.equal(result.locomotion?.reached, false)
  assert.equal(result.finishRequestedAt, undefined)
  recordEnvironmentObservation(observation)
})

test('locomotion image-relative target loss cannot reuse an earlier matching box as current evidence', async () => {
  const now = Date.now()
  const target = { frameId: 'selected', frameTimestamp: new Date(now).toISOString(), box: { x: .2, y: .2, width: .2, height: .2 }, trackId: 'chosen' }
  const action = { ...motion, locomotionGoal: { kind: 'approach' as const, target, proximity: { kind: 'imageRelative' as const, boxHeight: .5, tolerance: .02 } } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  const oldTarget = { available: true, source: 'visual-tracking', robotId: 'p4', referenceId: 'old', frameId: 'selected', trackId: 'chosen',
    observedAt: new Date(now - 1).toISOString(), expiresAt: new Date(now + 1000).toISOString(), boxHeight: .2, uncertaintyMetres: null }
  const perception = { version: 1, robotId: 'p4', epoch: 1, gatewayInstance: 'gateway', frameCounter: 2, timeBasis: 'gateway_receipt',
    observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1000).toISOString(), backend: 'fixture', model: 'fixture', summary: 'No matching target', objects: [], uncertainties: [] }
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, perception, locomotionMeasurement: { target: oldTarget } } })
  let state = await f.advance({ ...f.state, action, locomotion: { initial: { target: oldTarget }, latest: { target: oldTarget }, reached: false } })
  assert.equal(JSON.parse(state.pendingControls!.controls).speed, 0)
  assert.match(state.locomotion!.incomplete!, /absent/)
  state = await f.receive(state, 'motion', 'completed')
  assert.equal(state.objectiveComplete, false)
  assert.equal(state.stepIndex, 0)
  recordEnvironmentObservation(observation)
})

for (const failed of [false, true]) test(`locomotion frame-box selection ${failed ? 'failure stays incomplete' : 'returns actual receipt for track selection'} without starting a gait`, async () => {
  const target = { frameId: 'exact-source', frameTimestamp: new Date().toISOString(), box: { x: .2, y: .3, width: .1, height: .2 } }
  const goal = { kind: 'approach' as const, target, proximity: { kind: 'imageRelative' as const, boxHeight: .5, tolerance: .05 } }
  const f = fixture({ steps: [{ kind: 'action', action: { ...motion, locomotionGoal: goal } }] })
  const frame = { id: target.frameId, timestamp: target.frameTimestamp, dataUrl: 'data:image/jpeg;base64,c291cmNl' }
  ;(f.context as any).graphExecution.frame = (id: string) => id === frame.id ? frame : undefined
  let state = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  assert.deepEqual(f.dispatches[0].payload.input.vision, { operation: 'select', frame, box: target.box, description: decision.objective })
  assert.equal(state.motionId, undefined)
  const receipt = { operation: 'select', queryId: 'actual-query', referenceFrameId: frame.id, tracking: true }
  const result = failed ? { state: 'failed', error: { message: 'Selected source could not be decoded' } }
    : { state: 'completed', result: { vision: receipt } }
  state = (await wait.execute({ state: { ...state, pendingEvents: [{ kind: 'work_result', payload: { effectId: state.visionEffectId, result } }] } }, f.context, {})).state
  state = await f.advance(state)
  assert.equal(state.stepIndex, 0, 'Selection does not fulfill the movement goal')
  assert.equal(state.motionId, undefined)
  assert.equal(f.dispatches.filter(d => d.payload.handler === 'environment.command').length, 0)
  if (failed) {
    assert.match(String(state.identificationError), /could not be decoded/)
    assert.equal(state.objectiveComplete, false)
  } else {
    assert.deepEqual(state.visionResult, receipt)
    assert.equal(state.queryId, receipt.queryId)
    assert.equal(state.planningRequired, true)
    assert.equal(JSON.parse(state.evidence.at(-1)!).motionStarted, false)
    assert.deepEqual(JSON.parse(state.evidence.at(-1)!).locomotionGoal, goal)
    assert.equal(f.dispatches.length, 1, 'Returning for planning never reissues selection or starts a gait')
  }
})

for (const lateral of [true, false]) test(`locomotion Crab correction preserves motion ownership with lateral support ${lateral}`, async () => {
  const now = new Date().toISOString()
  const position = { available: true, source: 'calibrated-ground-plane', robotId: 'p4', referenceId: 'plane', observedAt: now,
    xMetres: 0, yMetres: 0, headingDegrees: 0, uncertaintyMetres: null }
  const action = { ...motion, gait: 'crab' as const, direction: 'left' as const,
    locomotionGoal: { kind: 'distance' as const, direction: 'left' as const, metres: 1, tolerance: .05 } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  recordEnvironmentObservation({ ...observation, capabilities: { ...observation.capabilities,
    locomotion: { commands: ['crab'], goalKinds: ['distance'], lateral } },
    state: { ...observation.state, locomotionMeasurement: { position: { ...position, yMetres: 1.2 } } } })
  const state = await f.advance(lateral ? { ...f.state, action, locomotion: { initial: { position }, latest: { position }, reached: false } }
    : { stepIndex: 0, updateRevision: 0, evidence: [] })
  if (!lateral) {
    assert.equal(state.done, true)
    assert.equal(state.objectiveComplete, false)
    assert.match(String(state.identificationError), /requires negotiated lateral/)
    assert.equal(f.dispatches.length, 0)
    recordEnvironmentObservation(observation)
    return
  }
  const controls = JSON.parse(state.pendingControls!.controls)
  assert.equal(state.motionId, 'motion')
  assert.equal(state.pendingControls!.motionId, 'motion')
  assert.equal(state.objectiveComplete, undefined)
  assert.equal(state.finishRequestedAt, undefined)
  if (lateral) {
    assert.equal(controls.lateral, -100)
    assert.ok(Math.abs(controls.forward) < 1e-12)
    assert.equal(controls.turn, 0)
  }
  recordEnvironmentObservation(observation)
})

test('supported lateral updates retain simultaneous forward and turn under the original command', async () => {
  recordEnvironmentObservation({ ...observation, capabilities: { ...observation.capabilities,
    locomotion: { commands: ['crab'], goalKinds: ['visual'], lateral: true } } })
  const action = { ...motion, gait: 'crab' as const, forward: 40, turn: -20, lateral: 35 }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  const state = await f.advance({ ...f.state, action })
  assert.deepEqual(JSON.parse(state.pendingControls!.controls), { speed: motion.speed, forward: 40, turn: -20, lateral: 35 })
  assert.equal(state.pendingControls!.motionId, 'motion')
  recordEnvironmentObservation(observation)
})

for (const available of [true, false]) test(`locomotion visual goal uses camera availability ${available} without recognition`, async () => {
  const bridge = await import('./store.js')
  bridge.setEnvironmentBridgeEnabled(true)
  const unsubscribe = bridge.subscribeEnvironmentActions(observation.sessionId, () => {})
  const now = Date.now()
  const camera = { available, source: 'camera-frame', robotId: 'p4', referenceId: 'camera-session', frameId: 'frame',
    observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10000).toISOString(), ...(!available ? { reason: 'camera unavailable' } : {}) }
  const action = { ...motion, locomotionGoal: { kind: 'visual' as const, target: 'selected target', completionCriteria: 'Selected view is visible' } }
  const f = fixture({ steps: [{ kind: 'behavior', motion: action, target: 'selected target', completionCriteria: 'Selected view is visible',
    candidateLabels: [], identifyEveryFrames: 10, steering: null }] })
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, body: { authenticated: true, robotId: 'p4' }, locomotionMeasurement: { camera } } })
  const state = await f.advance({ stepIndex: 0, updateRevision: 0, evidence: [] })
  assert.equal(state.perception, undefined)
  if (available) {
    assert.ok(state.motionId)
    assert.ok(state.snapshotId)
    assert.equal(state.planningRequired, undefined, 'No recognition gap is invented for a camera-only goal')
    assert.equal(state.deadlineAt, Date.parse(camera.expiresAt))
  } else {
    assert.equal(state.motionId, undefined)
    assert.equal(state.objectiveComplete, false)
    assert.equal(state.done, true)
    assert.equal(f.dispatches.length, 0)
  }
  unsubscribe()
  bridge.setEnvironmentBridgeEnabled(false)
  recordEnvironmentObservation(observation)
})

test('locomotion visual camera loss during inference requests Finish but waits for original termination', async () => {
  const action = { ...motion, locomotionGoal: { kind: 'visual' as const, target: 'selected target', completionCriteria: 'Selected view is visible' } }
  const f = fixture({ steps: [{ kind: 'behavior', motion: action, target: 'selected target', completionCriteria: 'Selected view is visible',
    candidateLabels: [], identifyEveryFrames: 10, steering: null }] })
  const camera = { available: true, source: 'camera-frame', robotId: 'p4', referenceId: 'camera-session',
    observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10000).toISOString() }
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, body: { authenticated: true, robotId: 'p4' }, locomotionMeasurement: { camera } } })
  const image = { id: 'original-evaluator-frame', timestamp: new Date(Date.now() - 10000).toISOString(), dataUrl: 'data:image/jpeg;base64,c291cmNl' }
  let state = await f.advance({ ...f.state, action, image })
  assert.ok(state.identificationEffectId)
  assert.equal(state.identificationRequest?.expiresAt, undefined, 'Current camera freshness is separate from the historical inference image')
  state = await f.advance(state)
  assert.equal(state.finishRequestedAt, undefined, 'Slow inference does not imply loss of the live camera')
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, locomotionMeasurement: { camera: { ...camera, available: false, reason: 'camera stream lost' } } } })
  // Acknowledge the in-flight steering update before observing the requested Finish.
  if (state.pendingControls) state = await f.receive(state, state.pendingControls.commandId, 'completed')
  state = await f.advance(state)
  assert.equal(JSON.parse(state.pendingControls!.controls).speed, 0)
  assert.match(state.locomotion!.incomplete!, /camera stream lost/)
  state = await f.receive(state, state.pendingControls!.commandId, 'completed')
  recordEnvironmentObservation({ ...observation, state: { ...observation.state, locomotionMeasurement: { camera } } })
  state = await f.advance(state)
  assert.match(state.locomotion!.incomplete!, /camera stream lost/, 'Recovered camera does not erase the interrupted goal outcome')
  assert.equal(state.done, undefined, 'Finish ACK is not original gait termination')
  state = await f.receive(state, 'motion', 'completed')
  assert.equal(state.done, true)
  assert.equal(state.objectiveComplete, false)
  recordEnvironmentObservation(observation)
})

for (const selectedLateral of [undefined, 35]) test(`locomotion Finish clears ${selectedLateral === undefined ? 'controller-derived' : 'model-selected'} lateral while retaining original receipt ownership`, async () => {
  const position = { available: true, source: 'calibrated-ground-plane', robotId: 'p4', referenceId: 'plane', observedAt: new Date().toISOString(),
    xMetres: 0, yMetres: 0, headingDegrees: 0, uncertaintyMetres: null }
  const action = { ...motion, gait: 'crab' as const, lateral: selectedLateral,
    locomotionGoal: { kind: 'distance' as const, direction: 'left' as const, metres: 1, tolerance: .05 } }
  const f = fixture({ steps: [{ kind: 'action', action }] })
  recordEnvironmentObservation({ ...observation, capabilities: { ...observation.capabilities,
    locomotion: { commands: ['crab'], goalKinds: ['distance'], lateral: true } },
    state: { ...observation.state, locomotionMeasurement: { position: { ...position, yMetres: 1 } } } })
  let state = await f.advance({ ...f.state, action, locomotion: { initial: { position }, latest: { position }, reached: false } })
  assert.equal(JSON.parse(state.pendingControls!.controls).lateral, 0)
  assert.equal(JSON.parse(state.pendingControls!.controls).speed, 0)
  state = await f.receive(state, state.pendingControls!.commandId, 'completed')
  assert.equal(state.stepIndex, 0)
  state = await f.receive(state, 'motion', 'completed')
  assert.equal(state.stepIndex, 1)
  recordEnvironmentObservation(observation)
})
