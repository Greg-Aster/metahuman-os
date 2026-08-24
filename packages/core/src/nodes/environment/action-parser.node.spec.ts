import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentActionParserNode } from './action-parser.node.js';

const observation: EnvironmentObservation = {
  environmentId: 'robot-environment',
  adapter: 'robot-adapter',
  sessionId: 'robot-1',
  timestamp: '2026-08-06T12:00:00.000Z',
  capabilities: {
    actions: ['robotCommand'],
    robotCommands: ['stand'],
    text: true,
    movement: true,
    visual: false,
    map: false,
  },
};

test('an advertised command is admitted only with the strict selector lifecycle contract', async () => {
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'Executing the advertised stand command.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The exact advertised stand command satisfies the request.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
        presentation: 'private',
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.type, 'robotCommand');
  assert.equal(result.actions[0]?.command, 'stand');
  assert.equal(result.actionAdmission?.admitted, true);
  assert.equal(result.taskDecision?.outcome, 'act');
  assert.equal(result.taskDecision?.objectiveComplete, false);
  assert.equal(result.taskDecision?.continuationPolicy, 'none');
  assert.equal(result.taskDecision?.requiredCompletionBasis, 'action_result');

  const malformed = await environmentActionParserNode.execute({
    response: 'status=complete',
    observation,
    sessionId: observation.sessionId,
  }, {}, {});
  assert.deepEqual(malformed.actions, []);
  assert.equal(malformed.taskDecision, null);
  assert.match(malformed.taskDecisionError, /strict JSON/i);
});

test('autonomous selector output must author an objective', async () => {
  const autonomousObservation: EnvironmentObservation = {
    ...observation,
    metadata: {
      correlationId: 'autonomy-objective',
      robotObserver: {
        cycleId: 'autonomy-objective',
        step: 1,
        maxSteps: 8,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-movement',
      },
    },
  };
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will stand.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Standing is the selected consequence.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
        presentation: 'private',
      },
    }),
    observation: autonomousObservation,
    sessionId: autonomousObservation.sessionId,
  }, {}, {});

  assert.deepEqual(result.actions, []);
  assert.match(result.taskDecisionError, /objective must be a non-empty string/i);
});

test('the repaired 9B selector contract preserves capture and bounded visual lifecycle decisions', async () => {
  const visualObservation: EnvironmentObservation = {
    ...observation,
    capabilities: {
      ...observation.capabilities,
      actions: ['robotCommand', 'captureImage'],
      robotCommands: ['wave'],
      visual: true,
    },
  };
  const capture = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need a fresh image to answer from current visual evidence.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'No image content is attached.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
        presentation: 'private',
        visualEvidenceMode: 'single',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {});
  assert.equal(capture.actions[0]?.type, 'captureImage');
  assert.equal(capture.taskDecision?.continuationPolicy, 'bounded');
  assert.equal(capture.taskDecision?.requiredCompletionBasis, 'visual_observation');

  const boundedWave = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will wave and inspect each correlated camera result.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The visual stopping condition is not yet satisfied.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'information_gain',
        presentation: 'private',
        visualEvidenceMode: 'single',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {});
  assert.equal(boundedWave.actions[0]?.command, 'wave');
  assert.equal(boundedWave.taskDecision?.outcome, 'act');
  assert.equal(boundedWave.taskDecision?.objectiveComplete, false);
  assert.equal(boundedWave.taskDecision?.continuationPolicy, 'bounded');
  assert.equal(boundedWave.taskDecision?.requiredCompletionBasis, 'visual_observation');
});

test('autonomy presentation leaves the parser without a second response-routing node', async () => {
  const privateReflection = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The quiet room makes me think of the slow afternoon light.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'A private reflection is the meaningful consequence for this pass.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        completionBasis: 'response',
        completionEvidence: 'The private reflection itself is the consequence.',
        actionPurpose: 'expression',
        presentation: 'private',
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(privateReflection.presentation, 'private');
  assert.equal(privateReflection.privateResponse, privateReflection.response);

  const spoken = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'That patch of light looks especially warm today.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        outcome: 'report',
        reason: 'This observation is worth sharing outwardly.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        actionPurpose: 'expression',
        presentation: 'conversation',
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(spoken.presentation, 'conversation');
  assert.equal(spoken.privateResponse, '');
});
