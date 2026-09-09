import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_AGENCY_CONFIG } from './config.js'
import {
  applyDesireOutcomeReview,
  type DesireOutcomeTransitionDependencies,
} from './desire-outcome-transition.js'
import { initializeDesireMetrics, type Desire, type DesireOutcomeReview } from './types.js'

function desire(): Desire {
  return {
    id: 'desire-1', title: 'Test outcome', description: 'Test', reason: 'Contract',
    source: 'user_request', status: 'awaiting_review', currentStage: 'outcome_review',
    strength: 0.8, baseWeight: 1, threshold: 0.7, decayRate: 0.03,
    lastReviewedAt: '2026-08-25T00:00:00.000Z', reinforcements: 1, runCount: 1,
    risk: 'low', requiredTrustLevel: 'suggest', metrics: {
      ...initializeDesireMetrics(), executionAttemptCount: 1, executionSuccessCount: 1,
    },
    plan: { id: 'plan-1', version: 1, completionCriteria: 'A verified report exists', steps: [{ order: 1 }] },
    execution: { planId: 'plan-1', planVersion: 1, startedAt: '2026-08-25T00:00:30.000Z', status: 'completed',
      stepResults: [{ stepOrder: 1, success: true, result: { artifact: 'report.txt' }, completedAt: '2026-08-25T00:00:40.000Z' }] },
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  } as unknown as Desire
}

function review(overrides: Partial<DesireOutcomeReview> = {}): DesireOutcomeReview {
  return {
    planId: 'plan-1', planVersion: 1, executionStartedAt: '2026-08-25T00:00:30.000Z', completionCriteriaMet: true,
    id: 'review-1', verdict: 'completed', reasoning: 'Evidence supports completion.',
    successScore: 0.9, failureCategory: 'none', isFixableBug: false,
    lessonsLearned: [], reviewedAt: '2026-08-25T00:01:00.000Z', notifyUser: false,
    ...overrides,
  }
}

function dependencies(saved: Desire[]): Partial<DesireOutcomeTransitionDependencies> {
  return {
    loadConfig: async () => structuredClone(DEFAULT_AGENCY_CONFIG),
    addScratchpadEntry: async () => ({ entryCount: 1, lastEntryNumber: 1 }),
    saveReview: async () => undefined,
    saveManifest: async value => { saved.push(structuredClone(value)) },
  }
}

test('canonical outcome transition completes an achievable desire', async () => {
  const saved: Desire[] = []
  const result = await applyDesireOutcomeReview(desire(), review(), 'profile-a', dependencies(saved))
  assert.equal(result.action, 'completed')
  assert.equal(result.desire.status, 'completed')
  assert.equal(result.desire.currentStage, 'complete')
  assert.equal(result.desire.outcomeReview?.id, 'review-1')
  assert.equal(saved.length, 1)
})

test('outcome transition durably appends its audit entry before reporting success', async () => {
  const saved: Desire[] = []
  const entries: Array<{ type: string }> = []
  await applyDesireOutcomeReview(desire(), review(), 'profile-a', {
    ...dependencies(saved),
    addScratchpadEntry: async (_id, entry) => {
      entries.push(entry)
      return { entryCount: 1, lastEntryNumber: 1 }
    },
  })
  assert.deepEqual(entries.map(entry => entry.type), ['outcome_review'])
  assert.equal(saved[0].scratchpad?.entryCount, 1)
})

test('possible system defects enter distinct owner-attention state without creating repair work', async () => {
  const saved: Desire[] = []
  const result = await applyDesireOutcomeReview(
    desire(),
    review({ verdict: 'retry', failureCategory: 'system_error', isFixableBug: true }),
    'profile-a',
    dependencies(saved),
  )
  assert.equal(result.action, 'escalated')
  assert.equal(result.desire.status, 'needs_attention')
  assert.equal(result.desire.currentStage, 'user_attention')
  assert.match(result.summary, /no repair task was created/i)
})

test('retry returns the same desire to planning under the configured limit', async () => {
  const saved: Desire[] = []
  const result = await applyDesireOutcomeReview(
    desire(),
    review({ verdict: 'retry', successScore: 0.2, failureCategory: 'plan_error' }),
    'profile-a',
    dependencies(saved),
  )
  assert.equal(result.action, 'retry')
  assert.equal(result.desire.status, 'planning')
  assert.equal(result.desire.metrics.planRevisionCount, 0, 'revision count advances only after a replacement plan is persisted')
  assert.equal(result.desire.metrics.outcomeRetryCount, 1)
  assert.equal(result.desire.outcomeReview, undefined)
  assert.equal(result.desire.outcomeReviewHistory?.[0]?.id, 'review-1')
})

test('a completed recurring outcome stops until fresh evidence supports another cycle', async () => {
  const saved: Desire[] = []
  const recurring = { ...desire(), goalType: 'recurring' as const }
  const result = await applyDesireOutcomeReview(recurring, review(), 'profile-a', dependencies(saved))
  assert.equal(result.action, 'completed')
  assert.equal(result.desire.status, 'completed')
  assert.equal(result.desire.metrics.completionCount, 1)
})

test('long-running completion requires its explicit criteria', async () => {
  const saved: Desire[] = []
  const longRunning = { ...desire(), goalType: 'long_running' as const }
  const incomplete = await applyDesireOutcomeReview(
    longRunning,
    review({ completionCriteriaMet: false }),
    'profile-a',
    dependencies(saved),
  )
  assert.equal(incomplete.action, 'escalated')
  assert.equal(incomplete.desire.status, 'needs_attention')

  const complete = await applyDesireOutcomeReview(
    longRunning,
    review({ id: 'review-2', completionCriteriaMet: true }),
    'profile-a',
    dependencies(saved),
  )
  assert.equal(complete.action, 'completed')
  assert.equal(complete.desire.status, 'completed')
})

test('one-time completion needs matching attempt evidence even when the reviewer claims success', async () => {
  for (const invalid of [
    review({ completionCriteriaMet: false }),
    review({ completionCriteriaMet: undefined }),
  ]) {
    const result = await applyDesireOutcomeReview(desire(), invalid, 'profile-a', dependencies([]))
    assert.equal(result.desire.status, 'needs_attention')
    assert.equal(result.desire.metrics.completionCount, 0)
  }
  const missing = desire()
  missing.execution!.stepResults = []
  const result = await applyDesireOutcomeReview(missing, review(), 'profile-a', dependencies([]))
  assert.equal(result.desire.status, 'needs_attention')
  await assert.rejects(applyDesireOutcomeReview(desire(), review({ planVersion: 2 }), 'profile-a', dependencies([])), /current plan version/)
})

test('continue consumes the same retry budget and cannot create an endless planning cycle', async () => {
  const exhausted = desire()
  exhausted.metrics.outcomeRetryCount = DEFAULT_AGENCY_CONFIG.execution.maxPlanRetries
  const result = await applyDesireOutcomeReview(exhausted, review({ verdict: 'continue', completionCriteriaMet: false }), 'profile-a', dependencies([]))
  assert.equal(result.desire.status, 'needs_attention')
  assert.match(result.desire.dispositionReason!, /retry limit/i)
  assert.equal(result.desire.plan?.id, exhausted.plan?.id, 'The stopped attempt remains available for inspection')
})

test('repeated completion review does not count the same satisfaction twice', async () => {
  const first = await applyDesireOutcomeReview(desire(), review(), 'profile-a', dependencies([]))
  const repeated = await applyDesireOutcomeReview(first.desire, review(), 'profile-a', dependencies([]))
  assert.equal(repeated.desire.metrics.completionCount, 1)
})
