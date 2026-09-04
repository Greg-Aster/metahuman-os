import { recordDesirePlanReview } from '../../agency/desire-plan-review-transition.js'
import type { Desire, DesireReview } from '../../agency/types.js'
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (inputs, context) => {
  const desire = inputs.desire as Desire | undefined
  const review = inputs.review as DesireReview | undefined
  const autoApprove = inputs.autoApprove
  const username = typeof context.username === 'string' ? context.username.trim() : ''

  if (!desire || !review || typeof autoApprove !== 'boolean') {
    throw new Error('Plan Review Recorder requires desire, review, and autoApprove inputs')
  }
  if (!username) throw new Error('Plan Review Recorder requires a profile username')

  const recorded = await recordDesirePlanReview(desire, review, autoApprove, username)
  return {
    success: true,
    persisted: true,
    review: recorded.review,
    autoApprove: recorded.autoApprove,
    reasoning: recorded.reasoning,
    reused: recorded.reused,
  }
}

export const DesirePlanReviewRecorderNode: NodeDefinition = defineNode({
  id: 'desire_plan_review_recorder',
  name: 'Record Plan Review',
  category: 'agency',
  description: 'Durably records one immutable plan-version review before its downstream side effects',
  inputs: [
    { name: 'desire', type: 'object', description: 'Reviewing desire with a persisted plan' },
    { name: 'review', type: 'object', description: 'Validated plan review' },
    { name: 'autoApprove', type: 'boolean', description: 'Active policy auto-approval decision' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether the review receipt is available' },
    { name: 'persisted', type: 'boolean', description: 'Whether the review receipt is durable' },
    { name: 'review', type: 'object', description: 'Canonical persisted review' },
    { name: 'autoApprove', type: 'boolean', description: 'Canonical persisted auto-approval decision' },
    { name: 'reasoning', type: 'string', description: 'Canonical persisted review reasoning' },
    { name: 'reused', type: 'boolean', description: 'Whether an existing receipt was reused during retry' },
  ],
  properties: {},
  execute,
})

export default DesirePlanReviewRecorderNode
