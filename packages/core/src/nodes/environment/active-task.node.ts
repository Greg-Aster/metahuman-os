import { randomUUID } from 'node:crypto'
import { defineNode, type NodeExecutionContext } from '../types.js'
import { getLatestEnvironmentObservation, getEnvironmentPerception, prepareEnvironmentCommand } from '../../environment-interface/store.js'
import type { EnvironmentTaskProgram, ActiveTaskState, ActiveTaskContinuation } from '../../environment-interface/active-task.js'
import { observeSinglePerson, personFrameKey } from '../../environment-interface/active-task.js'
import type { EnvironmentAction, EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/types.js'
import type { EnvironmentTaskDecision } from './helpers.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { requireGraphNodeOutput } from '../../graph-runtime.js'
import { environmentSendActionNode } from './send-action.node.js'
import { environmentFaceExpressionNode } from './expression.node.js'
import { interpretationBody } from '../../environment-interface/interpretation.js'
import { graphContextSnapshot } from '../../durable-execution/graph-contract.js'
import { projectRobotStatus } from '../robot-status/out.node.js'

const INTERPRETATION_OWNER_CHANGED = 'Body ownership or session changed while interpreting; pending instructions were not applied'
const FEEDBACK_START_GRACE_MS = 2_000
const FINISH_TIMEOUT_MS = 5_000
const CANCELLATION_CONFIRMATION_MS = 2_000
const terminalTypes = ['completed', 'failed', 'rejected', 'expired', 'cancelled']

// The graph records cancellation intent; only the existing Coordinator mutates
// work ownership. This also works when a graph runs outside that owner process.
function cancelOwnedWork(context: NodeExecutionContext, input: Record<string, unknown>) {
  return context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: {
    type: 'generic', handler: 'environment.cancel-owned-work', resource: `environment-cleanup:${context.activeTaskSessionId}`,
    source: 'environment', username: context.username, priority: 'critical', maxAttempts: 1,
    input: { ...input, sessionId: context.activeTaskSessionId },
  } })
}
function clearDeadline(state: ActiveTaskState, context: NodeExecutionContext) {
  if (state.deadlineEffectId) cancelOwnedWork(context, { deadlineEffectId: state.deadlineEffectId })
  delete state.deadlineEffectId; delete state.deadlineAt
}

// A terminal receipt settles command identity before input may reuse a program.
// Keep the receipt/failure as evidence, never as an active movement to adopt.
function settleAction(state: ActiveTaskState, context: NodeExecutionContext) {
  clearDeadline(state, context)
  if (state.motionId) state.completedActionId = state.motionId
  for (const field of ['motionId', 'action', 'accepted', 'snapshotId', 'identificationEffectId', 'identificationRequest', 'generationEffectId', 'image', 'identification', 'lastIdentifiedFrame', 'finishRequestedAt', 'cancellationRequestedAt', 'feedbackRequiredSince', 'pendingControls', 'desiredControls', 'acknowledgedControls', 'retrySteering', 'captureRequestedAt', 'captureCompleted'] as const) delete state[field]
  state.updateRevision = 0
}

// Only a correlated receipt from the existing gateway wire owner can move this
// program's fence. Observations may describe manual control and are never authority.
function advanceInterpretationFence(state: ActiveTaskState, feedback: import('../../environment-interface/types.js').EnvironmentFeedback) {
  if (!state.interpretationFence) return
  const previous = JSON.parse(state.interpretationFence) as unknown[]
  const next = feedback.data?.interpretationBody
  if (!Array.isArray(next) || next.length !== 5 || next.slice(0, 4).some((value, index) => value !== previous[index])
    || !Number.isSafeInteger(next[4]) || (typeof previous[4] === 'number' && next[4] < previous[4])) return
  state.interpretationFence = JSON.stringify(next)
}

function observationReference(observation: EnvironmentObservation): EnvironmentObservation {
  const reference = ({ dataUrl: _pixels, ...frame }: EnvironmentVisualFrame) => frame
  return { ...observation, visual: observation.visual ? reference(observation.visual) : undefined,
    visuals: observation.visuals?.map(reference) }
}

export const environmentActiveTaskNode = defineNode({
  id: 'environment_active_task', name: 'Execute Robot Task', category: 'environment', version: '2.1.0',
  execution: { timeoutOwner: 'children' },
  description: 'Owns the complete task program within the existing durable execution.',
  inputs: [{ name: 'program', type: 'object', description: 'MetaHuman-selected ordered actions and ongoing behaviors' },
    { name: 'taskDecision', type: 'object', description: 'Whole objective and completion criteria' },
    { name: 'sessionId', type: 'string', description: 'Current body session' },
    { name: 'userInput', type: 'object', optional: true, description: 'Input received while preparing the selected program' }],
  outputs: [{ name: 'finished', type: 'boolean', description: 'Program reached completion or a reported physical failure' },
    { name: 'completed', type: 'boolean', description: 'All task phases completed' },
    { name: 'result', type: 'object', description: 'Execution progress and phase evidence' },
    { name: 'userInput', type: 'object', description: 'New instruction returned to existing intent routing' },
    { name: 'taskDecision', type: 'object', description: 'Decision from this execution' },
    { name: 'observation', type: 'object', description: 'Latest observation references' },
    { name: 'resultObservation', type: 'object', description: 'Returned observation with captured frames resolved from this execution' },
    { name: 'resultContext', type: 'object', description: 'Observed results returned to the existing objective review' }],
  async execute(inputs, context) {
    const continuation = context.activeTaskContinuation as ActiveTaskContinuation | undefined
    const selected = inputs.program as EnvironmentTaskProgram
    let initial: ActiveTaskState | undefined
    // A pending restricted attempt must remain with its receipt owner, even if
    // interpretation proposes a replacement. Only an explicit operator event
    // in that owner can select a candidate and resume.
    if (continuation?.state.personLoss) throw new Error('Single-person attempt requires operator selection and termination reconciliation')
    if (continuation && JSON.stringify(selected) === JSON.stringify(continuation.program)) {
      initial = { ...continuation.state }; delete initial.userInput
    } else if (continuation) {
      const first = selected.steps[0]
      const nextMotion = first?.kind === 'behavior' ? first.motion
        : first?.kind === 'action' && first.action.continuous ? first.action : null
      const currentMotion = continuation.state.action
      if (nextMotion && currentMotion?.continuous && nextMotion.type === currentMotion.type
        && nextMotion.command === currentMotion.command && nextMotion.gait === currentMotion.gait) {
        const current = continuation.program.steps[continuation.state.stepIndex]
        const sameBehavior = first.kind === 'behavior' && current?.kind === 'behavior'
          && first.target === current.target && first.completionCriteria === current.completionCriteria
        initial = { ...(sameBehavior ? continuation.state : {}), stepIndex: 0, evidence: [], motionId: continuation.state.motionId,
          accepted: continuation.state.accepted, action: nextMotion,
          updateRevision: continuation.state.updateRevision, desiredControls: continuation.state.desiredControls,
          acknowledgedControls: continuation.state.acknowledgedControls, pendingControls: continuation.state.pendingControls,
          steeringResult: continuation.state.steeringResult }
      }
      if (!initial && continuation.state.pendingControls) initial = {
        stepIndex: 0, evidence: [], updateRevision: continuation.state.updateRevision,
        motionId: continuation.state.motionId, accepted: continuation.state.accepted,
        pendingControls: continuation.state.pendingControls, steeringResult: continuation.state.steeringResult,
        awaitingReplacement: true,
      }
    }
    if (continuation?.state.deadlineEffectId && initial?.deadlineEffectId !== continuation.state.deadlineEffectId)
      clearDeadline({ ...continuation.state }, { ...context,
        activeTaskSessionId: inputs.sessionId ?? continuation.state.observation?.sessionId ?? context.sessionId })
    if (initial?.identificationRequest) initial.identificationRequest = { ...initial.identificationRequest, stepIndex: initial.stepIndex }
    if (context.environmentInterpretation) {
      initial ??= { stepIndex: 0, evidence: [], updateRevision: 0 }
      initial.instructionRevision = continuation?.state.instructionRevision
      initial.interpretationFence = context.environmentInterpretation.body
    }
    // Recall may have received newer input before a program was admitted.
    // Preserve it as a new revision in the existing active-task interpreter.
    if (inputs.userInput) {
      initial = { stepIndex: 0, evidence: [], updateRevision: 0, ...initial,
        instructionRevision: (initial?.instructionRevision ?? 0) + 1, userInput: inputs.userInput }
      delete initial.interpretationError
    }
    if (initial) initial.retrySteering = true
    if (initial) initial.pendingEvents = [...(initial.pendingEvents ?? []),
      ...((context.executionEvents as ActiveTaskState['pendingEvents']) ?? []).filter(event => event.kind !== 'user_steering')]
    const loaded = await loadGraphForMode('robot-active-task', context.username)
    const child = await context.graphExecution!.callGraph(loaded.graph, { ...context, graphExecution: undefined,
      environmentObservation: undefined, activeProgram: inputs.program,
      activeTaskDecision: inputs.taskDecision ?? continuation?.decision, activeTaskSessionId: inputs.sessionId ?? continuation?.state.observation?.sessionId ?? context.sessionId,
      activeTaskInitialState: initial, activeTaskContinuation: undefined, environmentInterpretation: undefined, pendingInstructionTurns: undefined })
    const result = requireGraphNodeOutput(child, 'environment_active_task_wait').state as ActiveTaskState
    const frames = (result.capturedFrameIds ?? []).map(id => context.graphExecution!.frame(id))
      .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame));
    const resultObservation = result.observation && { ...result.observation,
      ...(frames.length ? { visual: frames.at(-1), visuals: frames } : {}) };
    return { finished: result.done === true, completed: result.objectiveComplete === true, result, userInput: result.userInput,
      taskDecision: context.graphExecution!.task()?.decision, observation: result.observation, resultObservation,
      resultContext: resultObservation ? { environmentObservation: resultObservation, environmentObservationCurrent: false } : {} }
  },
})

export const environmentActiveTaskStepNode = defineNode({
  id: 'environment_active_task_step', name: 'Advance Active Task', category: 'environment', version: '2.1.0',
  execution: { activation: 'always' },
  description: 'Advances task phases and updates the admitted gait without waiting for remote inference.',
  inputs: [{ name: 'state', type: 'object', optional: true, description: 'Saved active task state' }],
  outputs: [{ name: 'state', type: 'object', description: 'Current phase, movement and image references' }],
  async execute(inputs, context) {
    const execution = context.graphExecution!
    const program = context.activeProgram as EnvironmentTaskProgram
    const decision = context.activeTaskDecision as EnvironmentTaskDecision
    const sessionId = context.activeTaskSessionId as string
    const state: ActiveTaskState = structuredClone(inputs.state ?? context.activeTaskInitialState ?? { stepIndex: 0, updateRevision: 0, evidence: [] })
    context.abortSignal?.throwIfAborted()
    const observation = getLatestEnvironmentObservation(sessionId)
    state.perception = getEnvironmentPerception(sessionId) ?? undefined
    if (observation) {
      state.observation = observationReference(observation)
      execution.recordFrames([observation.visual, ...(observation.visuals ?? [])].filter((frame): frame is EnvironmentVisualFrame => Boolean(frame)))
    }
    const previous = execution.task()
    const record = (complete = false) => {
      const feedback = (state.feedback?.type === 'outcome_unknown' ? state.feedback : state.failure) ?? (state.completedActionId && state.feedback?.actionId === state.completedActionId
        ? state.feedback : state.steeringResult ?? state.feedback)
      const loss = state.personLoss
      const lossReason = loss && `${state.identificationError}; ${loss.windowExpired ? 'target-lost: observation window expired'
        : loss.candidateFrame ? `candidate person available in frame ${loss.candidateFrame}; identity unverified`
        : `observing candidate persons (${loss.consecutive} distinct successive fresh frames)`}`
      const reason = state.interpretationError ?? lossReason ?? state.failure?.message ?? state.identificationError?.toString()
        ?? (complete ? state.evidence.at(-1) : state.steeringResult?.message ?? state.identification?.evidence)
      const task = { ...previous,
      objectiveId: previous?.objectiveId ?? execution.occurrenceId, executionId: execution.executionId,
      objective: previous?.desireId ? previous.objective : decision.objective!,
      completionCriteria: previous?.desireId ? previous.completionCriteria : decision.completionCriteria!,
      instruction: previous?.instruction ?? context.userMessage ?? decision.objective!, source: previous?.source ?? 'environment',
      decision: { ...decision, outcome: complete ? 'complete' : state.done || state.failure ? 'continue' : decision.outcome, objectiveComplete: complete,
        ...(reason ? { reason } : {}),
        observationSummary: state.perception?.summary ?? state.identification?.description ?? decision.observationSummary,
        completionEvidence: complete ? state.evidence.join('\n') : decision.completionEvidence },
      personResume: loss ? {
        sessionId, candidateFrame: loss.candidateFrame,
        observedAt: state.perception?.observedAt, frameExpiresAt: state.perception?.expiresAt,
        windowExpiresAt: new Date(loss.expiresAt).toISOString(),
        terminationConfirmed: !state.motionId && (!state.completedActionId || state.feedback?.actionId === state.completedActionId
          && terminalTypes.includes(state.feedback.type)),
        rejection: loss.resumeRejection,
      } : undefined,
      selectedAction: state.action ? { type: state.action.type!, command: state.action.command, direction: state.action.direction, target: state.action.target } : null,
      actionId: state.motionId ?? state.completedActionId ?? '', actionStatus: state.feedback?.type === 'outcome_unknown' ? 'outcome_unknown' : state.failure?.type ?? (complete ? 'completed' : 'active'),
      feedback: feedback ? { type: feedback.type, actionId: feedback.actionId ?? '', message: feedback.message, observedAt: feedback.timestamp } : null,
      baselineFrame: previous?.baselineFrame ?? null, updatedAt: new Date().toISOString() }
      execution.recordTask(task)
      // Project changes to the existing action record, including receipts that
      // arrive before the complete program finishes. Gait ticks alone do not
      // create another status effect.
      const facts = (value: typeof task | typeof previous) => value && [value.actionId, value.selectedAction, value.actionStatus, value.feedback]
      if (task.actionId && task.selectedAction && JSON.stringify(facts(task)) !== JSON.stringify(facts(previous))) {
        const terminal = task.feedback?.actionId === task.actionId
          && ['completed', 'failed', 'cancelled', 'rejected'].includes(task.feedback.type) ? task.feedback : null
        projectRobotStatus({ observation: state.observation,
          bridgeRecord: { requestedActions: [task.selectedAction], commands: [{ id: task.actionId }], status: terminal?.type ?? task.actionStatus },
          ...(terminal ? { terminalFeedback: { ...terminal, timestamp: terminal.observedAt } } : {}),
        }, context)
      }
    }
    const send = async (action: Partial<EnvironmentAction>): Promise<string> => {
      const guarded = state.interpretationFence && !['captureImage', 'sendText'].includes(action.type!)
      const output = action.type === 'faceExpression'
        ? await environmentFaceExpressionNode.execute({ expression: action.expression, sessionId }, context, environmentFaceExpressionNode.properties)
        : await environmentSendActionNode.execute({ action: { ...action, id: undefined, sessionId,
        metadata: { ...action.metadata, ...(guarded ? { interpretationBody: JSON.parse(state.interpretationFence!) } : {}) } },
        sessionId, instruction: decision.objective }, context,
        { allowedActions: [action.type!], maxDurationMs: Number.MAX_SAFE_INTEGER, defaultDurationMs: 0 })
      if (!output.count) throw new Error(String(output.message || 'Task action was not admitted'))
      return (output.commands as Array<{ id: string }>)[0].id
    }
    if (state.userInput) {
      const current = state.interpretation
      const body = interpretationBody(observation ?? undefined)
      const ownCancellation = [state.motionId, state.completedActionId].includes(state.feedback?.actionId)
        && JSON.stringify(state.feedback?.data?.cancellationBody) === body
      if (ownCancellation && state.interpretationError === INTERPRETATION_OWNER_CHANGED) delete state.interpretationError
      if (current && (current.revision !== state.instructionRevision || current.motionId !== state.motionId
        || current.stepIndex !== state.stepIndex || current.body !== body)) {
        cancelOwnedWork(context, { interpretationEffectId: current.effectId, reason: 'Instruction interpretation superseded' })
        if (current.body !== body && current.revision === state.instructionRevision && !ownCancellation)
          state.interpretationError = INTERPRETATION_OWNER_CHANGED
        delete state.interpretation; delete state.interpretationResult
      }
      if (state.userInput.sessionId && state.userInput.sessionId !== sessionId) state.interpretationError = INTERPRETATION_OWNER_CHANGED
      if (!state.interpretation && !state.interpretationError) {
        const identity = { executionId: execution.executionId, sessionId, revision: state.instructionRevision!,
          motionId: state.motionId, stepIndex: state.stepIndex, body }
        const turns = ((state.userInput.executionEvents as Array<{ kind: string; payload: Record<string, unknown> }>) ?? [])
          .filter(event => event.kind === 'user_steering').map(event => event.payload)
        const effect = execution.dispatch({ kind: 'coordinator_work', payload: {
          type: 'generic', handler: 'environment.interpret', resource: 'local-llm', source: 'environment',
          username: context.username, maxAttempts: 1,
          input: { identity, turns, context: graphContextSnapshot({ ...context, ...state.userInput,
            graphExecution: undefined, environmentObservation: observation, environmentObservationCurrent: false,
            activeTaskContinuation: { program, decision: execution.task()?.decision ?? decision, state: { ...state, userInput: undefined } } }) },
        } })
        state.interpretation = { ...identity, effectId: effect.effectId }
      }
    }
    if (state.done) { record(state.objectiveComplete === true); return { state } }
    const scheduleDeadline = (at: number) => {
      // Keep an earlier wake when fresh frames extend validity; do not create
      // timer/cancellation work for every perception frame.
      if (state.deadlineEffectId && state.deadlineAt !== undefined && state.deadlineAt <= at) return
      clearDeadline(state, context)
      state.deadlineAt = at
      state.deadlineEffectId = execution.dispatch({ kind: 'coordinator_work', payload: {
        type: 'generic', handler: 'environment.active-task-deadline', resource: `environment-feedback:${sessionId}`,
        source: 'environment', username: context.username, maxAttempts: 1, notBefore: new Date(at).toISOString(),
        input: { sessionId, actionId: state.motionId },
      } }).effectId
    }
    let feedbackExpires: number | undefined
    const phase = program.steps[state.stepIndex]
    // The model already selects the steering target. Person steering uses the
    // approved single-candidate policy through this same execution owner.
    const personSteering = phase?.kind === 'behavior' && phase.steering?.label.toLowerCase() === 'person'
    if (personSteering) {
      state.interpretationFence ??= interpretationBody(observation ?? undefined)
      observeSinglePerson(state, Date.now())
    }
    if (phase?.kind === 'behavior' && !state.finishRequestedAt && !state.failure && !state.identificationError) {
      state.feedbackRequiredSince ??= Date.now()
      const expires = state.perception ? Date.parse(state.perception.expiresAt) : state.feedbackRequiredSince + FEEDBACK_START_GRACE_MS
      if (expires <= Date.now()) state.identificationError = 'Required live feedback expired or is unavailable'
      else feedbackExpires = expires
    }
    if (state.finishRequestedAt && Date.now() >= state.finishRequestedAt + FINISH_TIMEOUT_MS)
      state.identificationError ??= 'Finish did not receive the original motion terminal receipt within 5 seconds'
    if (state.failure || state.identificationError) {
      state.objectiveComplete = false
      const confirmed = state.feedback && state.feedback.actionId === state.motionId && terminalTypes.includes(state.feedback.type)
      if (!state.motionId || !state.action?.continuous || confirmed) {
        if (confirmed) settleAction(state, context)
        else if (!state.personLoss || state.personLoss.windowExpired) clearDeadline(state, context)
        if (!state.personLoss) state.done = true
      } else {
        if (!state.cancellationRequestedAt) {
          cancelOwnedWork(context, { actionId: state.motionId,
            reason: String(state.identificationError ?? state.failure?.message ?? 'Required feedback failed') })
          state.cancellationRequestedAt = Date.now()
        }
        const expires = state.cancellationRequestedAt + CANCELLATION_CONFIRMATION_MS
        if (Date.now() < expires) scheduleDeadline(expires)
        else {
          clearDeadline(state, context)
          state.feedback = { id: `termination-unknown:${state.motionId}`, actionId: state.motionId, type: 'outcome_unknown',
            timestamp: new Date().toISOString(), message: 'Cancellation requested; original command termination is unconfirmed' }
        }
      }
      // The observation window does not own movement settlement. Expiring it
      // leaves an unknown command and its original receipt path intact.
      if (state.personLoss && !state.personLoss.windowExpired) scheduleDeadline(state.personLoss.expiresAt)
      record(); return { state }
    }
    if (state.userInput && !state.motionId) { record(); return { state } }
    if (state.awaitingReplacement) {
      if (state.pendingControls) { record(); return { state } }
      delete state.awaitingReplacement; delete state.motionId; delete state.accepted
    }
    const identify = (target: string, completionCriteria: string) => {
      if (!state.image || state.identificationEffectId) return
      execution.recordFrames([state.image])
      const effect = execution.dispatch({ kind: 'coordinator_work', payload: {
        type: 'generic', handler: 'environment.identify', resource: 'remote-llm', source: 'environment',
        username: context.username, maxAttempts: 1,
        input: { target, objective: decision.objective, completionCriteria, image: state.image, perception: state.perception },
        metadata: { producer: 'environment-active-task', sessionId },
      } })
      const owner = observation?.state?.activeMovementUpdates as Record<string, unknown> | undefined
      state.identificationEffectId = effect.effectId
      state.identificationRequest = { effectId: effect.effectId, frameId: state.image.id, stepIndex: state.stepIndex,
        gatewayInstance: owner?.gatewayInstance, epoch: owner?.epoch, expiresAt: state.perception?.expiresAt }
      delete state.image
    }
    const updateMovement = (motion: Partial<EnvironmentAction>, steering: { label: string; gain: number } | null = null) => {
      const controls: Record<string, number> = motion.stride !== undefined && motion.rate !== undefined
        ? { stride: motion.stride, rate: motion.rate }
        : motion.type === 'move' || motion.speed !== undefined ? { speed: motion.speed ?? 100 } : {}
      if (motion.type === 'move') {
        controls.forward = motion.forward ?? (motion.direction === 'back' ? -100 : motion.direction === 'forward' ? 100 : 0)
        controls.turn = motion.turn ?? (motion.direction === 'left' ? 100 : motion.direction === 'right' ? -100 : 0)
      } else if (motion.forward !== undefined && motion.turn !== undefined) {
        controls.forward = motion.forward; controls.turn = motion.turn
      }
      if (!Object.keys(controls).length) return
      const object = steering && state.perception?.objects.find(object => object.label.toLowerCase() === steering!.label.toLowerCase() && object.box)
      if (object?.box && steering) controls.turn = Math.max(-100, Math.min(100,
        controls.turn + (0.5 - object.box.x - object.box.width / 2) * steering.gain))
      const encoded = JSON.stringify(controls)
      const changed = state.desiredControls !== encoded
      state.desiredControls = encoded
      if (!state.accepted || state.pendingControls || state.acknowledgedControls === encoded) return
      const support = observation?.state?.activeMovementUpdates as Record<string, unknown> | undefined
      if (support?.version !== 1 || support.available !== true) {
        state.steeringResult = { id: `unsupported:${state.motionId}`, actionId: state.motionId, type: 'rejected',
          timestamp: new Date().toISOString(), message: 'Active steering v1 is unsupported or unavailable on this body session' }
        return
      }
      if (state.steeringResult && state.steeringResult.type !== 'completed' && !changed && !state.retrySteering) return
      state.retrySteering = false
      const commandId = randomUUID(); state.updateRevision += 1
      state.pendingControls = { commandId, motionId: state.motionId!, revision: state.updateRevision, controls: encoded }
      execution.dispatch({ kind: 'coordinator_work', actionId: commandId, payload: {
          type: 'environment_command', handler: 'environment.command', resource: `environment-update:${sessionId}`,
          source: 'environment', username: context.username, maxAttempts: 1,
          input: { id: commandId, type: 'move', sessionId,
            movementUpdate: { actionId: state.motionId, revision: state.updateRevision, controls } },
      } })
    }
    const step = program.steps[state.stepIndex]
    if (!step) {
      state.done = true
      // Program receipts describe executed steps. The existing objective review
      // evaluates whether those results fulfil the person's overall request.
      state.objectiveComplete = false
      record(state.objectiveComplete); return { state }
    }
    if (step.kind !== 'behavior') {
      if (!state.motionId) {
        if (step.kind === 'generatedMotion' && !state.action) {
          if (!state.generationEffectId) state.generationEffectId = execution.dispatch({ kind: 'coordinator_work', payload: {
            type: 'generic', handler: 'environment.generate-motion', resource: 'remote-llm', source: 'environment',
            username: context.username, maxAttempts: 1, input: {
              movementRequest: { description: step.description, motionClass: 'body_local', sessionId },
              observation: observation ? observationReference(observation) : undefined, sessionId, instruction: decision.objective,
            },
          } }).effectId
          record(); return { state }
        }
        delete state.feedback
        if (step.kind === 'action') state.action = step.action
        state.motionId = await send(state.action!)
        if (state.action?.type === 'captureImage') {
          state.snapshotId = state.motionId; state.captureRequestedAt = new Date().toISOString()
        }
      }
      if (step.kind === 'action' && step.action.continuous) updateMovement(step.action)
      record(); return { state }
    }
    if (state.identification?.matchesTarget && state.identification.completionSatisfied) {
      state.finishRequestedAt ??= Date.now()
      scheduleDeadline(state.finishRequestedAt + FINISH_TIMEOUT_MS)
      // Finish is a speed-zero update of the original gait. Its ACK is not
      // completion; the wait node requires that gait's own terminal receipt.
      updateMovement({ ...step.motion, stride: undefined, rate: undefined, speed: 0 }, null)
      record(); return { state }
    }
    if (feedbackExpires !== undefined) scheduleDeadline(feedbackExpires)
    if (personSteering && !state.perception) { record(); return { state } }
    identify(step.target, step.completionCriteria)
    if (!state.motionId) { delete state.feedback; state.action = step.motion; state.motionId = await send(step.motion); state.accepted = false }
    updateMovement(step.motion, step.steering)
    const frame = state.perception?.frameCounter
    const periodic = state.lastIdentifiedFrame === undefined || (frame !== undefined && ((frame - state.lastIdentifiedFrame) >>> 0) >= step.identifyEveryFrames)
    const candidate = state.perception?.objects.some(object => step.candidateLabels.some(label => label.toLowerCase() === object.label.toLowerCase()))
    if (!state.snapshotId && !state.identificationEffectId && !state.image && (periodic || (candidate && frame !== state.lastIdentifiedFrame))) {
      const capture = prepareEnvironmentCommand({ type: 'captureImage', sessionId }, { username: context.username, originatingInstruction: decision.objective })
      execution.dispatch({ kind: 'coordinator_work', actionId: capture.input.id as string, payload: capture })
      state.snapshotId = capture.input.id as string; state.lastIdentifiedFrame = frame
      state.captureRequestedAt = new Date().toISOString()
    }
    record(); return { state }
  },
})

export const environmentActiveTaskWaitNode = defineNode({
  id: 'environment_active_task_wait', name: 'Receive Active Task Event', category: 'environment', version: '2.1.0',
  description: 'Consumes observations and physical results within the current task phase.',
  inputs: [{ name: 'state', type: 'object', description: 'Current task phase and requests' }],
  outputs: [{ name: 'state', type: 'object', description: 'Updated task progress' },
    { name: 'continue', type: 'boolean', description: 'Advance the same execution' }],
  async execute(inputs, context) {
    const state = structuredClone(inputs.state) as ActiveTaskState
    context.abortSignal?.throwIfAborted()
    const execution = context.graphExecution!
    const program = context.activeProgram as EnvironmentTaskProgram
    const bufferInput = (event: NonNullable<ActiveTaskState['pendingEvents']>[number]) => {
      state.instructionRevision = (state.instructionRevision ?? 0) + 1
      delete state.interpretationError
      const turn = event.payload as Record<string, any>
      const payload = { ...turn, userMessageEntry: turn.userMessageEntry ?? {
        role: 'user', content: turn.userMessage, timestamp: turn.memoryTimestamp ?? Date.now(),
        meta: { idempotencyKey: `${execution.executionId}:instruction:${(event as { eventId?: string }).eventId ?? `${execution.occurrenceId}:${state.instructionRevision}`}`,
          sessionId: turn.sessionId, replyToQuestionId: turn.replyToQuestionId, replyToContent: turn.replyToContent },
      } }
      state.userInput = { ...payload, executionEvents: [
        ...((state.userInput?.executionEvents as unknown[]) ?? []), { ...event, payload },
      ] }
    }
    const routeInput = () => {
      // Input may be queued immediately after the terminal receipt. Receive it
      // before another phase can dispatch, retaining other events for that phase.
      const pending = state.pendingEvents ?? []
      if (execution.pendingEvents().some((event: { kind: string }) => event.kind === 'user_steering')) {
        while (execution.pendingEvents().length) pending.push(execution.waitForEvent('pending_input'))
      }
      state.pendingEvents = pending.filter(event => {
        if (event.kind !== 'user_steering') return true
        bufferInput(event); return false
      })
      if (state.personLoss || !state.userInput || !state.interpretationResult) return false
      if (state.pendingEvents?.length || execution.pendingEvents().length) return false
      const result = state.interpretationResult
      if (result.revision !== state.instructionRevision || result.executionId !== execution.executionId
        || result.sessionId !== context.activeTaskSessionId || result.motionId !== state.motionId
        || result.stepIndex !== state.stepIndex || result.body !== interpretationBody(getLatestEnvironmentObservation(result.sessionId) ?? undefined)
        || state.finishRequestedAt || state.cancellationRequestedAt || state.feedback?.type === 'outcome_unknown') return false
      state.userInput.environmentInterpretation = result
      state.userInput.pendingInstructionTurns = ((state.userInput.executionEvents as Array<{ kind: string; payload: unknown }>) ?? [])
        .filter(event => event.kind === 'user_steering').map(event => event.payload)
      // Build this only at the handoff, after phase advancement or termination
      // reconciliation. An arrival-time snapshot could resurrect the old gait.
      state.userInput.activeTaskContinuation = { program, decision: execution.task()?.decision ?? context.activeTaskDecision,
        state: { ...state, userInput: undefined, interpretation: undefined, interpretationResult: undefined, interpretationError: undefined } }
      return true
    }
    const enteringRevision = state.instructionRevision
    if (routeInput()) return { state, continue: false }
    if (state.instructionRevision !== enteringRevision) return { state, continue: true }
    if (state.userInput && state.interpretation && (state.interpretation.motionId !== state.motionId
      || state.interpretation.stepIndex !== state.stepIndex)) return { state, continue: true }
    if (state.done && !state.userInput) return { state, continue: false }
    const advance = (evidence: string) => {
      settleAction(state, context)
      state.evidence = [...state.evidence, evidence]; state.stepIndex += 1
      return { state, continue: !routeInput() }
    }
    const captureResult = () => {
      if (!state.captureCompleted || !state.image) return { state, continue: true }
      execution.recordFrames([state.image])
      state.capturedFrameIds = [...(state.capturedFrameIds ?? []), state.image.id]
      return advance(JSON.stringify({ actionId: state.motionId, type: 'captureImage', status: 'completed',
        frameId: state.image.id, observedAt: state.image.timestamp }))
    }
    while (true) {
      const revision = state.instructionRevision
      if (routeInput()) return { state, continue: false }
      if (state.instructionRevision !== revision) return { state, continue: true }
      const step = program.steps[state.stepIndex]
      const usesPerception = step?.kind === 'behavior' || step?.kind === 'action' && step.action.continuous
      const event = state.pendingEvents?.shift() ?? execution.waitForEvent(
        `active_task:${context.activeTaskSessionId}${usesPerception ? ':perception' : ''}`)
      const payload = event.payload as Record<string, any>
      if (event.kind === 'single_person_resume' && state.personLoss) {
        // This is an explicit operator event, not model text or a selector
        // output. Resolve the candidate again at consumption, never at enqueue.
        state.perception = getEnvironmentPerception(context.activeTaskSessionId as string) ?? undefined
        observeSinglePerson(state, Date.now())
        const loss = state.personLoss
        const body = interpretationBody(getLatestEnvironmentObservation(context.activeTaskSessionId as string) ?? undefined)
        const terminal = !state.motionId && (!state.completedActionId || state.feedback?.actionId === state.completedActionId
          && terminalTypes.includes(state.feedback.type))
        if (payload.executionId !== execution.executionId || payload.sessionId !== context.activeTaskSessionId
          || payload.confirmCandidate !== true || payload.resume !== true || !loss.candidateFrame
          || payload.candidateFrame !== loss.candidateFrame || !state.perception
          || personFrameKey(state.perception) !== loss.candidateFrame || !terminal
          || body !== state.interpretationFence) {
          loss.resumeRejection = 'Resume requires explicit selection of the current fresh candidate, confirmed prior termination and unchanged ownership'
          return { state, continue: true }
        }
        state.evidence.push(`Operator selected candidate person in ${loss.candidateFrame}; identity continuity is unverified`)
        // Invalidate pre-loss image/completion evidence. The next step admits a
        // new action identity; it never adopts or replays the cancelled gait.
        if (state.interpretation) cancelOwnedWork(context, { interpretationEffectId: state.interpretation.effectId, reason: 'Operator selected a new candidate' })
        settleAction(state, context)
        for (const field of ['personLoss', 'identificationError', 'failure', 'done', 'interpretation', 'interpretationResult', 'interpretationError', 'visualCompletionSatisfied'] as const) delete state[field]
        state.objectiveComplete = false
        return { state, continue: true }
      }
      if (event.kind === 'work_result' && payload.effectId === state.deadlineEffectId) {
        delete state.deadlineEffectId; delete state.deadlineAt
        return { state, continue: true }
      }
      if (event.kind === 'user_steering') {
        bufferInput(event)
        routeInput() // Drain the currently queued turns into one ordered request.
        return { state, continue: true }
      }
      if (event.kind === 'work_result' && payload.effectId === state.interpretation?.effectId) {
        const result = payload.result
        if (result.state === 'completed') {
          const identity = state.interpretation!
          const fields = ['executionId', 'sessionId', 'revision', 'motionId', 'stepIndex', 'body'] as const
          if (fields.every(field => result.result?.[field] === identity[field])) state.interpretationResult = result.result
          else state.interpretationError = 'Instruction interpretation returned a mismatched execution, session or revision'
        } else state.interpretationError = result.error?.message ?? 'Instruction interpretation failed; pending instructions were not applied'
        return { state, continue: !routeInput() }
      }
      if (event.kind === 'perception_received') { state.retrySteering = true; return { state, continue: true } }
      if (event.kind === 'action_accepted' && event.actionId === state.motionId) {
        state.accepted = true; return { state, continue: true }
      }
      if (event.kind === 'work_result' && payload.effectId === state.identificationEffectId) {
        delete state.identificationEffectId
        const request = state.identificationRequest
        const current = getLatestEnvironmentObservation(context.activeTaskSessionId as string)?.state?.activeMovementUpdates as Record<string, unknown> | undefined
        delete state.identificationRequest
        if (!request || request.stepIndex !== state.stepIndex || request.gatewayInstance !== current?.gatewayInstance
          || request.epoch !== current?.epoch || request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) {
          state.perceptionOutcome = 'stale'
          const live = getEnvironmentPerception(context.activeTaskSessionId as string)
          // Slow inference is not feedback loss. Discard expired image evidence
          // and recapture while current local feedback remains usable.
          if (program.steps[state.stepIndex].kind !== 'behavior' || !live
            || request?.gatewayInstance !== current?.gatewayInstance || request?.epoch !== current?.epoch)
            state.identificationError = 'Image evidence belongs to an expired frame or ended body session'
          else delete state.lastIdentifiedFrame
          delete state.identification
        } else if (payload.result.state === 'completed') {
          state.identification = payload.result.result; state.perceptionOutcome = state.identification?.outcome
        } else {
          state.perceptionOutcome = 'failed'; state.identificationError = payload.result.error?.message ?? 'Remote perception failed'
          delete state.identification
        }
        return { state, continue: true }
      }
      if (event.kind === 'work_result' && payload.effectId === state.generationEffectId) {
        delete state.generationEffectId
        const result = payload.result
        if (result.state === 'completed' && result.result.valid) state.action = result.result.action
        else state.identificationError = result.error?.message ?? result.result?.error ?? 'Remote motion generation failed'
        return { state, continue: true }
      }
      if (event.kind === 'observation_received' && event.actionId === state.snapshotId) {
        const observation = payload.environmentObservation as EnvironmentObservation
        const image = [observation.visual, ...(observation.visuals ?? [])].find(frame => frame
          && (!frame.metadata?.actionId || frame.metadata.actionId === event.actionId))
        if (observation.sessionId !== context.activeTaskSessionId || !image?.dataUrl
          || !Number.isFinite(Date.parse(image.timestamp)) || state.captureRequestedAt && Date.parse(image.timestamp) < Date.parse(state.captureRequestedAt)) {
          state.perceptionOutcome = 'stale'; state.identificationError = 'Capture returned missing, stale or uncorrelated image evidence'
        } else state.image = image
        state.observation = observationReference(observation)
        delete state.snapshotId
        return state.action?.type === 'captureImage' && state.image ? captureResult() : { state, continue: true }
      }
      if (event.kind !== 'physical_result') continue
      const feedback = payload.feedback as import('../../environment-interface/types.js').EnvironmentFeedback
      if (feedback.actionId !== event.actionId) continue
      if ([state.motionId, state.snapshotId].includes(event.actionId)) {
        const action = event.actionId === state.snapshotId ? { type: 'captureImage' }
          : state.action
        if (action) projectRobotStatus({ observation: state.observation,
          bridgeRecord: { requestedActions: [action], commands: [{ id: event.actionId }], status: feedback.type },
          ...(['completed', 'failed', 'rejected', 'expired', 'cancelled'].includes(feedback.type) ? { terminalFeedback: feedback } : {}),
        }, context)
      }
      if (state.pendingControls && event.actionId === state.pendingControls.commandId) {
        const pending = state.pendingControls
        const reply = feedback.data?.movementUpdate as Record<string, unknown> | undefined
        if (pending.motionId !== state.motionId || reply && (reply.actionId !== pending.motionId
          || reply.revision !== pending.revision || reply.sessionId !== context.activeTaskSessionId || reply.version !== 1)) continue
        if (!['completed', 'failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) continue
        advanceInterpretationFence(state, feedback)
        state.steeringResult = feedback
        state.retrySteering = false
        if (feedback.type === 'completed') state.acknowledgedControls = pending.controls
        if (feedback.type !== 'outcome_unknown') delete state.pendingControls
        return { state, continue: true }
      }
      if (event.actionId === state.motionId) {
        advanceInterpretationFence(state, feedback)
        state.feedback = feedback
        if (feedback.type === 'accepted' || feedback.type === 'status') { state.accepted = true; return { state, continue: true } }
        if (program.steps[state.stepIndex].kind === 'behavior' && state.finishRequestedAt
          && !state.identificationError && !state.failure && feedback.type === 'completed') {
          state.visualCompletionSatisfied = state.identification?.completionSatisfied === true
          return advance(state.identification!.evidence)
        }
        if (program.steps[state.stepIndex].kind === 'behavior'
          && ['completed', 'failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
          state.failure = feedback; return { state, continue: true }
        }
        if (program.steps[state.stepIndex].kind !== 'behavior') {
          if (feedback.type === 'completed') {
            if (state.action?.type === 'captureImage') { state.captureCompleted = true; return captureResult() }
            return advance(feedback.message || `Action ${event.actionId} completed`)
          }
          if (['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
            state.failure = feedback; return { state, continue: true }
          }
        }
      }
      if (event.actionId === state.snapshotId
        && ['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
        state.feedback = feedback; state.failure = feedback; return { state, continue: true }
      }
    }
  },
})
