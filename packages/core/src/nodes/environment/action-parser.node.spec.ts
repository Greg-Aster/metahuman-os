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

test('an advertised standalone command is admitted without creating a durable task', async () => {
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'Executing the advertised stand command.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0]?.type, 'robotCommand');
  assert.equal(result.actions[0]?.command, 'stand');
  assert.equal(result.actionAdmission?.admitted, true);
  assert.equal(result.taskDecision, null);

  const malformed = await environmentActionParserNode.execute({
    response: 'status=complete',
    observation,
    sessionId: observation.sessionId,
  }, {}, {});
  assert.deepEqual(malformed.actions, []);
  assert.equal(malformed.taskDecision, null);
  assert.match(malformed.taskDecisionError, /strict JSON/i);
});

test('an empty selector result is rejected while a conversational result remains valid', async () => {
  const empty = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: '',
      actions: [],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(empty.hasResponse, false);
  assert.deepEqual(empty.actions, []);
  assert.equal(empty.taskDecision, null);
  assert.match(
    empty.taskDecisionError,
    /must include a non-empty response, action, movementRequest, or taskDecision/i,
  );

  const conversation = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I am here with you.',
      actions: [],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(conversation.hasResponse, true);
  assert.equal(conversation.response, 'I am here with you.');
  assert.equal(conversation.taskDecisionError, '');
});

test('punctuation-only advertised commands are admitted unchanged', async () => {
  const punctuationObservation: EnvironmentObservation = {
    ...observation,
    capabilities: {
      ...observation.capabilities,
      robotCommands: ['#1', '#2'],
    },
  };

  for (const command of punctuationObservation.capabilities.robotCommands ?? []) {
    const result = await environmentActionParserNode.execute({
      response: JSON.stringify({
        response: `Executing the advertised ${command} command.`,
        actions: [{ type: 'robotCommand', command }],
        movementRequest: null,
        taskDecision: null,
      }),
      observation: punctuationObservation,
      sessionId: punctuationObservation.sessionId,
    }, {}, {});

    assert.equal(result.actions[0]?.command, command);
    assert.equal(result.actionAdmission?.admitted, true);
  }
});

test('the parser rejects physical work that contradicts the LLM decision contract', async () => {
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I am standing now.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Stand upright.',
        outcome: 'complete',
        reason: 'Standing is the selected consequence.',
        objectiveComplete: true,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.deepEqual(result.actions, []);
  assert.equal(result.taskDecision, null);
  assert.match(result.taskDecisionError, /physical work requires taskDecision outcome=act/i);
});

test('a task decision must author its durable objective', async () => {
  const autonomousObservation: EnvironmentObservation = {
    ...observation,
    metadata: {
      correlationId: 'autonomy-objective',
      robotObserver: {
        cycleId: 'autonomy-objective',
        step: 1,
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
      },
    }),
    observation: autonomousObservation,
    sessionId: autonomousObservation.sessionId,
    robotObserver: autonomousObservation.metadata?.robotObserver,
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
        objective: 'Take the requested picture.',
        outcome: 'act',
        reason: 'No image content is attached.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
        visualEvidenceMode: 'single',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {});
  assert.equal(capture.actions[0]?.type, 'captureImage');
  assert.equal(capture.taskDecision?.continuationPolicy, 'bounded');
  assert.equal(capture.taskDecision?.requiredCompletionBasis, 'visual_observation');

  const malformedCapture = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will take a picture.',
      actions: [{ type: 'captureImage', command: 'neutral' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Wave until the requested visual condition is established.',
        outcome: 'act',
        reason: 'The user requested a picture.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {});
  assert.deepEqual(malformedCapture.actions, []);
  assert.match(malformedCapture.taskDecisionError, /valid typed Environment action/i);

  const boundedWave = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will wave and inspect each correlated camera result.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Wave until the requested visual condition is established.',
        outcome: 'act',
        reason: 'The visual stopping condition is not yet satisfied.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'information_gain',
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

  const conflictingRoutes = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will continue waving because no hand is visible.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: { description: 'Stand still and wave until the hand is visible.' },
      taskDecision: {
        objective: 'Establish whether a hand is visible.',
        outcome: 'continue',
        reason: 'No hand is visible in the current correlated frame.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'body_local',
        actionPurpose: 'information_gain',
        visualEvidenceMode: 'single',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {});
  assert.deepEqual(conflictingRoutes.actions, []);
  assert.equal(conflictingRoutes.movementRequest, null);
  assert.match(
    conflictingRoutes.taskDecisionError,
    /either actions or movementRequest, not both/i,
  );
});

test('action purpose and evidence remain on the validated LLM decision', async () => {
  const movementObservation: EnvironmentObservation = {
    ...observation,
    capabilities: {
      ...observation.capabilities,
      actions: ['robotMotionPlan'],
      motionClasses: ['body_local'],
    },
  };
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will perform one expressive posture change.',
      actions: [],
      movementRequest: { description: 'Shift into one bounded expressive posture.' },
      taskDecision: {
        objective: 'Express a posture that fits the current situation.',
        outcome: 'act',
        reason: 'The posture change is an expressive consequence.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
    observation: movementObservation,
    sessionId: movementObservation.sessionId,
  }, {}, {});

  assert.equal(result.movementRequest?.description, 'Shift into one bounded expressive posture.');
  assert.equal(result.taskDecisionError, '');
  assert.equal(result.taskDecision?.actionPurpose, 'expression');
  assert.equal(result.taskDecision?.requiredCompletionBasis, 'visual_observation');
});

test('the spiky-friend head-tilt case requires a structured advertised action rather than intention prose', async () => {
  const autonomyObservation: EnvironmentObservation = {
    ...observation,
    capabilities: {
      ...observation.capabilities,
      actions: ['robotCommand'],
      robotCommands: ['curious'],
      motionClasses: ['body_local'],
      visual: true,
    },
    metadata: {
      correlationId: 'spiky-friend-cycle',
      robotObserver: {
        cycleId: 'spiky-friend-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'boredom-autonomy',
        requestedBy: 'boredom-observer',
      },
    },
  };
  const admitted = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I noticed the spiky object and want a closer, curious look.',
      actions: [{ type: 'robotCommand', command: 'curious' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Express curiosity about the newly observed spiky object.',
        outcome: 'act',
        reason: 'The correlated image provides the object evidence and the advertised curious command expresses the chosen response.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
    observation: autonomyObservation,
    sessionId: autonomyObservation.sessionId,
  }, {}, {});

  assert.equal(admitted.taskDecisionError, '');
  assert.equal(admitted.actions[0]?.command, 'curious');
  assert.equal(admitted.taskDecision?.objectiveComplete, false);

  const proseOnly = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I tilt my head at the spiky friend.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        objective: 'Express curiosity about the newly observed spiky object.',
        outcome: 'act',
        reason: 'A head tilt would express curiosity.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
    observation: autonomyObservation,
    sessionId: autonomyObservation.sessionId,
  }, {}, {});

  assert.deepEqual(proseOnly.actions, []);
  assert.equal(proseOnly.taskDecision, null);
  assert.match(proseOnly.taskDecisionError, /outcome=act requires an action or movementRequest/i);
});

test('the Environment selector contract has no unconsumed escalation output', async () => {
  const result = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will keep this as a reflection.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        outcome: 'report',
        reason: 'A reflective response is the selected consequence.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        actionPurpose: 'expression',
        escalation: { target: 'general', reason: 'No runtime owner exists.' },
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(result.taskDecision, null);
  assert.match(result.taskDecisionError, /taskDecision\.escalation is not supported/);
});

test('autonomy responses remain on the parser single response path', async () => {
  const reflection = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The quiet room makes me think of the slow afternoon light.',
      actions: [],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(reflection.response, 'The quiet room makes me think of the slow afternoon light.');

  const spoken = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'That patch of light looks especially warm today.',
      actions: [],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {});

  assert.equal(spoken.response, 'That patch of light looks especially warm today.');
});
