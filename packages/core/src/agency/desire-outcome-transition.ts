import {
  createScratchpadEntry,
  initializeDesireMetrics,
  type Desire,
  type DesireOutcomeReview,
  type DesireScratchpadEntry,
} from './types.js'
import { loadConfig } from './config.js'
import {
  addScratchpadEntryToFolder,
  saveDesireManifest,
  saveDesireReviewToFolder,
} from './storage.js'

const RETRY_STRENGTH_PENALTY = 0.1

export type DesireOutcomeAction =
  | 'completed'
  | 'milestone_advanced'
  | 'retry'
  | 'archived'
  | 'escalated'

export interface AppliedDesireOutcome {
  desire: Desire
  review: DesireOutcomeReview
  action: DesireOutcomeAction
  summary: string
}

export interface DesireOutcomeTransitionDependencies {
  loadConfig: typeof loadConfig
  addScratchpadEntry: typeof addScratchpadEntryToFolder
  saveManifest: typeof saveDesireManifest
  saveReview: typeof saveDesireReviewToFolder
}

function reviewEntry(review: DesireOutcomeReview, action: DesireOutcomeAction): DesireScratchpadEntry {
  return createScratchpadEntry(
    'outcome_review',
    `Outcome review: ${review.verdict} (score: ${review.successScore}); action: ${action}`,
    'agent',
    'desire-outcome-reviewer',
    { review, action },
  )
}

/** Archive the current plan/execution/review receipts before another planning cycle. */
export function archiveCurrentDesireCycle(desire: Desire): Desire {
  const planHistory = [...(desire.planHistory || [])]
  if (desire.plan && !planHistory.some(plan =>
    plan.id === desire.plan!.id && plan.version === desire.plan!.version)) {
    planHistory.push(desire.plan)
  }
  const reviewHistory = [...(desire.reviewHistory || [])]
  if (desire.review && !reviewHistory.some(review => review.id === desire.review!.id)) {
    reviewHistory.push(desire.review)
  }
  const executionHistory = [...(desire.executionHistory || [])]
  if (desire.execution && !executionHistory.some(execution =>
    execution.startedAt === desire.execution!.startedAt)) {
    executionHistory.push(desire.execution)
  }
  const outcomeReviewHistory = [...(desire.outcomeReviewHistory || [])]
  if (desire.outcomeReview && !outcomeReviewHistory.some(review => review.id === desire.outcomeReview!.id)) {
    outcomeReviewHistory.push(desire.outcomeReview)
  }
  return {
    ...desire,
    planHistory,
    reviewHistory,
    executionHistory,
    outcomeReviewHistory,
    execution: undefined,
    plan: undefined,
    review: undefined,
    outcomeReview: undefined,
  }
}

function advanceMilestone(desire: Desire, now: string): Desire {
  if (!desire.milestones || !desire.goalProgress) {
    throw new Error(`Cannot advance milestone for desire ${desire.id} without milestone progress`)
  }

  const currentIndex = desire.goalProgress.currentMilestone
  const current = desire.milestones[currentIndex]
  if (!current) {
    throw new Error(`Cannot advance missing milestone ${currentIndex} for desire ${desire.id}`)
  }

  const milestones = desire.milestones.map((milestone, index) => index === currentIndex
    ? { ...milestone, status: 'completed' as const, completedAt: now }
    : { ...milestone })
  const next = milestones[currentIndex + 1]
  if (!next) {
    throw new Error(
      `Desire ${desire.id} has no next milestone but completion criteria were not met`,
    )
  }
  next.status = 'in_progress'

  const completedMilestones = milestones.filter(milestone => milestone.status === 'completed').length
  return {
    ...desire,
    milestones,
    goalProgress: {
      ...desire.goalProgress,
      currentMilestone: currentIndex + 1,
      completedMilestones,
      progressPercent: Math.round((completedMilestones / milestones.length) * 100),
      lastCheckinAt: now,
    },
  }
}

function baseReviewedDesire(
  desire: Desire,
  review: DesireOutcomeReview,
  now: string,
): Desire {
  const metrics = desire.metrics || initializeDesireMetrics()
  const reviewedAttempts = Math.max(1, metrics.executionAttemptCount)
  return {
    ...desire,
    outcomeReview: review,
    updatedAt: now,
    lastReviewedAt: now,
    lastDecayAt: now,
    metrics: {
      ...metrics,
      lastActivityAt: now,
      avgSuccessScore: (
        metrics.avgSuccessScore * (reviewedAttempts - 1) + review.successScore
      ) / reviewedAttempts,
    },
    stageIterations: {
      planning: desire.stageIterations?.planning || 0,
      planReview: desire.stageIterations?.planReview || 0,
      userApproval: desire.stageIterations?.userApproval || 0,
      executing: desire.stageIterations?.executing || 0,
      outcomeReview: (desire.stageIterations?.outcomeReview || 0) + 1,
    },
  }
}

/**
 * Apply one validated outcome review and persist its one canonical transition.
 * This function intentionally creates no tasks, repair requests, approvals, or
 * alternate execution work. Escalation changes only the desire's durable state
 * so an explicitly authorized user action can decide what happens next.
 */
export async function applyDesireOutcomeReview(
  desire: Desire,
  review: DesireOutcomeReview,
  username: string,
  dependencies: Partial<DesireOutcomeTransitionDependencies> = {},
): Promise<AppliedDesireOutcome> {
  const deps: DesireOutcomeTransitionDependencies = {
    loadConfig,
    addScratchpadEntry: addScratchpadEntryToFolder,
    saveManifest: saveDesireManifest,
    saveReview: saveDesireReviewToFolder,
    ...dependencies,
  }
  if (!username.trim()) throw new Error('Outcome transition requires a username')
  if (!['awaiting_review', 'completed', 'failed'].includes(desire.status)) {
    throw new Error(
      `Cannot review desire ${desire.id} in '${desire.status}' status`,
    )
  }

  if (!review.userConfirmed && (review.planId !== desire.plan?.id || review.planVersion !== desire.plan?.version
    || !review.executionStartedAt || review.executionStartedAt !== desire.execution?.startedAt)) {
    throw new Error('Outcome review does not identify the current plan version and execution attempt')
  }
  if (desire.outcomeReview?.id === review.id) {
    return { desire, review, action: desire.status === 'completed' ? 'completed' : 'escalated',
      summary: `Desire ${desire.id}: this outcome review was already applied.` }
  }
  const now = new Date().toISOString()
  let updated = baseReviewedDesire(desire, review, now)
  let action: DesireOutcomeAction
  let summary: string

  const completedSteps = desire.execution?.status === 'completed'
    && desire.execution.planId === desire.plan?.id && desire.execution.planVersion === desire.plan?.version
    && Boolean(desire.plan?.steps.length)
    && desire.execution.stepResults?.length === desire.plan?.steps.length
    && desire.execution.stepResults?.every((step, index) => step.stepOrder === desire.plan!.steps[index].order
      && step.success && step.result != null)
  if (desire.execution?.status === 'outcome_unknown' && !review.userConfirmed) {
    action = 'escalated'
    updated.status = 'needs_attention'
    updated.currentStage = 'user_attention'
    updated.dispositionReason = 'The external attempt has no recoverable result. Establish what happened before authorizing more work.'
    summary = `Desire ${desire.id} stopped with an unknown execution outcome; owner review is required.`
  } else if (review.isFixableBug) {
    action = 'escalated'
    updated.status = 'needs_attention'
    updated.currentStage = 'user_attention'
    updated.dispositionReason = review.userMessage?.trim() || review.reasoning
    summary = `Review of "${desire.title}" found a possible system defect. User review is required; no repair task was created.`
  } else if (review.verdict === 'completed') {
    const verified = review.completionCriteriaMet === true
      && Boolean(desire.plan?.completionCriteria?.trim())
      && (review.userConfirmed === true || completedSteps)
    if (!verified) {
      action = 'escalated'
      updated.status = 'needs_attention'
      updated.currentStage = 'user_attention'
      updated.dispositionReason = 'Completion was claimed without evidence satisfying the approved plan criteria.'
      summary = `Desire ${desire.id} is awaiting review of its missing completion evidence.`
    } else {
      action = 'completed'
      updated.status = 'completed'
      updated.currentStage = 'complete'
      updated.completedAt = now
      updated.metrics = { ...updated.metrics, completionCount: updated.metrics.completionCount + 1 }
      summary = `Verified completion of "${desire.title}". Any new cycle requires fresh evidence and a newly reviewed plan.`
    }
  } else if (review.verdict === 'continue' && desire.goalType === 'long_running'
    && review.milestoneAdvance && review.completionCriteriaMet !== true
    && completedSteps
    && desire.goalProgress && desire.milestones?.[desire.goalProgress.currentMilestone + 1]) {
    action = 'milestone_advanced'
    updated = advanceMilestone(archiveCurrentDesireCycle(updated), now)
    updated.status = 'planning'
    updated.currentStage = 'planning'
    summary = `Verified progress of desire ${desire.id}; the next milestone requires a new plan and review.`
  } else if (review.verdict === 'retry' || review.verdict === 'continue') {
    const config = await deps.loadConfig(username)
    const maxRetries = config.execution?.maxPlanRetries
    if (!Number.isInteger(maxRetries) || Number(maxRetries) < 0) {
      throw new Error('Agency execution configuration requires a non-negative maxPlanRetries')
    }

    const metrics = updated.metrics || initializeDesireMetrics()
    if (metrics.outcomeRetryCount >= Number(maxRetries)) {
      action = 'escalated'
      updated.status = 'needs_attention'
      updated.currentStage = 'user_attention'
      updated.dispositionReason = `Execution retry limit reached: ${review.reasoning}`
      summary = `Review of "${desire.title}" reached the configured retry limit and now requires user review.`
    } else {
      action = 'retry'
      updated = archiveCurrentDesireCycle(updated)
      updated.status = 'planning'
      updated.currentStage = 'planning'
      updated.strength = Math.max(0.3, desire.strength - RETRY_STRENGTH_PENALTY)
      updated.userCritique = [
        'RETRY REQUESTED - Previous attempt did not satisfy the desire.',
        ...(review.lessonsLearned || []).map(lesson => `- ${lesson}`),
        ...(review.nextAttemptSuggestions || []).map(suggestion => `- ${suggestion}`),
      ].join('\n')
      updated.critiqueAt = now
      updated.metrics = {
        ...metrics,
        outcomeRetryCount: metrics.outcomeRetryCount + 1,
        lastActivityAt: now,
      }
      summary = `Review of "${desire.title}" requested a new plan using the recorded lessons.`
    }
  } else if (review.verdict === 'abandon') {
    action = 'archived'
    updated.status = 'archived'
    updated.currentStage = 'archived'
    updated.dispositionReason = review.reasoning
    updated.completedAt = now
    summary = `Review of "${desire.title}" archived the desire: ${review.reasoning}`
  } else {
    action = 'escalated'
    updated.status = 'needs_attention'
    updated.currentStage = 'user_attention'
    updated.dispositionReason = review.userMessage?.trim() || review.reasoning
    summary = review.userMessage?.trim()
      || `Review of "${desire.title}" requires user attention: ${review.reasoning}`
  }

  updated.scratchpad = await deps.addScratchpadEntry(
    updated.id,
    reviewEntry(review, action),
    username,
  )
  await deps.saveReview(updated.id, review, username)
  await deps.saveManifest(updated, username)

  return { desire: updated, review, action, summary }
}
