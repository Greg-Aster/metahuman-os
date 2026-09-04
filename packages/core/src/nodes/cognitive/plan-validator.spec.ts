import assert from 'node:assert/strict'
import test from 'node:test'

import type { DesirePlan } from '../../agency/types.js'
import { PlanValidatorNode } from './plan-validator.node.js'

function validPlan(): DesirePlan {
  return {
    id: 'plan-1',
    version: 1,
    steps: [{
      order: 1,
      action: 'Inspect the canonical owner',
      expectedOutcome: 'The owner is identified',
      risk: 'low',
      requiresApproval: false,
    }],
    estimatedRisk: 'low',
    requiredSkills: [],
    requiredTrustLevel: 'suggest',
    operatorGoal: 'Identify the canonical owner',
    createdAt: '2026-09-02T00:00:00.000Z',
  }
}

const structuralOnly = { checkSkillAvailability: false, checkTrustLevel: false }

test('plan validator accepts a complete bounded one-time plan', async () => {
  const result = await PlanValidatorNode.execute({
    plan: validPlan(),
    goalType: 'one_time',
  }, {}, structuralOnly)
  assert.equal(result.valid, true)
  assert.equal(result.stepCount, 1)
})

test('plan validator rejects malformed steps and unsupported goal metadata', async () => {
  const malformed = validPlan()
  malformed.steps = [
    { ...malformed.steps[0], order: 1, action: '' },
    { ...malformed.steps[0], order: 1, risk: 'unsafe' as any },
  ]
  const result = await PlanValidatorNode.execute({
    plan: malformed,
    goalType: 'unknown',
  }, {}, structuralOnly)
  assert.equal(result.valid, false)
  assert.match((result.errors as string[]).join('\n'), /missing an action/)
  assert.match((result.errors as string[]).join('\n'), /duplicate order/)
  assert.match((result.errors as string[]).join('\n'), /unsupported risk/)
  assert.match((result.errors as string[]).join('\n'), /unsupported goal type/)
})

test('long-running plans require consistent milestones and progress', async () => {
  const result = await PlanValidatorNode.execute({
    plan: validPlan(),
    goalType: 'long_running',
    completionCriteria: 'All milestones are complete',
    milestones: [{ id: '', order: 0, title: '', status: 'pending' }],
    goalProgress: {
      currentMilestone: 0,
      totalMilestones: 2,
      completedMilestones: 0,
      progressPercent: 0,
    },
  }, {}, structuralOnly)
  assert.equal(result.valid, false)
  assert.match((result.errors as string[]).join('\n'), /requires an id and title/)
  assert.match((result.errors as string[]).join('\n'), /invalid or duplicate order/)
  assert.match((result.errors as string[]).join('\n'), /consistent initialized goal progress/)
})

test('plan validator rejects understated aggregate risk and missing approval decisions', async () => {
  const understated = validPlan()
  understated.steps = [{
    ...understated.steps[0],
    risk: 'high',
    requiresApproval: undefined as unknown as boolean,
  }]
  const result = await PlanValidatorNode.execute({ plan: understated }, {}, structuralOnly)
  assert.equal(result.valid, false)
  const errors = (result.errors as string[]).join('\n')
  assert.match(errors, /requires an explicit requiresApproval decision/)
  assert.match(errors, /estimated risk 'low' is lower than highest step risk 'high'/)
})
