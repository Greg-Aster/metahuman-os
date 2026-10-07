import { randomUUID } from 'node:crypto'
import { defineNode, type NodeExecutionContext } from '../types.js'
import { getLatestEnvironmentObservation, getEnvironmentPerception, prepareEnvironmentCommand } from '../../environment-interface/store.js'
import type { EnvironmentTaskProgram, ActiveTaskState, ActiveTaskContinuation } from '../../environment-interface/active-task.js'
import type { EnvironmentAction, EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/types.js'
import type { EnvironmentTaskDecision } from './helpers.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { requireGraphNodeOutput } from '../../graph-runtime.js'
import { environmentSendActionNode } from './send-action.node.js'
import { projectRobotStatus } from '../robot-status/out.node.js'

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
  state.completedActionId = state.motionId
  for (const field of ['motionId', 'action', 'accepted', 'snapshotId', 'identificationEffectId', 'identificationRequest', 'generationEffectId', 'image', 'identification', 'lastIdentifiedFrame', 'finishRequestedAt', 'cancellationRequestedAt', 'feedbackRequiredSince', 'pendingControls', 'desiredControls', 'acknowledgedControls', 'retrySteering', 'captureRequestedAt', 'captureCompleted'] as const) delete state[field]
  state.updateRevision = 0
}

function observationReference(observation: EnvironmentObservation): EnvironmentObservation {
  const reference = ({ dataUrl: _pixels, ...frame }: EnvironmentVisualFrame) => frame
  return { ...observation, visual: observation.visual ? reference(observation.visual) : undefined,
    visuals: observation.visuals?.map(reference) }
}

export const environmentActiveTaskNode = defineNode({
  id: 'environment_active_task', name: 'Execute Robot Task', category: 'environment', version: '2.0.0',
  execution: { timeoutOwner: 'children' },
  description: 'Owns the complete task program within the existing durable execution.',
  inputs: [{ name: 'program', type: 'object', description: 'MetaHuman-selected ordered actions and ongoing behaviors' },
    { name: 'taskDecision', type: 'object', description: 'Whole objective and completion criteria' },
    { name: 'sessionId', type: 'string', description: 'Current body session' }],
  outputs: [{ name: 'finished', type: 'boolean', description: 'Program reached completion or a reported physical failure' },
    { name: 'completed', type: 'boolean', description: 'All task phases completed' },
    { name: 'result', type: 'object', description: 'Execution progress and phase evidence' },
    { name: 'userInput', type: 'object', description: 'New instruction returned to existing intent routing' },
    { name: 'taskDecision', type: 'object', description: 'Decision from this execution' },
    { name: 'observation', type: 'object', description: 'Latest observation references' }],
  async execute(inputs, context) {
    const continuation = context.activeTaskContinuation as ActiveTaskContinuation | undefined
    const selected = inputs.program as EnvironmentTaskProgram
    let initial: ActiveTaskState | undefined
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
    if (initial) initial.retrySteering = true
    if (initial) initial.pendingEvents = [...(initial.pendingEvents ?? []),
      ...((context.executionEvents as ActiveTaskState['pendingEvents']) ?? []).filter(event => event.kind !== 'user_steering')]
    const loaded = await loadGraphForMode('robot-active-task', context.username)
    const child = await context.graphExecution!.callGraph(loaded.graph, { ...context, graphExecution: undefined,
      environmentObservation: undefined, activeProgram: inputs.program,
      activeTaskDecision: inputs.taskDecision ?? continuation?.decision, activeTaskSessionId: inputs.sessionId ?? continuation?.state.observation?.sessionId ?? context.sessionId,
      activeTaskInitialState: initial, activeTaskContinuation: undefined })
    const result = requireGraphNodeOutput(child, 'environment_active_task_wait').state as ActiveTaskState
    return { finished: result.done === true, completed: result.objectiveComplete === true, result, userInput: result.userInput,
      taskDecision: context.graphExecution!.task()?.decision, observation: result.observation }
  },
})

export const environmentActiveTaskStepNode = defineNode({
  id: 'environment_active_task_step', name: 'Advance Active Task', category: 'environment', version: '2.0.0',
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
      const reason = state.failure?.message ?? state.identificationError?.toString()
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
      const output = await environmentSendActionNode.execute({ action: { ...action, id: undefined, sessionId },
        sessionId, instruction: decision.objective }, context,
        { allowedActions: [action.type!], maxDurationMs: Number.MAX_SAFE_INTEGER, defaultDurationMs: 0 })
      if (!output.count) throw new Error(String(output.message || 'Task action was not admitted'))
      return (output.commands as Array<{ id: string }>)[0].id
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
        input: { actionId: state.motionId },
      } }).effectId
    }
    let feedbackExpires: number | undefined
    const phase = program.steps[state.stepIndex]
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
        else clearDeadline(state, context)
        state.done = true
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
      record(); return { state }
    }
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
      state.objectiveComplete = decision.requiredCompletionBasis === 'action_result'
        || decision.requiredCompletionBasis === 'visual_observation' && state.visualCompletionSatisfied === true
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
      if (state.action?.type === 'captureImage') {
        identify(decision.objective!, decision.completionCriteria!)
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
  id: 'environment_active_task_wait', name: 'Receive Active Task Event', category: 'environment', version: '2.0.0',
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
      state.userInput = { ...(event.payload as Record<string, unknown>), executionEvents: [
        ...((state.userInput?.executionEvents as unknown[]) ?? []), event,
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
      if (!state.userInput) return false
      // Build this only at the handoff, after phase advancement or termination
      // reconciliation. An arrival-time snapshot could resurrect the old gait.
      state.userInput.activeTaskContinuation = { program, decision: execution.task()?.decision ?? context.activeTaskDecision,
        state: { ...state, userInput: undefined } }
      return true
    }
    if (state.done) { routeInput(); return { state, continue: false } }
    const advance = (evidence: string) => {
      settleAction(state, context)
      state.evidence = [...state.evidence, evidence]; state.stepIndex += 1
      return { state, continue: !routeInput() }
    }
    const captureResult = () => {
      if (!state.captureCompleted || !state.identification) return { state, continue: true }
      state.visualCompletionSatisfied = state.identification.completionSatisfied
      if (state.identification.completionSatisfied) return advance(state.identification.evidence)
      state.evidence = [...state.evidence, state.identification.evidence]
      state.done = true; state.objectiveComplete = false
      return { state, continue: true }
    }
    while (true) {
      const event = state.pendingEvents?.shift() ?? execution.waitForEvent(`active_task:${context.activeTaskSessionId}`)
      const payload = event.payload as Record<string, any>
      if (event.kind === 'work_result' && payload.effectId === state.deadlineEffectId) {
        delete state.deadlineEffectId; delete state.deadlineAt
        return { state, continue: true }
      }
      if (event.kind === 'user_steering') {
        bufferInput(event)
        if (state.finishRequestedAt || state.cancellationRequestedAt) continue
        if (program.steps[state.stepIndex].kind === 'behavior' || state.action?.continuous || !state.motionId) {
          routeInput(); return { state, continue: false }
        }
        continue
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
        if (state.action?.type === 'captureImage') return captureResult()
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
        delete state.snapshotId; return { state, continue: true }
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
        state.steeringResult = feedback
        state.retrySteering = false
        if (feedback.type === 'completed') state.acknowledgedControls = pending.controls
        if (feedback.type !== 'outcome_unknown') delete state.pendingControls
        return { state, continue: true }
      }
      if (event.actionId === state.motionId) {
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
