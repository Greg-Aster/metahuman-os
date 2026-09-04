import { applyDesirePlanReview } from '../../agency/desire-plan-review-transition.js'
import type { Desire, DesireReview } from '../../agency/types.js'
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (inputs, context) => {
  const desire = inputs.desire as Desire | undefined
  const review = inputs.review as DesireReview | undefined
  const autoApprove = inputs.autoApprove
  const memoryReceipt = inputs.memoryReceipt
  const username = typeof context.username === 'string' ? context.username.trim() : ''

  if (!desire || !review || typeof autoApprove !== 'boolean') {
    throw new Error('Plan Review Transition requires desire, review, and autoApprove inputs')
  }
  if (!Number.isInteger(memoryReceipt) || Number(memoryReceipt) < 1) {
    throw new Error('Plan Review Transition requires a durable inner-dialogue memory receipt')
  }
  if (!username) throw new Error('Plan Review Transition requires a profile username')

  const applied = await applyDesirePlanReview(desire, review, autoApprove, username)
  return {
    success: true,
    desire: applied.desire,
    review: applied.review,
    action: applied.action,
    summary: applied.summary,
  }
}

export const DesirePlanReviewTransitionNode: NodeDefinition = defineNode({
  id: 'desire_plan_review_transition',
  name: 'Apply Plan Review',
  category: 'agency',
  description: 'Persists one canonical Desire lifecycle transition from a validated plan review',
  inputs: [
    { name: 'desire', type: 'object', description: 'Reviewing desire with a persisted plan' },
    { name: 'review', type: 'object', description: 'Validated plan review' },
    { name: 'autoApprove', type: 'boolean', description: 'Active policy auto-approval decision' },
    { name: 'memoryReceipt', type: 'number', description: 'Saved inner-dialogue entry count used as a persistence gate' },
  ],
  outputs: [
    { name: 'success', type: 'boolean', description: 'Whether the review transition was persisted' },
    { name: 'desire', type: 'object', description: 'Durably updated desire' },
    { name: 'review', type: 'object', description: 'Applied plan review' },
    { name: 'action', type: 'string', description: 'Applied lifecycle action' },
    { name: 'summary', type: 'string', description: 'Human-readable transition summary' },
  ],
  properties: {},
  execute,
})

export default DesirePlanReviewTransitionNode
