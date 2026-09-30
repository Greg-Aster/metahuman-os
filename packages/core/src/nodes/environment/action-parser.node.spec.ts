import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentActionParserNode } from './action-parser.node.js';
import { buildEnvironmentSelectorJsonSchema, validateEnvironmentSelectorOutput } from './helpers.js';

test('one model-owned outcome defines objective completion independently of speech and physical routes', () => {
  const taskDecision = {
    objective: 'Sustain an interaction',
    completionCriteria: 'The participants conclude the interaction.',
    outcome: 'continue', reason: 'The interaction has begun and is ongoing.',
    continuationPolicy: 'none', requiredCompletionBasis: 'user_input',
  };
  const choice = { response: 'We can begin.', actions: [], movementRequest: null, taskDecision };
  const continued = validateEnvironmentSelectorOutput(JSON.stringify(choice));
  assert.deepEqual(continued.errors, []);
  assert.equal(continued.value?.taskDecision?.objectiveComplete, false);
  const completed = validateEnvironmentSelectorOutput(JSON.stringify({
    ...choice, taskDecision: { ...taskDecision, outcome: 'complete', reason: 'The participants concluded it.' },
  }));
  assert.deepEqual(completed.errors, []);
  assert.equal(completed.value?.taskDecision?.objectiveComplete, true);
  const contradictory = validateEnvironmentSelectorOutput(JSON.stringify({
    ...choice, taskDecision: { ...taskDecision, outcome: 'complete', objectiveComplete: false },
  }));
  assert.equal(contradictory.valid, false, 'The model contract has no second completion switch');
  assert.equal(JSON.stringify(buildEnvironmentSelectorJsonSchema()).includes('objectiveComplete'), false);
});

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

  await assert.rejects(environmentActionParserNode.execute({
    response: 'status=complete',
    observation,
    sessionId: observation.sessionId,
  }, {}, {}), /strict JSON/i);
});

test('an empty selector result is rejected while a conversational result remains valid', async () => {
  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: '',
      actions: [],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {}), /must include a non-empty response, action, movementRequest, or taskDecision/i);

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
  assert.equal(conversation.error, '');
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

test('objective progress is independent of action choice but dispatch is not completion', async () => {
  for (const outcome of ['act', 'continue', 'observe', 'curiosity']) {
    for (const freestyle of [false, true]) {
      const result = await environmentActionParserNode.execute({
        response: JSON.stringify({
          response: '',
          actions: freestyle ? [] : [{ type: 'robotCommand', command: 'stand' }],
          movementRequest: freestyle ? { description: 'Extend a front leg and return it.' } : null,
          taskDecision: { objective: 'Locate a target and greet it.', outcome, reason: 'Another step toward the same objective.',
            completionCriteria: 'The target is identified and the greeting has completed.',
            continuationPolicy: 'none', requiredCompletionBasis: 'visual_observation' },
        }),
        observation: { ...observation, capabilities: { ...observation.capabilities, actions: ['robotCommand', 'robotMotionPlan'] } },
        sessionId: observation.sessionId,
      }, {}, {});
      assert.equal(result.valid, true);
      assert.equal(result.taskDecision.outcome, outcome, 'The parser must preserve the model decision');
      assert.equal(result.movementRequested, freestyle);
      assert.equal(result.hasActions, !freestyle);
      assert.equal(result.hasResponse, false);
    }
  }
  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I am standing now.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Stand upright.',
        completionCriteria: 'The standing command has completed.',
        outcome: 'complete',
        reason: 'Standing is the selected consequence.',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {}), /newly selected action cannot establish objective completion/i);
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
  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will stand.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Standing is the selected consequence.',
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
      },
    }),
    observation: autonomousObservation,
    sessionId: autonomousObservation.sessionId,
    robotObserver: autonomousObservation.metadata?.robotObserver,
  }, {}, {}), /objective must be a non-empty string/i);
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
        completionCriteria: 'The requested new image is received.',
        outcome: 'act',
        reason: 'No image content is attached.',
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

  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will take a picture.',
      actions: [{ type: 'captureImage', command: 'neutral' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Wave until the requested visual condition is established.',
        completionCriteria: 'The requested hand is visible in a correlated observation.',
        outcome: 'act',
        reason: 'The user requested a picture.',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {}), /valid typed Environment action/i);

  const boundedWave = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will wave and inspect each correlated camera result.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Wave until the requested visual condition is established.',
        outcome: 'act',
        reason: 'The visual stopping condition is not yet satisfied.',
        completionCriteria: 'The requested hand is visible in a correlated observation.',
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

  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will continue waving because no hand is visible.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: { description: 'Stand still and wave until the hand is visible.' },
      taskDecision: {
        objective: 'Establish whether a hand is visible.',
        outcome: 'continue',
        reason: 'No hand is visible in the current correlated frame.',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'body_local',
        actionPurpose: 'information_gain',
        visualEvidenceMode: 'single',
      },
    }),
    observation: visualObservation,
    sessionId: visualObservation.sessionId,
  }, {}, {}), /either actions or movementRequest, not both/i);
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
        completionCriteria: 'The chosen expressive posture has completed.',
        outcome: 'act',
        reason: 'The posture change is an expressive consequence.',
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
  assert.equal(result.error, '');
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
        completionCriteria: 'The chosen expressive gesture has completed.',
        outcome: 'act',
        reason: 'The correlated image provides the object evidence and the advertised curious command expresses the chosen response.',
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
    observation: autonomyObservation,
    sessionId: autonomyObservation.sessionId,
  }, {}, {});

  assert.equal(admitted.error, '');
  assert.equal(admitted.actions[0]?.command, 'curious');
  assert.equal(admitted.taskDecision?.objectiveComplete, false);

  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I tilt my head at the spiky friend.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        objective: 'Express curiosity about the newly observed spiky object.',
        completionCriteria: 'The chosen expressive gesture has completed.',
        outcome: 'act',
        reason: 'A head tilt would express curiosity.',
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
        actionPurpose: 'expression',
      },
    }),
    observation: autonomyObservation,
    sessionId: autonomyObservation.sessionId,
  }, {}, {}), /outcome=act requires an action or movementRequest/i);
});

test('the Environment selector contract has no unconsumed escalation output', async () => {
  await assert.rejects(environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will keep this as a reflection.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'A reflective response is the selected consequence.',
        completionCriteria: 'The reflective response has been expressed.',
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        actionPurpose: 'expression',
        escalation: { target: 'general', reason: 'No runtime owner exists.' },
      },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {}), /taskDecision\.escalation is not supported/);
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
