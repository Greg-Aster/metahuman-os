import { randomUUID } from 'node:crypto'
import { defineNode } from '../types.js'
import { getLatestEnvironmentObservation, getEnvironmentPerception, prepareEnvironmentCommand } from '../../environment-interface/store.js'
import type { EnvironmentTaskProgram, ActiveTaskState, ActiveTaskContinuation } from '../../environment-interface/active-task.js'
import type { EnvironmentAction, EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/types.js'
import type { EnvironmentTaskDecision } from './helpers.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { requireGraphNodeOutput } from '../../graph-runtime.js'
import { environmentSendActionNode } from './send-action.node.js'
import { movementGeneratorNode } from './movement-generator.node.js'

function observationReference(observation: EnvironmentObservation): EnvironmentObservation {
  const reference = ({ dataUrl: _pixels, ...frame }: EnvironmentVisualFrame) => frame
  return { ...observation, visual: observation.visual ? reference(observation.visual) : undefined,
    visuals: observation.visuals?.map(reference) }
}

export const environmentActiveTaskNode = defineNode({
  id: 'environment_active_task', name: 'Execute Robot Task', category: 'environment',
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
          updateRevision: continuation.state.updateRevision, lastControls: continuation.state.lastControls,
          updateId: continuation.state.updateId }
      }
    }
    if (initial) initial.pendingEvents = [...(initial.pendingEvents ?? []),
      ...((context.executionEvents as ActiveTaskState['pendingEvents']) ?? []).filter(event => event.kind !== 'user_steering')]
    const loaded = await loadGraphForMode('robot-active-task', context.username)
    const child = await context.graphExecution!.callGraph(loaded.graph, { ...context, graphExecution: undefined,
      environmentObservation: undefined, activeProgram: inputs.program,
      activeTaskDecision: inputs.taskDecision ?? continuation?.decision, activeTaskSessionId: inputs.sessionId ?? continuation?.state.observation?.sessionId ?? context.sessionId,
      activeTaskInitialState: initial, activeTaskContinuation: undefined })
    const result = requireGraphNodeOutput(child, 'environment_active_task_wait').state as ActiveTaskState
    return { finished: result.done === true, completed: result.done === true && !result.failure, result, userInput: result.userInput,
      taskDecision: context.graphExecution!.task()?.decision, observation: result.observation }
  },
})

export const environmentActiveTaskStepNode = defineNode({
  id: 'environment_active_task_step', name: 'Advance Active Task', category: 'environment',
  execution: { activation: 'always' },
  description: 'Advances task phases and updates the admitted gait without waiting for remote inference.',
  inputs: [{ name: 'state', type: 'object', optional: true, description: 'Saved active task state' }],
  outputs: [{ name: 'state', type: 'object', description: 'Current phase, movement and image references' }],
  async execute(inputs, context) {
    const execution = context.graphExecution!
    const program = context.activeProgram as EnvironmentTaskProgram
    const decision = context.activeTaskDecision as EnvironmentTaskDecision
    const sessionId = context.activeTaskSessionId as string
    const state: ActiveTaskState = { ...(inputs.state as ActiveTaskState ?? context.activeTaskInitialState as ActiveTaskState ?? { stepIndex: 0, updateRevision: 0, evidence: [] }) }
    const observation = getLatestEnvironmentObservation(sessionId)
    state.perception = getEnvironmentPerception(sessionId) ?? undefined
    if (observation) {
      state.observation = observationReference(observation)
      execution.recordFrames([observation.visual, ...(observation.visuals ?? [])].filter((frame): frame is EnvironmentVisualFrame => Boolean(frame)))
    }
    const previous = execution.task()
    const record = (complete = false) => execution.recordTask({ ...previous,
      objectiveId: previous?.objectiveId ?? execution.occurrenceId, executionId: execution.executionId,
      objective: previous?.desireId ? previous.objective : decision.objective!,
      completionCriteria: previous?.desireId ? previous.completionCriteria : decision.completionCriteria!,
      instruction: previous?.instruction ?? context.userMessage ?? decision.objective!, source: previous?.source ?? 'environment',
      decision: { ...decision, outcome: state.failure ? 'failed' : complete ? 'complete' : decision.outcome, objectiveComplete: complete,
        ...(state.failure ? { reason: state.failure.message } : {}),
        observationSummary: state.perception?.summary ?? state.identification?.description ?? decision.observationSummary,
        completionEvidence: complete ? state.evidence.join('\n') : decision.completionEvidence },
      selectedAction: state.action ? { type: state.action.type!, command: state.action.command, direction: state.action.direction, target: state.action.target } : null,
      actionId: state.stopId ?? state.motionId ?? state.completedActionId ?? '', actionStatus: state.failure?.type ?? (complete ? 'completed' : 'active'),
      feedback: state.feedback ?? null, baselineFrame: previous?.baselineFrame ?? null, updatedAt: new Date().toISOString() })
    const send = async (action: Partial<EnvironmentAction>): Promise<string> => {
      const output = await environmentSendActionNode.execute({ action: { ...action, id: undefined, sessionId },
        sessionId, instruction: decision.objective }, context,
        { allowedActions: [action.type!], maxDurationMs: Number.MAX_SAFE_INTEGER, defaultDurationMs: 0 })
      if (!output.count) throw new Error(String(output.message || 'Task action was not admitted'))
      return (output.commands as Array<{ id: string }>)[0].id
    }
    if (state.failure) { state.done = true; record(); return { state } }
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
      if (state.accepted && !state.updateId && state.lastControls !== encoded) {
        state.updateId = randomUUID(); state.updateRevision += 1
        execution.dispatch({ kind: 'coordinator_work', actionId: state.updateId, payload: {
          type: 'environment_command', handler: 'environment.command', resource: `environment-update:${sessionId}`,
          source: 'environment', username: context.username, maxAttempts: 1,
          input: { id: state.updateId, type: 'move', sessionId,
            movementUpdate: { actionId: state.motionId, revision: state.updateRevision, controls } },
        } })
        state.lastControls = encoded
      }
    }
    const step = program.steps[state.stepIndex]
    if (!step) { state.done = true; record(true); return { state } }
    if (step.kind !== 'behavior') {
      if (!state.motionId) {
        const generated = step.kind === 'generatedMotion'
          ? await movementGeneratorNode.execute({ movementRequest: { description: step.description, motionClass: 'body_local', sessionId },
            observation, sessionId, instruction: decision.objective }, context, {}) : null
        if (generated && !generated.valid) throw new Error(String(generated.error))
        delete state.feedback
        state.action = step.kind === 'action' ? step.action : generated!.action as Partial<EnvironmentAction>
        state.motionId = await send(state.action)
      }
      if (step.kind === 'action' && step.action.continuous) updateMovement(step.action)
      record(); return { state }
    }
    if (state.identification?.matchesTarget) {
      if (!state.stopId) { state.action = { type: 'stop' }; state.stopId = await send(state.action) }
      record(); return { state }
    }
    if (state.image && !state.identificationEffectId) {
      execution.recordFrames([state.image])
      const effect = execution.dispatch({ kind: 'coordinator_work', payload: {
        type: 'generic', handler: 'environment.identify', resource: 'remote-llm', source: 'environment',
        username: context.username, maxAttempts: 1,
        input: { target: step.target, objective: decision.objective, completionCriteria: step.completionCriteria,
          image: state.image, perception: state.perception }, metadata: { producer: 'environment-active-task', sessionId },
      } })
      state.identificationEffectId = effect.effectId; delete state.image
    }
    if (!state.motionId) { delete state.feedback; state.action = step.motion; state.motionId = await send(step.motion); state.accepted = false }
    updateMovement(step.motion, step.steering)
    const frame = state.perception?.frameCounter
    const periodic = state.lastIdentifiedFrame === undefined || (frame !== undefined && ((frame - state.lastIdentifiedFrame) >>> 0) >= step.identifyEveryFrames)
    const candidate = state.perception?.objects.some(object => step.candidateLabels.some(label => label.toLowerCase() === object.label.toLowerCase()))
    if (!state.snapshotId && !state.identificationEffectId && !state.image && (periodic || (candidate && frame !== state.lastIdentifiedFrame))) {
      const capture = prepareEnvironmentCommand({ type: 'captureImage', sessionId }, { username: context.username, originatingInstruction: decision.objective })
      execution.dispatch({ kind: 'coordinator_work', actionId: capture.input.id as string, payload: capture })
      state.snapshotId = capture.input.id as string; state.lastIdentifiedFrame = frame
    }
    record(); return { state }
  },
})

export const environmentActiveTaskWaitNode = defineNode({
  id: 'environment_active_task_wait', name: 'Receive Active Task Event', category: 'environment',
  description: 'Consumes observations and physical results within the current task phase.',
  inputs: [{ name: 'state', type: 'object', description: 'Current task phase and requests' }],
  outputs: [{ name: 'state', type: 'object', description: 'Updated task progress' },
    { name: 'continue', type: 'boolean', description: 'Advance the same execution' }],
  async execute(inputs, context) {
    const state = { ...inputs.state } as ActiveTaskState
    if (state.done) return { state, continue: false }
    const execution = context.graphExecution!
    const program = context.activeProgram as EnvironmentTaskProgram
    const advance = (evidence: string) => {
      state.completedActionId = state.stopId ?? state.motionId
      state.evidence = [...state.evidence, evidence]; state.stepIndex += 1
      for (const field of ['motionId', 'accepted', 'snapshotId', 'identificationEffectId', 'image', 'identification', 'lastIdentifiedFrame', 'stopId', 'updateId', 'lastControls'] as const) delete state[field]
      state.updateRevision = 0
      return { state, continue: true }
    }
    while (true) {
      const event = state.pendingEvents?.shift() ?? execution.waitForEvent(`active_task:${context.activeTaskSessionId}`)
      const payload = event.payload as Record<string, any>
      if (event.kind === 'user_steering') {
        state.userInput = { ...payload, activeTaskContinuation: { program, decision: context.activeTaskDecision,
          state: { ...state, userInput: undefined } } }
        if (program.steps[state.stepIndex].kind === 'behavior' || state.action?.continuous) return { state, continue: false }
        continue
      }
      if (event.kind === 'perception_received') return { state, continue: true }
      if (event.kind === 'action_accepted' && event.actionId === state.motionId) {
        state.accepted = true; return { state, continue: true }
      }
      if (event.kind === 'work_result' && payload.effectId === state.identificationEffectId) {
        delete state.identificationEffectId
        if (payload.result.state === 'completed') state.identification = payload.result.result
        else state.identificationError = payload.result.error
        return { state, continue: true }
      }
      if (event.kind === 'observation_received' && event.actionId === state.snapshotId) {
        const observation = payload.environmentObservation as EnvironmentObservation
        state.image = observation.visual ?? observation.visuals?.[0]; state.observation = observationReference(observation)
        delete state.snapshotId; return { state, continue: true }
      }
      if (event.kind !== 'physical_result') continue
      const feedback = payload.feedback
      if (event.actionId === state.updateId) { delete state.updateId; return { state, continue: true } }
      if (event.actionId === state.motionId) {
        state.feedback = feedback
        if (feedback.type === 'accepted' || feedback.type === 'status') { state.accepted = true; return { state, continue: true } }
        if (program.steps[state.stepIndex].kind === 'behavior' && !state.stopId
          && ['completed', 'failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
          state.failure = feedback; return { state, continue: true }
        }
        if (program.steps[state.stepIndex].kind !== 'behavior') {
          if (feedback.type === 'completed') {
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
        state.feedback = feedback; return advance(state.identification!.evidence)
      }
      if ((event.actionId === state.snapshotId || event.actionId === state.stopId)
        && ['failed', 'rejected', 'expired', 'cancelled', 'outcome_unknown'].includes(feedback.type)) {
        state.feedback = feedback; state.failure = feedback; return { state, continue: true }
      }
    }
  },
})
