import {
  createScratchpadEntry,
  initializeDesireMetrics,
  initializeScratchpadSummary,
  updateScratchpadSummary,
  type Desire,
  type DesireMetrics,
  type DesireOutcomeReview,
  type DesireScratchpadEntry,
} from './types.js'
import { loadConfig } from './config.js'
import {
  saveDesireManifest,
  saveDesireReviewToFolder,
} from './storage.js'

const CYCLE_RESET_STRENGTH = 0.3
const CONTINUE_STRENGTH = 0.5
const RETRY_STRENGTH_PENALTY = 0.1
const RECURRING_CYCLE_THRESHOLD = 2
const RECURRING_COMPLETION_THRESHOLD = 2

export type DesireOutcomeAction =
  | 'completed'
  | 'recurring_reset'
  | 'continued'
  | 'milestone_advanced'
  | 'retry'
  | 'abandoned'
  | 'escalated'

export interface AppliedDesireOutcome {
  desire: Desire
  review: DesireOutcomeReview
  action: DesireOutcomeAction
  summary: string
}

export interface DesireOutcomeTransitionDependencies {
  loadConfig: typeof loadConfig
  saveManifest: typeof saveDesireManifest
  saveReview: typeof saveDesireReviewToFolder
}

function inferDesireNature(metrics: DesireMetrics): 'recurring' | 'achievable' | 'aspirational' {
  if (metrics.cycleCount > RECURRING_CYCLE_THRESHOLD
    || metrics.completionCount > RECURRING_COMPLETION_THRESHOLD) {
    return 'recurring'
  }
  if (metrics.completionCount <= 1 && metrics.executionAttemptCount <= 3) {
    return 'achievable'
  }
  if (metrics.executionAttemptCount > 3 && metrics.completionCount === 0) {
    return 'aspirational'
  }
  return 'achievable'
}

function withScratchpadEntry(desire: Desire, entry: DesireScratchpadEntry): Desire {
  return {
    ...desire,
    scratchpad: updateScratchpadSummary(
      desire.scratchpad || initializeScratchpadSummary(),
      entry,
    ),
  }
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

function clearExecutionState(desire: Desire): Desire {
  return {
    ...desire,
    execution: undefined,
    plan: undefined,
    review: undefined,
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

  const now = new Date().toISOString()
  let updated = baseReviewedDesire(desire, review, now)
  let action: DesireOutcomeAction
  let summary: string

  if (review.isFixableBug) {
    action = 'escalated'
    updated.status = 'awaiting_approval'
    updated.currentStage = 'user_approval'
    summary = `Review of "${desire.title}" found a possible system defect. User review is required; no repair task was created.`
  } else if (review.verdict === 'completed') {
    const metrics = updated.metrics || initializeDesireMetrics()
    const nature = inferDesireNature(metrics)
    const completionCount = metrics.completionCount + 1
    updated.metrics = {
      ...metrics,
      completionCount,
    }

    if (nature === 'recurring') {
      action = 'recurring_reset'
      updated = clearExecutionState(updated)
      updated.status = 'nascent'
      updated.currentStage = 'nascent'
      updated.strength = CYCLE_RESET_STRENGTH
      updated.runCount = 0
      updated.metrics = {
        ...updated.metrics!,
        cycleCount: updated.metrics!.cycleCount + 1,
        currentCycle: updated.metrics!.currentCycle + 1,
      }
      summary = `Completed a cycle of "${desire.title}" and reset the existing desire for its next cycle.`
    } else if (nature === 'aspirational') {
      action = 'continued'
      updated = clearExecutionState(updated)
      updated.status = 'pending'
      updated.currentStage = 'strengthening'
      updated.strength = review.adjustedStrength ?? CONTINUE_STRENGTH
      summary = `Reviewed "${desire.title}" as an ongoing aspiration and returned it to the existing desire queue.`
    } else {
      action = 'completed'
      updated.status = 'completed'
      updated.currentStage = 'complete'
      updated.completedAt = now
      summary = `Reviewed "${desire.title}" as completed.`
    }
  } else if (review.verdict === 'retry') {
    const config = await deps.loadConfig(username)
    const maxRetries = config.execution?.maxPlanRetries
    if (!Number.isInteger(maxRetries) || Number(maxRetries) < 0) {
      throw new Error('Agency execution configuration requires a non-negative maxPlanRetries')
    }

    const metrics = updated.metrics || initializeDesireMetrics()
    if (metrics.planRevisionCount >= Number(maxRetries)) {
      action = 'escalated'
      updated.status = 'awaiting_approval'
      updated.currentStage = 'user_approval'
      summary = `Review of "${desire.title}" reached the configured retry limit and now requires user review.`
    } else {
      action = 'retry'
      if (updated.plan) {
        updated.planHistory = [...(updated.planHistory || []), updated.plan]
      }
      updated = clearExecutionState(updated)
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
        planRevisionCount: metrics.planRevisionCount + 1,
        lastActivityAt: now,
      }
      summary = `Review of "${desire.title}" requested a new plan using the recorded lessons.`
    }
  } else if (review.verdict === 'continue') {
    if (desire.goalType === 'long_running'
      && review.milestoneAdvance
      && !review.completionCriteriaMet) {
      action = 'milestone_advanced'
      updated = advanceMilestone(clearExecutionState(updated), now)
      updated.status = 'planning'
      updated.currentStage = 'planning'
      summary = `Reviewed "${desire.title}", advanced its existing milestone progress, and returned it to planning.`
    } else {
      action = 'continued'
      updated = clearExecutionState(updated)
      updated.status = 'pending'
      updated.currentStage = 'strengthening'
      updated.strength = review.adjustedStrength ?? desire.strength
      summary = `Review of "${desire.title}" returned the existing desire to the queue for continued pursuit.`
    }
  } else if (review.verdict === 'abandon') {
    action = 'abandoned'
    updated.status = 'abandoned'
    updated.currentStage = 'abandoned'
    updated.completedAt = now
    summary = `Review of "${desire.title}" abandoned the desire: ${review.reasoning}`
  } else {
    action = 'escalated'
    updated.status = 'awaiting_approval'
    updated.currentStage = 'user_approval'
    summary = review.userMessage?.trim()
      || `Review of "${desire.title}" requires user attention: ${review.reasoning}`
  }

  updated = withScratchpadEntry(updated, reviewEntry(review, action))
  await deps.saveReview(updated.id, review, username)
  await deps.saveManifest(updated, username)

  return { desire: updated, review, action, summary }
}
