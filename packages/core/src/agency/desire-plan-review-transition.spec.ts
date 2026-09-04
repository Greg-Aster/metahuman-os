import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyDesirePlanReview,
  recordDesirePlanReview,
  type DesirePlanReviewRecorderDependencies,
  type DesirePlanReviewTransitionDependencies,
} from './desire-plan-review-transition.js'
import {
  initializeDesireMetrics,
  initializeScratchpadSummary,
  type Desire,
  type DesireReview,
  type DesireScratchpadEntry,
} from './types.js'

function desire(): Desire {
  return {
    id: 'desire-1',
    title: 'Review the plan',
    description: 'Exercise the plan-review owner',
    reason: 'Contract test',
    source: 'reflection',
    status: 'reviewing',
    currentStage: 'plan_review',
    strength: 0.8,
    baseWeight: 1,
    threshold: 0.7,
    decayRate: 0.03,
    lastReviewedAt: '2026-09-02T00:00:00.000Z',
    reinforcements: 1,
    runCount: 1,
    risk: 'low',
    requiredTrustLevel: 'suggest',
    metrics: initializeDesireMetrics(),
    plan: {
      id: 'plan-1',
      version: 1,
      steps: [{
        order: 1,
        action: 'Inspect the owner',
        expectedOutcome: 'Owner verified',
        risk: 'low',
        requiresApproval: false,
      }],
      estimatedRisk: 'low',
      requiredSkills: [],
      requiredTrustLevel: 'suggest',
      operatorGoal: 'Verify one canonical owner',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

function review(verdict: DesireReview['verdict'] = 'approve'): DesireReview {
  return {
    id: 'review-desire-1-v1',
    verdict,
    reasoning: 'The plan is aligned and safe.',
    concerns: [],
    riskAssessment: 'Low risk',
    alignmentScore: 0.95,
    reviewedAt: '2026-09-02T00:01:00.000Z',
    planId: 'plan-1',
    planVersion: 1,
    autoApprove: verdict === 'approve',
    autoApproveReason: verdict === 'approve' ? 'Policy permits it' : 'Review requires intervention',
  }
}

function dependencies(
  saved: Desire[],
  entries: DesireScratchpadEntry[] = [],
): Partial<DesirePlanReviewTransitionDependencies> {
  return {
    now: () => '2026-09-02T00:02:00.000Z',
    addScratchpadEntry: async (_id, entry) => {
      entries.push(entry)
      return {
        ...initializeScratchpadSummary(),
        entryCount: 1,
        lastEntryNumber: 1,
        lastEntryAt: entry.timestamp,
        lastEntryType: entry.type,
      }
    },
    saveManifest: async value => { saved.push(structuredClone(value)) },
  }
}

test('approved review auto-approves only when policy explicitly allows it', async () => {
  const saved: Desire[] = []
  const result = await applyDesirePlanReview(desire(), review(), true, 'profile-a', dependencies(saved))
  assert.equal(result.action, 'auto_approved')
  assert.equal(result.desire.status, 'approved')
  assert.equal(result.desire.currentStage, 'executing')
  assert.equal(result.desire.review?.id, 'review-desire-1-v1')
  assert.equal(result.desire.scratchpad?.entryCount, 1)
  assert.equal(saved.length, 1)
})

test('non-auto-approved and revision reviews use the manifest approval state without a second queue', async () => {
  const saved: Desire[] = []
  const manualReview = { ...review('revise'), autoApprove: false }
  const result = await applyDesirePlanReview(desire(), manualReview, false, 'profile-a', dependencies(saved))
  assert.equal(result.action, 'awaiting_approval')
  assert.equal(result.desire.status, 'awaiting_approval')
  assert.equal(result.desire.currentStage, 'user_approval')
})

test('rejected review is terminal and records retryable review history', async () => {
  const saved: Desire[] = []
  const rejectedReview = { ...review('reject'), autoApprove: false }
  const result = await applyDesirePlanReview(desire(), rejectedReview, false, 'profile-a', dependencies(saved))
  assert.equal(result.action, 'rejected')
  assert.equal(result.desire.status, 'rejected')
  assert.equal(result.desire.completedAt, '2026-09-02T00:02:00.000Z')
  assert.equal(result.desire.rejectionHistory?.[0]?.rejectedBy, 'review')
})

test('persistence failures fail the transition instead of reporting success', async () => {
  await assert.rejects(
    applyDesirePlanReview(desire(), review(), true, 'profile-a', {
      addScratchpadEntry: async () => initializeScratchpadSummary(),
      saveManifest: async () => { throw new Error('manifest unavailable') },
    }),
    /manifest unavailable/,
  )
})

test('plan-version review recording persists once and reuses the exact receipt on retry', async () => {
  let stored: DesireReview | null = null
  let writes = 0
  const recorderDependencies: Partial<DesirePlanReviewRecorderDependencies> = {
    loadReview: async () => stored,
    saveReview: async (_id, value) => {
      writes += 1
      stored = structuredClone(value as DesireReview)
    },
  }

  const first = await recordDesirePlanReview(desire(), review(), true, 'profile-a', recorderDependencies)
  const changedRetry = {
    ...review('reject'),
    reasoning: 'A changed model response that must not replace the durable receipt.',
    autoApprove: false,
  }
  const second = await recordDesirePlanReview(desire(), changedRetry, false, 'profile-a', recorderDependencies)

  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(second.review.verdict, 'approve')
  assert.equal(second.reasoning, 'The plan is aligned and safe.')
  assert.equal(second.autoApprove, true)
  assert.equal(writes, 1)
})

test('review recording rejects receipts for a different persisted plan version', async () => {
  await assert.rejects(
    recordDesirePlanReview(
      desire(),
      { ...review(), planVersion: 2 },
      true,
      'profile-a',
      { loadReview: async () => null, saveReview: async () => undefined },
    ),
    /does not match the persisted plan version/,
  )
})

test('review recording exposes durable-storage failure and does not fabricate a receipt', async () => {
  await assert.rejects(
    recordDesirePlanReview(desire(), review(), true, 'profile-a', {
      loadReview: async () => null,
      saveReview: async () => { throw new Error('review storage unavailable') },
    }),
    /review storage unavailable/,
  )
})
