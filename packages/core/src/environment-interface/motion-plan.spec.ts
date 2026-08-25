import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvironmentObservation } from './types.js';
import { environmentActionParserNode } from '../nodes/environment/action-parser.node.js';
import { environmentInstructionInterpreterNode } from '../nodes/environment/instruction-interpreter.node.js';
import {
  MOVEMENT_GENERATOR_JSON_SCHEMA,
  movementGeneratorNode,
  normalizeGeneratedMotionPlan,
} from '../nodes/environment/movement-generator.node.js';

const joints = ['R1', 'R2', 'L1', 'L2', 'R4', 'R3', 'L3', 'L4'];
const movementRouting = {
  needsAction: true,
  actionType: 'robot_movement',
  actionParams: { motionClass: 'body_local' },
};
const conversationRouting = { needsAction: false, actionType: 'none' };

function targets(degrees = 90): Array<{ joint: string; degrees: number }> {
  return joints.map(joint => ({ joint, degrees }));
}

function generatedFrame(durationMs: number, degrees = 90): Record<string, string> {
  return Object.fromEntries([
    ['durationMs', String(durationMs)],
    ...joints.map(joint => [joint, String(degrees)]),
  ]);
}

function generatedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'Crouching and lifting one front leg, then returning to stand.',
    frames: [generatedFrame(400, 90), generatedFrame(600, 100)],
    endPose: 'stand',
    ...overrides,
  };
}

function selectorJson(output: {
  response: string;
  actions: Array<Record<string, unknown>>;
  movementRequest: Record<string, unknown> | null;
  taskDecision?: Record<string, unknown>;
}): string {
  const supplied = output.taskDecision ?? {};
  const physical = output.actions.length > 0 || output.movementRequest !== null;
  const targetRelative = ['inspect', 'visualApproach', 'move'].includes(String(output.actions[0]?.type))
    || supplied.motionClass === 'target_relative'
    || supplied.requiredCompletionBasis === 'visual_observation';
  return JSON.stringify({
    ...output,
    taskDecision: {
      objective: 'Exercise the current Environment selection and admission contract.',
      outcome: physical ? 'act' : 'report',
      reason: physical ? 'The selected action advances the current objective.' : 'No physical action was selected.',
      objectiveComplete: false,
      continuationPolicy: targetRelative ? 'bounded' : 'none',
      requiredCompletionBasis: targetRelative
        ? 'visual_observation'
        : physical ? 'action_result' : 'response',
      ...(physical
        ? {
            motionClass: targetRelative ? 'target_relative' : 'body_local',
            actionPurpose: targetRelative ? 'information_gain' : 'expression',
          }
        : {}),
      ...supplied,
    },
  });
}

test('normalizes one bounded generated plan and assigns the coordinator session', () => {
  const normalized = normalizeGeneratedMotionPlan(
    JSON.stringify(generatedResult()),
    'ainekio-sim-1',
  );
  assert.equal(normalized.action.type, 'robotMotionPlan');
  assert.equal(normalized.action.sessionId, 'ainekio-sim-1');
  assert.equal(normalized.action.frames?.length, 2);
  assert.equal(normalized.action.frames?.[0]?.targets.length, 8);
  assert.equal(normalized.totalDurationMs, 1000);
  assert.equal(normalized.action.endPose, 'stand');

  const compact = normalizeGeneratedMotionPlan({
    frames: [
      { durationMs: '400', R1: '135', R2: '45', L1: '45', L2: '135', R4: '0', R3: '180', L3: '0', L4: '180' },
      { durationMs: '600', R1: '130', R2: '55', L1: '50', L2: '130', R4: '10', R3: '170', L3: '5', L4: '175' },
    ],
    endPose: 'stand',
  }, 'ainekio-sim-1', 'Raise both front legs, pause, then stand.');
  assert.equal(compact.action.frames?.length, 2);
  assert.equal(compact.action.frames?.[0]?.targets[0]?.joint, 'R1');
  assert.equal(compact.action.frames?.[0]?.targets[0]?.degrees, 135);
  assert.equal(compact.summary, 'Raise both front legs, pause, then stand.');
});

test('Movement Generator structured output constrains every joint before runtime validation', () => {
  const schema = MOVEMENT_GENERATOR_JSON_SCHEMA as any;
  const frame = schema.properties.frames.items;
  assert.equal(frame.type, 'object');
  assert.equal(frame.additionalProperties, false);
  assert.deepEqual(frame.required, ['durationMs', ...joints]);
  assert.equal(frame.properties.durationMs.type, 'string');
  assert.match(frame.properties.durationMs.pattern, /5000/);
  for (const joint of joints) {
    assert.equal(frame.properties[joint].type, 'string');
    assert.match(frame.properties[joint].pattern, /180/);
  }
});

test('rejects prose, raw control fields, incomplete joints, precision, and duration overflow', () => {
  assert.throws(
    () => normalizeGeneratedMotionPlan(`Here is the plan: ${JSON.stringify(generatedResult())}`, 'sim'),
    /JSON/,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan({ ...generatedResult(), pwm: [1000] }, 'sim'),
    /unsupported field.*pwm/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [{ ...generatedFrame(400), L4: undefined }],
    }), 'sim'),
    /joint L4/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [{ ...generatedFrame(400), R1: '90.001' }],
    }), 'sim'),
    /two decimal places/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [
        generatedFrame(5000),
        generatedFrame(5000),
        generatedFrame(100),
      ],
    }), 'sim'),
    /total duration/i,
  );
});

test('uses only Environment LLM-selected advertised commands and explicit movement requests', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan'],
      robotCommands: [
        'sit', 'walk', 'wave', 'bow', 'shrug', 'nod', 'celebrate', 'stretch',
        'macarena', 'salsa', 'surprised', 'sad', 'curious',
        'turn_left_45', 'turn_right_45', 'turn_left_90', 'turn_right_90',
        'turn_left_180', 'turn_right_180', 'walk_slow', 'run',
      ],
    },
  };
  const missingSelection = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Walking forward.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'A physical action is required.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
      },
    }),
    instruction: 'walk forward',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(missingSelection.actions, []);
  assert.equal(missingSelection.movementRequest, null);
  assert.equal(missingSelection.valid, false);

  const surprised = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Acting surprised.',
      actions: [{ type: 'robotCommand', command: 'surprised' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The surprised command matches the requested body-local expression.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
      },
    }),
    instruction: 'Please act surprised.',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'target_relative' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(surprised.actions[0]?.command, 'surprised');
  assert.equal(surprised.actionAdmission.motionClass, 'body_local');
  assert.equal(surprised.taskDecision.motionClass, 'body_local');

  const turn = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Turning right.',
      actions: [{ type: 'robotCommand', command: 'turn_right_90' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The advertised turn command matches the requested orientation change.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
      },
    }),
    instruction: 'Please turn to the right.',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'open_loop_displacement' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(turn.actions[0]?.command, 'turn_right_90');
  assert.equal(turn.actionAdmission.motionClass, 'open_loop_displacement');

  const anyMotion = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Waving.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Wave is one advertised body-local motion.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
      },
    }),
    instruction: 'Please do a motion of any kind.',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(anyMotion.actions[0]?.command, 'wave');

  for (const command of [
    'sit', 'nod', 'celebrate', 'stretch', 'macarena', 'salsa', 'surprised', 'sad',
    'curious', 'turn_left_45', 'turn_right_45', 'turn_left_90', 'turn_right_90',
    'turn_left_180', 'turn_right_180', 'walk_slow', 'run',
  ]) {
    const permanentCommand = await environmentActionParserNode.execute({
      response: selectorJson({
        response: `I will ${command}.`,
        actions: [{ type: 'robotCommand', command }],
        movementRequest: null,
        taskDecision: {
          outcome: 'act',
          reason: 'The selected command is advertised.',
          objectiveComplete: false,
          continuationPolicy: 'none',
          requiredCompletionBasis: 'action_result',
          motionClass: command.startsWith('turn_') || command === 'walk_slow' || command === 'run'
            ? 'open_loop_displacement'
            : 'body_local',
        },
      }),
      instruction: `please ${command}`,
      routingAnalysis: {
        needsAction: true,
        actionType: 'robot_movement',
        actionParams: {
          motionClass: command.startsWith('turn_') || command === 'walk_slow' || command === 'run'
            ? 'open_loop_displacement'
            : 'body_local',
        },
      },
      observation,
      sessionId: observation.sessionId,
    }, {});
    assert.equal(permanentCommand.actions[0]?.type, 'robotCommand');
    assert.equal(permanentCommand.actions[0]?.command, command);
    assert.equal(permanentCommand.movementRequest, null);
  }

  const conversationalCatalogCommand = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Walking forward.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Walk is the advertised command selected for the request.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction: 'can you walk forward?',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'open_loop_displacement' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(conversationalCatalogCommand.actions[0]?.type, 'robotCommand');
  assert.equal(conversationalCatalogCommand.actions[0]?.command, 'walk');
  assert.equal(conversationalCatalogCommand.movementRequest, null);

  const offScript = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'I will generate that movement.',
      actions: [],
      movementRequest: { description: 'Crouch and lift the front-right leg.' },
      taskDecision: {
        outcome: 'act',
        reason: 'No advertised command represents the requested body-local pose.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction: 'Crouch and lift the front-right leg.',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(offScript.actions, []);
  assert.equal(offScript.movementRequest.description, 'Crouch and lift the front-right leg.');
  assert.equal(offScript.movementRequest.motionClass, 'body_local');
  assert.equal(offScript.valid, true);

  const conversationalOnly = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'I will do that movement.',
      actions: [],
      movementRequest: { description: 'Crouch low, lift the front-right leg, pause, then return to standing.' },
      taskDecision: {
        outcome: 'act',
        reason: 'The LLM explicitly selected off-script body-local generation.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction: 'Crouch low, lift the front-right leg, pause, then return to standing.',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(conversationalOnly.actions, []);
  assert.equal(
    conversationalOnly.movementRequest.description,
    'Crouch low, lift the front-right leg, pause, then return to standing.',
  );

  const upstreamRefusal = await environmentActionParserNode.execute({
    response: selectorJson({
      response: "I'm afraid I don't have a 'limbo' command available in my current set of movements.",
      actions: [],
      movementRequest: null,
    }),
    instruction: 'can you limbo for me?',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(upstreamRefusal.actions, []);
  assert.equal(upstreamRefusal.movementRequest, null);
  assert.equal(upstreamRefusal.valid, false);

  const performRefusal = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'The Macarena involves movements that I cannot perform with my current configuration.',
      actions: [],
      movementRequest: null,
    }),
    instruction: 'can you do the macarena?',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(performRefusal.actions, []);
  assert.equal(performRefusal.movementRequest, null);
  assert.match(performRefusal.response, /cannot perform/i);

  const unsupported = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Doing a limbo.',
      actions: [{ type: 'robotCommand', command: 'limbo' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The model selected a command.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction: 'Please limbo.',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(unsupported.actions, []);
  assert.equal(unsupported.actionAdmission.admitted, false);
  assert.equal(unsupported.actionAdmission.reason, 'robot_command_unavailable');
  assert.match(unsupported.response, /does not advertise/i);

  const routerCannotVetoModelAction = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'I am doing well today.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
    }),
    instruction: 'Hello, how are you today?',
    routingAnalysis: conversationRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(routerCannotVetoModelAction.actions.length, 1);
  assert.equal(routerCannotVetoModelAction.actions[0]?.command, 'wave');
  assert.equal(routerCannotVetoModelAction.movementRequest, null);
  assert.equal(routerCannotVetoModelAction.movementRequested, false);
  assert.equal(routerCannotVetoModelAction.response, 'I am doing well today.');
});

test('a named robot command uses its action result instead of asking the robot camera to verify the robot', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand'],
      robotCommands: ['stand'],
      motionClasses: ['body_local'],
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Standing up.',
      actions: [{ type: 'robotCommand', command: 'stand' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The body-mounted camera cannot see the robot posture, so use command feedback.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'body_local',
      },
    }),
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: {
        motionClass: 'body_local',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.command, 'stand');
  assert.equal(parsed.taskDecision.continuationPolicy, 'none');
  assert.equal(parsed.taskDecision.requiredCompletionBasis, 'action_result');
});

test('target-relative work executes the LLM-selected advertised command without falling through to a generated plan', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan'],
      robotCommands: ['walk'],
      motionClasses: ['body_local', 'open_loop_displacement'],
      navigation: false,
    },
    metadata: {
      robotOperatorDecision: {
        observed: 'A scene target is visible.',
        instruction: 'Move closer to the current scene target for a better view.',
        reason: 'A closer view would provide more evidence.',
      },
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'I will walk closer.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Walk once, then compare the correlated post-action view with the object.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'target_relative',
      },
    }),
    instruction: 'Move closer to the current scene target for a better view.',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: {
        motionClass: 'target_relative',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.type, 'robotCommand');
  assert.equal(parsed.actions[0]?.command, 'walk');
  assert.equal(parsed.movementRequest, null);
  assert.equal(parsed.actionAdmission.admitted, true);
  assert.equal(parsed.actionAdmission.motionClass, 'target_relative');
  assert.equal(parsed.actionAdmission.reason, '');
  assert.equal(parsed.taskDecision.continuationPolicy, 'bounded');
  assert.equal(parsed.taskDecision.requiredCompletionBasis, 'visual_observation');
  assert.equal(parsed.response, 'I will walk closer.');
});

test('an advertised navigation action remains available for a target-relative objective', async () => {
  const observation = {
    environmentId: 'navigation-simulator',
    adapter: 'navigation-adapter',
    sessionId: 'navigation-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['move'],
      motionClasses: ['target_relative'],
      navigation: true,
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Beginning the admitted target-relative step.',
      actions: [{ type: 'move', direction: 'forward', target: 'current scene target' }],
      movementRequest: null,
    }),
    instruction: 'Approach the current scene target.',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'target_relative' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.type, 'move');
  assert.equal(parsed.movementRequest, null);
  assert.equal(parsed.actionAdmission.admitted, true);
});

test('Robot Operator may execute an LLM-selected advertised open-loop command', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand'],
      robotCommands: ['walk'],
      motionClasses: ['open_loop_displacement'],
    },
    metadata: {
      robotOperatorDecision: {
        observed: 'The current scene is static.',
        instruction: 'walk forward',
        reason: 'Change the viewpoint.',
      },
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Walking forward.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
    }),
    instruction: 'walk forward',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'open_loop_displacement' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.type, 'robotCommand');
  assert.equal(parsed.actions[0]?.command, 'walk');
  assert.equal(parsed.actionAdmission.admitted, true);
  assert.equal(parsed.actionAdmission.reason, '');
});

test('an advisory movement route cannot block the Environment LLM advertised open-loop command', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand'],
      robotCommands: ['walk'],
      motionClasses: ['open_loop_displacement'],
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Taking one open-loop step forward.',
      actions: [{ type: 'robotCommand', command: 'walk', units: 1 }],
      movementRequest: null,
    }),
    instruction: 'Could you take one step forward for me?',
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'open_loop_displacement' },
    },
    observation,
    sessionId: observation.sessionId,
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.command, 'walk');
  assert.equal(parsed.actionAdmission.admitted, true);
});

test('Movement Generator rejects target-relative requests even when robotMotionPlan exists', async () => {
  let calls = 0;
  const generated = await movementGeneratorNode.execute({
    movementRequest: {
      description: 'move toward the current scene target',
      motionClass: 'target_relative',
    },
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'ainekio-sim-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotMotionPlan'] },
    },
  }, {
    callLLM: () => {
      calls += 1;
      throw new Error('must not be called');
    },
  });

  assert.equal(calls, 0);
  assert.equal(generated.rejected, true);
  assert.match(generated.error, /only an admitted body_local/i);
});

test('Movement Generator makes one inference attempt and surfaces an invalid plan', async () => {
  let calls = 0;
  const result = await movementGeneratorNode.execute({
    movementRequest: { description: 'perform one body-local pose change', motionClass: 'body_local' },
    instruction: 'Perform one body-local pose change.',
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'ainekio-sim-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotMotionPlan'] },
    },
    sessionId: 'ainekio-sim-1',
  }, {
    generateEnvironmentMotionPlan: async () => {
      calls += 1;
      return generatedResult({
        frames: [{ ...generatedFrame(400), R1: '-10' }],
      });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.actions, []);
  assert.equal(result.rejected, true);
  assert.match(result.response, /Generated movement was rejected/i);
  assert.match(result.error, /outside 0\.\.180 degrees/i);
});

test('Movement Generator rejects a stale post-motion frame before calling a model', async () => {
  let calls = 0;
  const result = await movementGeneratorNode.execute({
    movementRequest: {
      description: 'Shift posture slightly.',
      sessionId: 'robot-1',
      motionClass: 'body_local',
    },
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'robot-1',
      timestamp: '2026-08-04T12:00:05.000Z',
      capabilities: { actions: ['robotMotionPlan'] },
      visual: {
        id: 'frame-before-motion',
        timestamp: '2026-08-04T12:00:00.000Z',
        mimeType: 'image/jpeg',
      },
      metadata: {
        taskValidatorCommand: {
          motionControl: {
            version: 1,
            cycleId: 'observer-cycle',
            lastPlanId: 'plan-1',
            lastVisualFrameId: 'frame-before-motion',
            lastVisualFrameTimestamp: '2026-08-04T12:00:00.000Z',
          },
        },
      },
    },
  }, {
    generateEnvironmentMotionPlan: async () => {
      calls += 1;
      return generatedResult();
    },
  }, {});

  assert.equal(calls, 0);
  assert.equal(result.valid, false);
  assert.equal(result.actions.length, 0);
  assert.equal(result.controlResult.status, 'stuck');
  assert.equal(result.controlResult.reason, 'stale_motion_frame');
  assert.match(result.response, /no fresh camera frame/i);
});

test('current task text cannot be replaced by stale adapter transcript text', async () => {
  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'ainekio-sim-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotMotionPlan'] },
      text: [{
        id: 'stale-transcript',
        source: 'environment',
        text: 'wave repeatedly',
        timestamp: new Date().toISOString(),
      }],
    },
  }, { userMessage: 'Crouch and lift the front-right leg.' });

  assert.equal(interpreted.instruction, 'Crouch and lift the front-right leg.');
  assert.equal(interpreted.text.length, 1);
  assert.equal(interpreted.text[0]?.text, 'Crouch and lift the front-right leg.');
});

test('capability absence rejects the generation branch without calling a model', async () => {
  const observation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], robotCommands: ['walk'] },
  };
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Generating.',
      actions: [],
      movementRequest: { description: 'lift one front leg' },
    }),
    instruction: 'lift one front leg',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(parsed.movementRequest, null);
  assert.equal(parsed.valid, false);
  assert.match(parsed.error, /does not advertise robotMotionPlan/i);

  const generated = await movementGeneratorNode.execute({
    movementRequest: { description: 'lift one front leg', motionClass: 'body_local' },
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(generated.actions, []);
  assert.equal(generated.rejected, true);
  assert.match(generated.error, /not advertised/i);
});

test('a missing robot session is reported before freestyle capability negotiation', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: selectorJson({
      response: 'Moving.',
      actions: [],
      movementRequest: { description: 'do the macarena' },
      taskDecision: {
        outcome: 'act',
        reason: 'The Environment LLM selected off-script body-local movement.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction: 'can you do the macarena?',
    routingAnalysis: movementRouting,
    observation: {
      environmentId: 'unavailable',
      adapter: 'none',
      sessionId: '',
      timestamp: new Date().toISOString(),
      capabilities: { actions: [] },
    },
    sessionId: '',
  }, {});
  assert.equal(parsed.valid, false);
  assert.match(parsed.error, /no robot session is connected/i);

  const generated = await movementGeneratorNode.execute({
    movementRequest: { description: 'do the macarena', motionClass: 'body_local' },
    observation: {
      environmentId: 'unavailable',
      adapter: 'none',
      sessionId: '',
      timestamp: new Date().toISOString(),
      capabilities: { actions: [] },
    },
    sessionId: '',
  }, {});
  assert.match(generated.error, /connected target session/i);
});
