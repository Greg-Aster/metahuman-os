import assert from 'node:assert/strict'
import test from 'node:test'

import { initializeDesireMetrics, type Desire } from '../../agency/index.js'
import type { RouterCallOptions } from '../../model-router.js'
import {
  executeDesireCheckinEvaluator,
  parseDesireCheckinEvaluation,
} from './desire-checkin-evaluator.node.js'

function desire(): Desire {
  return {
    id: 'desire-1',
    title: 'Finish the field test',
    description: 'Complete the current physical field-test milestone',
    reason: 'Validate the project',
    source: 'reflection',
    status: 'executing',
    goalType: 'long_running',
    strength: 0.8,
    baseWeight: 1,
    threshold: 0.7,
    decayRate: 0.03,
    lastReviewedAt: '2026-09-03T00:00:00.000Z',
    reinforcements: 1,
    runCount: 1,
    risk: 'low',
    requiredTrustLevel: 'suggest',
    metrics: initializeDesireMetrics(),
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  }
}

test('check-in evaluator consumes graph inputs and returns a typed decision', async () => {
  let request: RouterCallOptions | undefined
  const output = await executeDesireCheckinEvaluator(
    { desire: desire(), memories: [{ content: 'Field test passed.' }] },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async input => {
        request = input
        return JSON.stringify({
          statusAssessment: 'The field test has evidence of completion.',
          questionsForUser: [],
          currentMilestoneComplete: true,
          suggestedNextActions: ['Record the result'],
          recommendation: 'advance_milestone',
          recommendationReason: 'The supplied memory confirms completion.',
        })
      },
    },
  )

  assert.equal(output.recommendation, 'advance_milestone')
  assert.equal((output.evaluation as { currentMilestoneComplete: boolean }).currentMilestoneComplete, true)
  assert.equal(request?.userId, 'account-a')
  assert.match(String(request?.messages[1]?.content), /Field test passed/)
})

test('check-in evaluator rejects malformed model output instead of fabricating continuation', () => {
  assert.throws(
    () => parseDesireCheckinEvaluation('unstructured response'),
    /did not contain a JSON object/,
  )
  assert.throws(
    () => parseDesireCheckinEvaluation('{"statusAssessment":"Maybe"}'),
    /missing required typed fields/,
  )
})
