import { randomUUID } from 'node:crypto'
import { defineNode } from '../types.js'
import { getLatestEnvironmentObservation, getEnvironmentPerception, prepareEnvironmentCommand } from '../../environment-interface/store.js'
import type { EnvironmentTaskProgram, ActiveTaskState, ActiveTaskContinuation } from '../../environment-interface/active-task.js'
import type { EnvironmentAction, EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/types.js'
import type { EnvironmentTaskDecision } from './helpers.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { requireGraphNodeOutput } from '../../graph-runtime.js'
import { environmentSendActionNode } from './send-action.node.js'

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
      const feedback = state.failure ?? (state.completedActionId && state.feedback?.actionId === state.completedActionId
        ? state.feedback : state.steeringResult ?? state.feedback)
      const reason = state.failure?.message ?? state.identificationError?.toString()
        ?? (complete ? state.evidence.at(-1) : state.steeringResult?.message ?? state.identification?.evidence)
      return execution.recordTask({ ...previous,
      objectiveId: previous?.objectiveId ?? execution.occurrenceId, executionId: execution.executionId,
      objective: previous?.desireId ? previous.objective : decision.objective!,
      completionCriteria: previous?.desireId ? previous.completionCriteria : decision.completionCriteria!,
      instruction: previous?.instruction ?? context.userMessage ?? decision.objective!, source: previous?.source ?? 'environment',
      decision: { ...decision, outcome: complete ? 'complete' : state.done || state.failure ? 'continue' : decision.outcome, objectiveComplete: complete,
        ...(reason ? { reason } : {}),
        observationSummary: state.perception?.summary ?? state.identification?.description ?? decision.observationSummary,
        completionEvidence: complete ? state.evidence.join('\n') : decision.completionEvidence },
      selectedAction: state.action ? { type: state.action.type!, command: state.action.command, direction: state.action.direction, target: state.action.target } : null,
      actionId: state.stopId ?? state.motionId ?? state.completedActionId ?? '', actionStatus: state.failure?.type ?? (complete ? 'completed' : 'active'),
      feedback: feedback ? { type: feedback.type, actionId: feedback.actionId ?? '', message: feedback.message, observedAt: feedback.timestamp } : null,
      baselineFrame: previous?.baselineFrame ?? null, updatedAt: new Date().toISOString() })
    }
    const send = async (action: Partial<EnvironmentAction>): Promise<string> => {
      const output = await environmentSendActionNode.execute({ action: { ...action, id: undefined, sessionId },
        sessionId, instruction: decision.objective }, context,
        { allowedActions: [action.type!], maxDurationMs: Number.MAX_SAFE_INTEGER, defaultDurationMs: 0 })
      if (!output.count) throw new Error(String(output.message || 'Task action was not admitted'))
      return (output.commands as Array<{ id: string }>)[0].id
    }
    if (state.done) { record(state.objectiveComplete === true); return { state } }
    if (state.failure || state.identificationError) { state.done = true; state.objectiveComplete = false; record(); return { state } }
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
      if (!state.stopId) { state.action = { type: 'stop' }; state.stopId = await send(state.action) }
      record(); return { state }
    }
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
    if (state.done) return { state, continue: false }
    context.abortSignal?.throwIfAborted()
    const execution = context.graphExecution!
    const program = context.activeProgram as EnvironmentTaskProgram
    const advance = (evidence: string) => {
      state.completedActionId = state.stopId ?? state.motionId
      state.evidence = [...state.evidence, evidence]; state.stepIndex += 1
      for (const field of ['motionId', 'action', 'accepted', 'snapshotId', 'identificationEffectId', 'identificationRequest', 'generationEffectId', 'image', 'identification', 'lastIdentifiedFrame', 'stopId', 'pendingControls', 'desiredControls', 'acknowledgedControls', 'retrySteering', 'captureRequestedAt', 'captureCompleted'] as const) delete state[field]
      state.updateRevision = 0
      return { state, continue: true }
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
      if (event.kind === 'user_steering') {
        state.userInput = { ...payload, activeTaskContinuation: { program, decision: context.activeTaskDecision,
          state: { ...state, userInput: undefined } } }
        if (program.steps[state.stepIndex].kind === 'behavior' || state.action?.continuous || !state.motionId) return { state, continue: false }
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
          state.perceptionOutcome = 'stale'; state.identificationError = 'Image evidence belongs to an expired frame or ended body session'
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
        if (program.steps[state.stepIndex].kind === 'behavior' && !state.stopId
          && ['completed', 'failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
          state.failure = feedback; return { state, continue: true }
        }
        if (program.steps[state.stepIndex].kind !== 'behavior') {
          if (feedback.type === 'completed') {
            if (state.action?.type === 'captureImage') { state.captureCompleted = true; return captureResult() }
            const result = advance(feedback.message || `Action ${event.actionId} completed`)
            if (state.userInput) {
              state.userInput.activeTaskContinuation = { program, decision: context.activeTaskDecision, state: { ...state, userInput: undefined } }
              return { state, continue: false }
            }
            return result
          }
          if (['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
            state.failure = feedback; return { state, continue: true }
          }
        }
      }
      if (event.actionId === state.stopId && feedback.type === 'completed') {
        state.visualCompletionSatisfied = state.identification?.completionSatisfied === true
        state.feedback = feedback; return advance(state.identification!.evidence)
      }
      if ((event.actionId === state.snapshotId || event.actionId === state.stopId)
        && ['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
        state.feedback = feedback; state.failure = feedback; return { state, continue: true }
      }
    }
  },
})
