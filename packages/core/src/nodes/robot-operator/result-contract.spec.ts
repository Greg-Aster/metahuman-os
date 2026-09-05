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
import {
  buildRobotAutonomyControllerJsonSchema,
  robotAutonomyControllerParserNode,
} from './autonomy-controller-parser.node.js'

test('robot result parsers derive completion and expose instructions only for continuation', async () => {
  assert.equal('allOf' in ROBOT_ACTION_RESULT_JSON_SCHEMA, false)
  assert.equal('objectiveComplete' in ROBOT_ACTION_RESULT_JSON_SCHEMA.properties.taskDecision, false)
  assert.equal('continuationPolicy' in ROBOT_ACTION_RESULT_JSON_SCHEMA.properties.taskDecision, false)
  assert.equal('allOf' in ROBOT_GOAL_REVIEW_JSON_SCHEMA, false)
  assert.equal('objectiveComplete' in ROBOT_GOAL_REVIEW_JSON_SCHEMA.properties, false)
  assert.equal('continuationPolicy' in ROBOT_GOAL_REVIEW_JSON_SCHEMA.properties, false)

  const actionResult = await robotActionResultParserNode.execute({
    response: JSON.stringify({
      response: '',
      taskDecision: {
        overallObjectiveState: 'not_achieved',
        reason: 'The action finished, but the objective still needs visual evidence.',
        objective: 'Find the cat.',
        requiredCompletionBasis: 'visual_observation',
        observationSummary: 'The current view does not contain a cat.',
        completionEvidence: '',
      },
    }),
  }, {}, {})
  assert.equal(actionResult.taskDecision.objectiveComplete, false)

  const completedAction = await robotActionResultParserNode.execute({
    response: JSON.stringify({
      response: '',
      taskDecision: {
        overallObjectiveState: 'achieved',
        reason: 'The objective is established by the returned evidence.',
        objective: 'Stand up.',
        requiredCompletionBasis: 'action_result',
        observationSummary: 'The stand action completed.',
        completionEvidence: 'The matched terminal report recorded successful execution.',
      },
    }),
  }, {}, {})
  assert.equal(completedAction.taskDecision.objectiveComplete, true)

  const standaloneAction = await robotActionResultParserNode.execute({
    response: JSON.stringify({
      response: '',
      taskDecision: null,
    }),
  }, {}, {})
  assert.equal(standaloneAction.taskDecision, null)

  const goalReview = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'continue',
      reason: 'Another viewpoint is useful.',
      objective: 'Find the cat.',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'No cat is visible from the current viewpoint.',
      completionEvidence: '',
      nextInstruction: 'Inspect a different part of the room for the cat.',
    }),
  }, {}, {})
  assert.equal(goalReview.executorDecision?.instruction, 'Inspect a different part of the room for the cat.')

  const waitingReview = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'wait',
      reason: 'The current condition does not support another attempt yet.',
      objective: 'Find the cat.',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The current view is too dark to establish the cat location.',
      completionEvidence: '',
      nextInstruction: 'This unused text must not become an action.',
    }),
  }, {}, {})
  assert.equal(waitingReview.executorDecision, null)
  assert.equal('nextInstruction' in waitingReview.taskDecision, false)

  const abandonedReview = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: 'I cannot make useful progress on this objective with the evidence available.',
      outcome: 'abandon',
      reason: 'Repeated attempts produced no new evidence and no useful next step remains.',
      objective: 'Find the cat.',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'Recent views have not established the cat location.',
      completionEvidence: '',
      nextInstruction: '',
    }),
  }, {}, {})
  assert.equal(abandonedReview.taskDecision.objectiveComplete, false)
  assert.equal(abandonedReview.taskDecision.outcome, 'abandon')
  assert.equal(abandonedReview.executorDecision, null)
})

test('Robot Autonomy Controller exposes one contextual task choice from its supplied catalog', async () => {
  const availableTasks = [{
    id: 'robot-autonomy-executor',
    name: 'Robot Autonomy Executor',
    description: 'Executes one high-level embodied intention.',
    kind: 'environment-executor',
    handler: 'environment.observation',
    taskType: 'environment_observation',
    priority: 'low',
    tags: ['robot'],
  }]
  assert.deepEqual(
    buildRobotAutonomyControllerJsonSchema(availableTasks).properties.taskId.enum,
    ['robot-autonomy-executor', 'none'],
  )

  const executor = await robotAutonomyControllerParserNode.execute({
    response: JSON.stringify({
      response: 'I want to investigate the open doorway.',
      taskId: 'robot-autonomy-executor',
      reason: 'The current context supports a direct embodied intention.',
      observationSummary: 'An open doorway is recorded in the current environment facts.',
      instruction: 'Investigate the open doorway in a way appropriate to my current capabilities.',
    }),
    availableTasks,
  }, {}, {})
  assert.equal(executor.taskDecision, null)
  assert.equal(executor.executorDecision.instruction, 'Investigate the open doorway in a way appropriate to my current capabilities.')

  await assert.rejects(
    robotAutonomyControllerParserNode.execute({
      response: JSON.stringify({
        response: '',
        taskId: 'robot-autonomy-executor',
        reason: 'A direct intention was selected.',
        observationSummary: 'Current context is available.',
        instruction: '',
      }),
      availableTasks,
    }, {}, {}),
    /requires one high-level instruction/,
  )

  await assert.rejects(
    robotAutonomyControllerParserNode.execute({
      response: JSON.stringify({
        response: '',
        taskId: 'daydreamer',
        reason: 'A daydream might be useful.',
        observationSummary: 'The system is idle.',
        instruction: '',
      }),
      availableTasks,
    }, {}, {}),
    /outside its available catalog/,
  )
})
