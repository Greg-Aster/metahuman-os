import { bodyEventContextSchema, bodyEventDecisionSchema, environmentEventRequestSchema } from './body-event.schemas.js'
import { defineNode, NodeInputValidationError } from '../types.js'
import { readRobotStatusLive } from '../../robot-status-live.js'
import { loadRobotStatus } from '../../robot-status.js'
import { loadBufferForUser } from '../../conversation-buffer.js'
import { projectRobotStatusContext } from './helpers.js'

export const bodyEventContextNode = defineNode({
  ...bodyEventContextSchema,
  async execute(_inputs, context, properties) {
    const observation = context.environmentObservation
    const event = observation?.state?.bodyEvent
    if (!event) throw new Error('Body Event Context requires an attributed body event')
    const robotStatus = { saved: projectRobotStatusContext(loadRobotStatus(context.username)),
      live: await readRobotStatusLive(context.username, observation.sessionId) }
    const recentConversation = loadBufferForUser(context.username, 'conversation').messages
    return { event, messages: [
      { role: 'system', content: properties?.systemPrompt || '' },
      { role: 'user', content: JSON.stringify({ event, sourceObservationAt: observation.timestamp,
        sessionId: observation.sessionId, robotStatus,
        executionId: context.graphExecution?.executionId ?? null,
        currentTask: context.graphExecution?.task() ?? null,
        activeExecutions: context.graphExecution?.activeExecutions() ?? null,
        recentConversation }) },
    ] }
  },
})

export const bodyEventDecisionNode = defineNode({
  ...bodyEventDecisionSchema,
  async execute(inputs, context) {
    let decision
    try { decision = JSON.parse(inputs.response) }
    catch { throw new NodeInputValidationError('response', 'Event decision must be JSON') }
    if (!decision || !['delegate', 'none'].includes(decision.decision)
      || (typeof decision.instruction !== 'string' && !(decision.decision === 'none' && decision.instruction === null))
      || typeof decision.reason !== 'string'
      || (decision.decision === 'delegate' && !decision.instruction.trim())) {
      throw new NodeInputValidationError('response', 'Event decision requires decision, instruction and reason')
    }
    const delegate = decision.decision === 'delegate'
    return { delegate, decision, invocation: delegate ? { graph: 'environment', context: {
      userMessage: '', userMessageEntry: undefined,
      robotOperatorContext: undefined,
      environmentObservation: { ...context.environmentObservation, text: [] },
      environmentObservationCurrent: true,
      bodyEventDecision: { ...decision, event: context.environmentObservation?.state?.bodyEvent,
        sourceObservationAt: context.environmentObservation?.timestamp },
    } } : null }
  },
})

export const environmentEventRequestNode = defineNode({
  ...environmentEventRequestSchema,
  async execute(inputs, context) {
    const decision = context.bodyEventDecision
    const cleared = { autonomy: false, robotObserver: null, memories: [], sourceObservationAt: '', responseMetadata: {} }
    // A later user turn retains its own authority rather than inheriting a previous event intention.
    if (inputs.message) return { ...cleared, message: inputs.message, plannerDecision: null }
    if (inputs.plannerDecision) return {
      message: inputs.plannerDecision.instruction, plannerDecision: inputs.plannerDecision, autonomy: true,
      robotObserver: inputs.robotObserver, memories: inputs.memories ?? [],
      sourceObservationAt: inputs.sourceObservationAt, responseMetadata: inputs.responseMetadata ?? {},
    }
    if (!decision) return { ...cleared, message: '', plannerDecision: null }
    return { ...cleared, message: decision.instruction, plannerDecision: {
      instruction: decision.instruction, reason: decision.reason,
      event: decision.event, source: 'body-event-trigger', sourceObservationAt: decision.sourceObservationAt,
    } }
  },
})
