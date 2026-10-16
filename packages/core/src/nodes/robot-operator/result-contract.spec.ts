import assert from 'node:assert/strict'
import test from 'node:test'
import { NodeInputValidationError } from '../types.js'
import { withVisualObservationSchema } from '../../visual-observation.js'
import {
  buildRobotGoalReviewJsonSchema,
  robotGoalReviewParserNode,
} from './goal-review-parser.node.js'
import {
  buildRobotAutonomyControllerJsonSchema,
  robotAutonomyControllerParserNode,
} from './autonomy-controller-parser.node.js'

const ROBOT_GOAL_REVIEW_JSON_SCHEMA = buildRobotGoalReviewJsonSchema()

test('Goal Review does not expose conversation delivery as a goal completion basis', async () => {
  for (const branch of ROBOT_GOAL_REVIEW_JSON_SCHEMA.anyOf) {
    assert.deepEqual(branch.properties.requiredCompletionBasis.enum,
      ['action_result', 'visual_observation', 'environment_state', 'user_input'])
  }
  await assert.rejects(robotGoalReviewParserNode.execute({ response: JSON.stringify({
    outcome: 'complete', reason: 'Delivery alone.', objective: 'Find the cat.', completionCriteria: 'Identify the cat in visual evidence.', requiredCompletionBasis: 'response',
    observationSummary: 'An answer was delivered.', completionEvidence: 'A buffer entry exists.' }),
    execution: { task: { objective: 'Answer the question.' } } }, {}, {}), /completion basis is not supported/)
})

test('confirmation review reports only the existing objective and has no activity selection', async () => {
  for (const branch of ROBOT_GOAL_REVIEW_JSON_SCHEMA.anyOf) {
    assert.equal('taskId' in branch.properties, false)
    assert.equal('instruction' in branch.properties, false)
    assert.equal('response' in branch.properties, false)
    assert.equal(branch.additionalProperties, false)
    assert.deepEqual(branch.required.slice().sort(), Object.keys(branch.properties).sort())
    assert.equal(branch.properties.completionEvidence.minLength,
      branch.properties.outcome.enum.includes('complete') ? 1 : undefined)
  }
  for (const outcome of ['complete', 'wait', 'request_user', 'abandon']) {
    const output = { outcome, reason: 'Recorded assessment.',
      objective: 'Find the cat.', completionCriteria: 'Identify the cat in visual evidence.', requiredCompletionBasis: 'visual_observation', observationSummary: 'Recorded frame.',
      completionEvidence: outcome === 'complete' ? 'The requested target is visible in frame 7.' : '' }
    const result = await robotGoalReviewParserNode.execute({ response: JSON.stringify(output),
      execution: { task: { objective: 'Find the cat.' } } }, {}, {})
    assert.equal(result.taskDecision.objective, 'Find the cat.')
    assert.equal(result.taskDecision.objectiveComplete, outcome === 'complete')
    assert.equal('awaitContinuation' in result, false)
    assert.equal('invocation' in result, false)
    assert.equal('response' in result, false)
    assert.deepEqual(result.assessment, output)
    assert.equal('agentDecision' in result, false)
    assert.equal('executorDecision' in result, false)
    await assert.rejects(robotGoalReviewParserNode.execute({
      response: JSON.stringify({ ...output, taskId: 'boredom-reflection', instruction: 'Start another activity.' }),
      execution: { task: { objective: 'Find the cat.' } } }, {}, {}), /unexpected or missing fields/)
  }
  await assert.rejects(robotGoalReviewParserNode.execute({ response: JSON.stringify({
    outcome: 'complete', reason: 'Unsupported claim.', objective: 'Find the cat.', completionCriteria: 'Identify the cat in visual evidence.', requiredCompletionBasis: 'visual_observation',
    observationSummary: 'No frame.', completionEvidence: '' }),
    execution: { task: { objective: 'Find the cat.' } } }, {}, {}), /requires supplied completion evidence/)
})

test('Goal Review no longer offers or accepts a continue assessment', async () => {
  for (const branch of ROBOT_GOAL_REVIEW_JSON_SCHEMA.anyOf) {
    assert.equal(branch.properties.outcome.enum.includes('continue'), false)
  }
  await assert.rejects(robotGoalReviewParserNode.execute({
    response: JSON.stringify({ outcome: 'continue', reason: 'The objective remains unfinished.',
      objective: 'Find the cat.', completionCriteria: 'Identify the cat in visual evidence.', requiredCompletionBasis: 'visual_observation', observationSummary: 'A dated observation.', completionEvidence: '' }),
    execution: { task: { objective: 'Original objective' } },
  }, {}, {}), /outcome is not supported/)
})

test('Active Operator schema exposes the approved activation update contract', () => {
  const schema = buildRobotAutonomyControllerJsonSchema([{ id: 'daydreamer' }])
  assert.deepEqual(schema.required, ['updates'])
  assert.deepEqual(schema.properties.updates.items.properties.operationId.enum, ['daydreamer'])
  assert.deepEqual(schema.properties.updates.items.required, ['operationId', 'activation', 'reason', 'instruction'])
  assert.equal('response' in schema.properties, false)
})
