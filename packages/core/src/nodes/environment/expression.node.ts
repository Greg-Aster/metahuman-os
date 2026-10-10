import { defineNode } from '../types.js'
import { faceExpressionSchema, expressionFeedbackSchema } from './expression.schemas.js'
import { environmentSendActionNode } from './send-action.node.js'
import { createHash } from 'node:crypto'

export const environmentFaceExpressionNode = defineNode({
  ...faceExpressionSchema,
  async execute(inputs, context, properties) {
    const feedback = inputs.feedback ?? {}
    const token = inputs.token ?? feedback.token ?? createHash('sha256')
      .update(context.graphExecution?.occurrenceId ?? String(context.requestId)).digest('hex').slice(0, 32)
    const release = (feedback.operation ?? properties?.operation) === 'release'
    if (release && !inputs.token && !feedback.token) throw new Error('Releasing an expression requires its token')
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
