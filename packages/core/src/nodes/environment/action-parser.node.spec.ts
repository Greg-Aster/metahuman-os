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

const selectorOutputs = [
  {
    actions: [{ type: 'robotCommand', command: 'stand' }],
    movementRequest: null,
    taskDecision: { outcome: 'act', objectiveComplete: false },
  },
  {
    actions: [{ type: 'robotCommand', command: 'stand' }],
    movementRequest: null,
    taskDecision: null,
  },
  {
    response: 'Executing the advertised stand command.',
    actions: [{ type: 'robotCommand', command: 'stand' }],
    movementRequest: null,
    taskDecision: {
      outcome: 'act',
      reason: 'The exact advertised stand command satisfies the request.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body-controlled',
    },
  },
];

test('an advertised command is admitted independently of selector lifecycle metadata', async () => {
  for (const output of selectorOutputs) {
    const result = await environmentActionParserNode.execute({
      response: JSON.stringify(output),
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
  }
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
