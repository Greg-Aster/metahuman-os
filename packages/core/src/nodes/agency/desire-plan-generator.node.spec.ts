import assert from 'node:assert/strict'
import test from 'node:test'

import {
  latestDesirePlan,
  nextDesirePlanVersion,
} from './desire-plan-generator.node.js'
import type { Desire, DesirePlan } from '../../agency/types.js'

function plan(id: string, version: number): DesirePlan {
  return {
    id,
    version,
    steps: [{
      order: 1,
      action: 'Test the plan',
      expectedOutcome: 'The plan is tested',
      risk: 'low',
      requiresApproval: false,
    }],
    estimatedRisk: 'low',
    requiredSkills: [],
    requiredTrustLevel: 'suggest',
    operatorGoal: 'Test revision history',
    createdAt: '2026-09-04T00:00:00.000Z',
  }
}

test('archived plan history remains the revision context and advances its version', () => {
  const previous = plan('plan-3', 3)
  const desire = {
    id: 'desire-1',
    userCritique: 'Try a different approach',
    planHistory: [plan('plan-1', 1), previous],
  } as Desire
  assert.equal(latestDesirePlan(desire), previous)
  assert.equal(nextDesirePlanVersion(desire), 4)
})

test('versioning uses the highest persisted version rather than array length', () => {
  const desire = {
    id: 'desire-1',
    plan: plan('plan-5', 5),
    planHistory: [plan('plan-2', 2)],
  } as Desire
  assert.equal(nextDesirePlanVersion(desire), 6)
})
