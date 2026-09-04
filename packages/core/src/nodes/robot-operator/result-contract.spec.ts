import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROBOT_ACTION_RESULT_JSON_SCHEMA,
  robotActionResultParserNode,
} from './action-result-parser.node.js'
import {
  ROBOT_GOAL_REVIEW_JSON_SCHEMA,
  robotGoalReviewParserNode,
} from './goal-review-parser.node.js'

test('robot result schemas encode the same outcome relationships enforced by their parsers', async () => {
  const actionBranches = (ROBOT_ACTION_RESULT_JSON_SCHEMA.allOf[0] as any).anyOf
  assert.deepEqual(actionBranches[0].properties.outcome.enum, ['complete'])
  assert.deepEqual(actionBranches[0].properties.objectiveComplete.enum, [true])
  assert.deepEqual(actionBranches[0].properties.continuationPolicy.enum, ['none'])
  assert.deepEqual(actionBranches[1].properties.outcome.enum, ['incomplete', 'failed', 'wait'])
  assert.deepEqual(actionBranches[1].properties.objectiveComplete.enum, [false])

  const goalBranches = (ROBOT_GOAL_REVIEW_JSON_SCHEMA.allOf[0] as any).anyOf
  assert.deepEqual(goalBranches[0].properties.outcome.enum, ['continue'])
  assert.deepEqual(goalBranches[0].properties.objectiveComplete.enum, [false])
  assert.equal(goalBranches[0].properties.nextInstruction.minLength, 1)
  assert.deepEqual(goalBranches[1].properties.outcome.enum, ['complete'])
  assert.deepEqual(goalBranches[1].properties.objectiveComplete.enum, [true])
  assert.deepEqual(goalBranches[1].properties.continuationPolicy.enum, ['none'])
  assert.equal(goalBranches[1].properties.nextInstruction.maxLength, 0)
  assert.deepEqual(goalBranches[2].properties.outcome.enum, ['wait', 'request_user'])
  assert.deepEqual(goalBranches[2].properties.objectiveComplete.enum, [false])
  assert.equal(goalBranches[2].properties.nextInstruction.maxLength, 0)

  const actionResult = await robotActionResultParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'incomplete',
      reason: 'The action finished, but the objective still needs visual evidence.',
      objective: 'Find the cat.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The current view does not contain a cat.',
      completionEvidence: '',
    }),
  }, {}, {})
  assert.equal(actionResult.taskDecision.objectiveComplete, false)

  const goalReview = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'continue',
      reason: 'Another viewpoint is useful.',
      objective: 'Find the cat.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'No cat is visible from the current viewpoint.',
      completionEvidence: '',
      nextInstruction: 'Inspect a different part of the room for the cat.',
    }),
  }, {}, {})
  assert.equal(goalReview.decision?.instruction, 'Inspect a different part of the room for the cat.')
})
