import {
  createScratchpadEntry,
  generateReviewId,
  initializeDesireMetrics,
  initializeStageIterations,
  type Desire,
  type DesireOutcomeReview,
  type DesireReview,
} from './types.js'
import {
  addScratchpadEntryToFolder,
  loadDesireReviewFromFolder,
  saveDesireManifest,
  saveDesireReviewToFolder,
} from './storage.js'

export type DesirePlanReviewAction =
  | 'rejected'
  | 'auto_approved'
  | 'awaiting_approval'

export interface RecordedDesirePlanReview {
  review: DesireReview
  autoApprove: boolean
  reasoning: string
  reused: boolean
}

export interface AppliedDesirePlanReview {
  desire: Desire
  review: DesireReview
  action: DesirePlanReviewAction
  summary: string
}

export interface DesirePlanReviewRecorderDependencies {
  loadReview: typeof loadDesireReviewFromFolder
  saveReview: typeof saveDesireReviewToFolder
}

export interface DesirePlanReviewTransitionDependencies {
  saveManifest: typeof saveDesireManifest
  addScratchpadEntry: typeof addScratchpadEntryToFolder
  now: () => string
}

function isPlanReview(review: DesireReview | DesireOutcomeReview): review is DesireReview {
  return 'alignmentScore' in review && 'riskAssessment' in review
}

function validateReview(
  desire: Desire,
  review: DesireReview,
  autoApprove: boolean,
): void {
  if (!desire.plan) throw new Error(`Cannot review desire ${desire.id} without a persisted plan`)
  if (!review.id?.trim()
    || !['approve', 'reject', 'revise'].includes(review.verdict)
    || !review.reasoning?.trim()
    || !Number.isFinite(review.alignmentScore)
    || review.alignmentScore < 0
    || review.alignmentScore > 1
    || !review.riskAssessment?.trim()
    || !review.reviewedAt?.trim()
    || review.id !== generateReviewId(desire.id, desire.plan.version)
    || review.planId !== desire.plan.id
    || review.planVersion !== desire.plan.version
    || review.autoApprove !== autoApprove) {
    throw new Error('Plan review is missing required typed fields or does not match the persisted plan version')
  }
}

/**
 * Record the exact verdict for a plan version before downstream side effects.
 * A retry reuses this receipt so a second model response cannot alter a review
 * after its inner-dialogue or Persona Memory write has begun.
 */
export async function recordDesirePlanReview(
  desire: Desire,
  review: DesireReview,
  autoApprove: boolean,
  username: string,
  dependencies: Partial<DesirePlanReviewRecorderDependencies> = {},
): Promise<RecordedDesirePlanReview> {
  const deps: DesirePlanReviewRecorderDependencies = {
    loadReview: loadDesireReviewFromFolder,
    saveReview: saveDesireReviewToFolder,
    ...dependencies,
  }

  if (!username.trim()) throw new Error('Plan review recording requires a username')
  if (desire.status !== 'reviewing') {
    throw new Error(`Cannot record plan review for desire ${desire.id} in '${desire.status}' status`)
  }
  validateReview(desire, review, autoApprove)

  const existing = await deps.loadReview(desire.id, review.id, username)
  if (existing) {
    if (!isPlanReview(existing)) {
      throw new Error(`Review ID collision for desire ${desire.id}: ${review.id}`)
    }
    validateReview(desire, existing, existing.autoApprove === true)
    return {
      review: existing,
      autoApprove: existing.autoApprove === true,
      reasoning: existing.reasoning,
      reused: true,
    }
  }

  await deps.saveReview(desire.id, review, username)
  return {
    review,
    autoApprove,
    reasoning: review.reasoning,
    reused: false,
  }
}

/**
 * Apply one recorded plan review and persist exactly one lifecycle transition.
 * User approval remains part of the Desire manifest; this owner never creates a
 * competing skill-approval queue item.
 */
export async function applyDesirePlanReview(
  desire: Desire,
  review: DesireReview,
  autoApprove: boolean,
  username: string,
  dependencies: Partial<DesirePlanReviewTransitionDependencies> = {},
): Promise<AppliedDesirePlanReview> {
  const deps: DesirePlanReviewTransitionDependencies = {
    saveManifest: saveDesireManifest,
    addScratchpadEntry: addScratchpadEntryToFolder,
    now: () => new Date().toISOString(),
    ...dependencies,
  }

  if (!username.trim()) throw new Error('Plan review transition requires a username')
  if (desire.status !== 'reviewing') {
    throw new Error(`Cannot apply plan review to desire ${desire.id} in '${desire.status}' status`)
  }
  validateReview(desire, review, autoApprove)

  const now = deps.now()
  const metrics = desire.metrics || initializeDesireMetrics()
  const stageIterations = desire.stageIterations || initializeStageIterations()
  const updated: Desire = {
    ...desire,
    review,
    updatedAt: now,
    metrics: {
      ...metrics,
      lastActivityAt: now,
      planRejectionCount: metrics.planRejectionCount + (review.verdict === 'reject' ? 1 : 0),
    },
    stageIterations: {
      ...stageIterations,
      planReview: stageIterations.planReview + 1,
    },
  }

  let action: DesirePlanReviewAction
  let summary: string
  if (review.verdict === 'reject') {
    action = 'rejected'
    updated.status = 'rejected'
    updated.currentStage = 'failed'
    updated.completedAt = now
    updated.rejectionHistory = [
      ...(desire.rejectionHistory || []),
      {
        rejectedAt: now,
        rejectedBy: 'review',
        reason: review.reasoning,
        canRetry: true,
      },
    ]
    summary = `Plan for "${desire.title}" was rejected by alignment and safety review.`
  } else if (review.verdict === 'approve' && autoApprove) {
    action = 'auto_approved'
    updated.status = 'approved'
    updated.currentStage = 'executing'
    summary = `Plan for "${desire.title}" passed review and was auto-approved under the active trust policy.`
  } else {
    action = 'awaiting_approval'
    updated.status = 'awaiting_approval'
    updated.currentStage = 'user_approval'
    summary = review.verdict === 'revise'
      ? `Plan for "${desire.title}" has review concerns and requires user review.`
      : `Plan for "${desire.title}" passed review and requires user approval.`
  }

  const entry = createScratchpadEntry(
    'review_completed',
    `${summary} ${review.reasoning}`,
    'llm',
    'desire-planner',
    {
      reviewId: review.id,
      planId: review.planId,
      planVersion: review.planVersion,
      verdict: review.verdict,
      action,
      idempotencyKey: `desire-plan-review:${desire.id}:v${review.planVersion}`,
    },
  )
  updated.scratchpad = await deps.addScratchpadEntry(updated.id, entry, username)
  await deps.saveManifest(updated, username)
  return { desire: updated, review, action, summary }
}
