import { defineNode } from '../types.js'
import { faceExpressionSchema, expressionFeedbackSchema } from './expression.schemas.js'
import { environmentSendActionNode } from './send-action.node.js'
import { createHash } from 'node:crypto'
import { robotSpeechDeliveryProgress } from '../../tts/robot-speech.js'

export const environmentFaceExpressionNode = defineNode({
  ...faceExpressionSchema,
  async execute(inputs, context, properties) {
    const feedback = inputs.feedback ?? {}
    const event = context.environmentObservation?.state?.bodyEvent
    // The body-event branch supplies its event kind as control. Attribute that
    // initial reaction only; subsequent replacement faces keep ordinary tokens.
    const reaction = event?.name === 'body_event' && inputs.control === event.data?.kind
      && ['tipped', 'rapid_movement'].includes(inputs.control)
    const generatedToken = createHash('sha256')
      .update(context.graphExecution?.occurrenceId ?? String(context.requestId)).digest('hex').slice(0, 32)
    const token = inputs.token ?? feedback.token ?? (reaction ? `be_${generatedToken.slice(0, 29)}` : generatedToken)
    const release = (feedback.operation ?? properties?.operation) === 'release'
    if (release && !inputs.token && !feedback.token) throw new Error('Releasing an expression requires its token')
    if (release && inputs.delivery?.accepted && inputs.delivery.route === 'robot') {
      const execution = context.graphExecution!
      // Only this release waits. The existing durable event owner releases the
      // worker while speech renders/plays, without gating any other channel.
      while (['rendering', 'playing'].includes(
        robotSpeechDeliveryProgress(inputs.delivery, execution.events()).status)) {
        execution.waitForEvent('robot_result')
      }
    }
    const result = await environmentSendActionNode.execute({
      action: { type: 'faceExpression',
        expression: release ? undefined : inputs.expression ?? feedback.expression ?? properties?.expression,
        displayToken: token, displayIfToken: feedback.ifToken, displayRelease: release,
        displayTimeoutMs: feedback.timeoutMs ?? properties?.timeoutMs ?? 60000,
        displayBackground: feedback.background ?? properties?.background ?? false },
      sessionId: inputs.sessionId || feedback.sessionId || properties?.sessionId || undefined,
    }, context, { allowedActions: ['faceExpression'] })
    return { ...result, token, control: inputs.control,
      ...(result.success && !release && feedback.errorExpression ? { failureFeedback: {
        token, ifToken: token, operation: 'set', expression: feedback.errorExpression,
        timeoutMs: feedback.errorTimeoutMs, background: false, sessionId: result.targetSessionId,
      } } : {}) }
  },
})

export const environmentExpressionFeedbackNode = defineNode({
  ...expressionFeedbackSchema,
  async execute(inputs, context, properties) {
    const external = context.environmentDisplayFeedback
    const token = inputs.token ?? external?.token ?? createHash('sha256')
      .update(context.graphExecution!.occurrenceId).digest('hex').slice(0, 32)
    const failed = external?.stage === 'error' || Boolean(inputs.actionResult?.failure)
      || ['failed', 'expired'].includes(inputs.workResult?.result?.state)
    const operation = failed ? 'set' : external?.operation ?? properties?.operation ?? 'set'
    if (operation === 'release' && !inputs.token && !external?.token) throw new Error('Feedback release requires its original token')
    return { control: inputs.control, token, feedback: {
      expression: failed ? properties?.errorExpression : properties?.expression,
      timeoutMs: failed ? properties?.errorTimeoutMs : properties?.timeoutMs,
      background: failed ? false : properties?.background,
      ...(operation === 'set' && !external && !failed ? {
        errorExpression: properties?.errorExpression, errorTimeoutMs: properties?.errorTimeoutMs,
      } : {}),
      ...external, ...(failed ? { ifToken: token } : {}), operation, token,
    } }
  },
})
