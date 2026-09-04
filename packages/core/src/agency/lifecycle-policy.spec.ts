import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canOwnerAdvanceDesire,
  canOwnerResetDesireTo,
  validateDesireForUserApproval,
} from './lifecycle-policy.js'
import { initializeDesireMetrics, type Desire } from './types.js'

function approvalCandidate(status: Desire['status'] = 'awaiting_approval'): Desire {
  return {
    id: 'desire-1',
    title: 'Approve safely',
    description: 'Exercise lifecycle policy',
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
      id: 'plan-1',
      version: 2,
      steps: [{
        order: 1,
        action: 'Act',
        expectedOutcome: 'Done',
        risk: 'low',
        requiresApproval: true,
      }],
      estimatedRisk: 'low',
      requiredSkills: [],
      requiredTrustLevel: 'suggest',
      operatorGoal: 'Complete the action',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
    review: {
      id: 'review-desire-1-v2',
      verdict: 'approve',
      reasoning: 'Safe with user approval.',
      riskAssessment: 'Low risk',
      alignmentScore: 0.9,
      reviewedAt: '2026-09-02T00:01:00.000Z',
      planId: 'plan-1',
      planVersion: 2,
      autoApprove: false,
      autoApproveReason: 'Explicit approval required',
    },
  }
}

test('generic owner advancement cannot bypass planning, review, approval, or execution owners', () => {
  assert.equal(canOwnerAdvanceDesire('planning', 'reviewing'), false)
  assert.equal(canOwnerAdvanceDesire('reviewing', 'approved'), false)
  assert.equal(canOwnerAdvanceDesire('approved', 'executing'), false)
  assert.equal(canOwnerAdvanceDesire('nascent', 'planning'), true)
  assert.equal(canOwnerAdvanceDesire('awaiting_approval', 'planning'), true)
  assert.equal(canOwnerResetDesireTo('planning'), true)
  assert.equal(canOwnerResetDesireTo('reviewing'), false)
  assert.equal(canOwnerResetDesireTo('approved'), false)
})

test('user approval requires the canonical awaiting state and exact plan-version review', () => {
  assert.equal(validateDesireForUserApproval(approvalCandidate()), null)
  assert.match(validateDesireForUserApproval(approvalCandidate('reviewing')) || '', /must first produce/)
  const stale = approvalCandidate()
  stale.review!.planVersion = 1
  assert.match(validateDesireForUserApproval(stale) || '', /does not match/)
})
