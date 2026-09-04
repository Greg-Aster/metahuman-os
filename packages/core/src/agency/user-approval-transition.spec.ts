import assert from 'node:assert/strict'
import test from 'node:test'

import {
  initializeDesireMetrics,
  initializeScratchpadSummary,
  type Desire,
  type DesireScratchpadEntry,
} from './types.js'
import { approveDesireForExecution } from './user-approval-transition.js'

function candidate(status: Desire['status'] = 'awaiting_approval'): Desire {
  return {
    id: 'desire-approval',
    title: 'Approve canonical plan',
    description: 'Test approval transition',
    reason: 'Contract test',
    metrics: initializeDesireMetrics(),
    source: 'reflection',
    status,
    strength: 0.8,
    baseWeight: 1,
    threshold: 0.7,
    decayRate: 0.03,
    lastReviewedAt: '2026-09-02T00:00:00.000Z',
    reinforcements: 1,
    runCount: 1,
    risk: 'low',
    requiredTrustLevel: 'suggest',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    plan: {
      id: 'plan-approval',
      version: 3,
      steps: [{
        order: 1,
        action: 'Perform approved step',
        expectedOutcome: 'Done',
        risk: 'low',
        requiresApproval: true,
      }],
      estimatedRisk: 'low',
      requiredSkills: [],
      requiredTrustLevel: 'suggest',
      operatorGoal: 'Complete approved work',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
    review: {
      id: 'review-desire-approval-v3',
      verdict: 'approve',
      reasoning: 'Safe after explicit approval.',
      riskAssessment: 'Low risk',
      alignmentScore: 0.9,
      reviewedAt: '2026-09-02T00:01:00.000Z',
      planId: 'plan-approval',
      planVersion: 3,
      autoApprove: false,
      autoApproveReason: 'Explicit approval required',
    },
  }
}

test('user approval writes one idempotent audit entry and advances the reviewed plan', async () => {
  const entries: DesireScratchpadEntry[] = []
  const saved: Desire[] = []
  const result = await approveDesireForExecution(candidate(), 'profile-a', {
    now: () => '2026-09-02T00:02:00.000Z',
    addScratchpadEntry: async (_id, entry) => {
      entries.push(entry)
      return { ...initializeScratchpadSummary(), entryCount: 1, lastEntryNumber: 1 }
    },
    saveManifest: async desire => { saved.push(structuredClone(desire)) },
  })

  assert.equal(result.status, 'approved')
  assert.equal(result.currentStage, 'executing')
  assert.equal(result.metrics?.userApprovalCount, 1)
  assert.equal(result.stageIterations?.userApproval, 1)
  assert.equal(entries[0]?.type, 'approved')
  assert.equal((entries[0]?.data as Record<string, unknown>).idempotencyKey, 'desire-plan-approval:desire-approval:v3')
  assert.equal(saved.length, 1)
})

test('user approval cannot bypass the reviewer state or approve a stale review', async () => {
  await assert.rejects(
    approveDesireForExecution(candidate('reviewing'), 'profile-a'),
    /must first produce 'awaiting_approval'/,
  )
  const stale = candidate()
  stale.review!.planVersion = 2
  await assert.rejects(
    approveDesireForExecution(stale, 'profile-a'),
    /does not match the current plan version/,
  )
})
