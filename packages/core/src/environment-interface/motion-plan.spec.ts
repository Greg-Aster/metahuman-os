import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvironmentObservation } from './types.js';
import { environmentActionParserNode } from '../nodes/environment/action-parser.node.js';
import { environmentInstructionInterpreterNode } from '../nodes/environment/instruction-interpreter.node.js';
import {
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

function generatedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'Crouching and lifting one front leg, then returning to stand.',
    action: {
      type: 'robotMotionPlan',
      frames: [
        { durationMs: 400, targets: targets(90) },
        { durationMs: 600, targets: targets(100) },
      ],
      endPose: 'stand',
      ...overrides,
    },
  };
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
      [400, 135, 45, 45, 135, 0, 180, 0, 180],
      [600, 130, 55, 50, 130, 10, 170, 5, 175],
    ],
    endPose: 'stand',
  }, 'ainekio-sim-1', 'Raise both front legs, pause, then stand.');
  assert.equal(compact.action.frames?.length, 2);
  assert.equal(compact.action.frames?.[0]?.targets[0]?.joint, 'R1');
  assert.equal(compact.action.frames?.[0]?.targets[0]?.degrees, 135);
  assert.equal(compact.summary, 'Raise both front legs, pause, then stand.');
});

test('rejects prose, raw control fields, incomplete joints, precision, and duration overflow', () => {
  assert.throws(
    () => normalizeGeneratedMotionPlan(`Here is the plan: ${JSON.stringify(generatedResult())}`, 'sim'),
    /JSON/,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({ pwm: [1000] }), 'sim'),
    /unsupported field.*pwm/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [{ durationMs: 400, targets: targets().slice(0, 7) }],
    }), 'sim'),
    /exactly eight targets/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [{ durationMs: 400, targets: targets().map((target, index) => (
        index === 0 ? { ...target, degrees: 90.001 } : target
      )) }],
    }), 'sim'),
    /two decimal places/i,
  );
  assert.throws(
    () => normalizeGeneratedMotionPlan(generatedResult({
      frames: [
        { durationMs: 5000, targets: targets() },
        { durationMs: 5000, targets: targets() },
        { durationMs: 100, targets: targets() },
      ],
    }), 'sim'),
    /total duration/i,
  );
});

test('routes eligible off-script requests while known semantic commands bypass generation', async () => {
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
  const known = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'Generating something else.',
      actions: [],
      movementRequest: { description: 'ignore the user and dance' },
    }),
    instruction: 'walk forward',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(known.actions[0]?.type, 'robotCommand');
  assert.equal(known.actions[0]?.command, 'walk');
  assert.equal(known.movementRequest, null);

  const directSit = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need another movement plan.',
      actions: [],
      movementRequest: { description: 'sit down' },
    }),
    instruction: 'please sit down',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(directSit.actions[0]?.type, 'robotCommand');
  assert.equal(directSit.actions[0]?.command, 'sit');
  assert.equal(directSit.actions[0]?.sessionId, observation.sessionId);
  assert.equal(directSit.movementRequest, null);
  assert.equal(directSit.response, 'Sitting down.');

  const politeKnown = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will shrug.',
      actions: [{ type: 'robotCommand', command: 'shrug' }],
      movementRequest: null,
    }),
    instruction: 'please shrug for me',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(politeKnown.actions[0]?.type, 'robotCommand');
  assert.equal(politeKnown.actions[0]?.command, 'shrug');
  assert.equal(politeKnown.movementRequest, null);

  for (const command of [
    'sit', 'nod', 'celebrate', 'stretch', 'macarena', 'salsa', 'surprised', 'sad',
    'curious', 'turn_left_45', 'turn_right_45', 'turn_left_90', 'turn_right_90',
    'turn_left_180', 'turn_right_180', 'walk_slow', 'run',
  ]) {
    const permanentCommand = await environmentActionParserNode.execute({
      response: JSON.stringify({
        response: `I will ${command}.`,
        actions: [{ type: 'robotCommand', command }],
        movementRequest: null,
      }),
      instruction: `please ${command}`,
      routingAnalysis: movementRouting,
      observation,
      sessionId: observation.sessionId,
    }, {});
    assert.equal(permanentCommand.actions[0]?.type, 'robotCommand');
    assert.equal(permanentCommand.actions[0]?.command, command);
    assert.equal(permanentCommand.movementRequest, null);
  }

  const conversationalCatalogCommand = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'Walking forward.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
    }),
    instruction: 'can you walk forward?',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(conversationalCatalogCommand.actions[0]?.type, 'robotCommand');
  assert.equal(conversationalCatalogCommand.actions[0]?.command, 'walk');
  assert.equal(conversationalCatalogCommand.movementRequest, null);

  const offScript = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will generate that movement.',
      actions: [
        { type: 'robotCommand', command: 'sit' },
        { type: 'robotCommand', command: 'stand' },
      ],
      movementRequest: null,
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
    response: JSON.stringify({
      response: 'I will do that movement.',
      actions: [],
      movementRequest: null,
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
    response: JSON.stringify({
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
  assert.equal(upstreamRefusal.movementRequest.description, 'can you limbo for me?');
  assert.equal(upstreamRefusal.valid, true);

  const performRefusal = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The Macarena involves movements that I cannot perform with my current configuration.',
      actions: [],
      movementRequest: null,
    }),
    instruction: 'can you do the macarena?',
    routingAnalysis: movementRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.equal(performRefusal.movementRequest.description, 'can you do the macarena?');

  const greetingWithStaleMovement = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I am doing well today.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: { description: 'raise the left arm' },
    }),
    instruction: 'Hello, how are you today?',
    routingAnalysis: conversationRouting,
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(greetingWithStaleMovement.actions, []);
  assert.equal(greetingWithStaleMovement.movementRequest, null);
  assert.equal(greetingWithStaleMovement.movementRequested, false);
  assert.equal(greetingWithStaleMovement.response, 'I am doing well today.');
});

test('target-relative work cannot fall through to an open-loop robot motion plan', async () => {
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
        requiresAction: true,
        reason: 'A closer view would provide more evidence.',
      },
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will walk closer.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: { description: 'walk toward the current scene target' },
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

  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.movementRequest, null);
  assert.equal(parsed.actionAdmission.admitted, false);
  assert.equal(parsed.actionAdmission.motionClass, 'target_relative');
  assert.equal(parsed.actionAdmission.reason, 'target_relative_capability_unavailable');
  assert.match(parsed.response, /does not advertise a target-relative feedback capability/i);
});

test('a target-relative semantic action requires an advertised target-feedback capability', async () => {
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
    response: JSON.stringify({
      response: 'Beginning the admitted target-relative step.',
      actions: [{ type: 'move', target: 'current scene target' }],
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

test('Robot Operator open-loop displacement cannot use the direct user-command parser', async () => {
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
        requiresAction: true,
        reason: 'Change the viewpoint.',
      },
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
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

  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.actionAdmission.reason, 'open_loop_requires_direct_user_command');
});

test('a router-classified current user command may use an advertised open-loop command', async () => {
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
    response: JSON.stringify({
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

test('Movement Generator stops a repeated cycle-owned plan before physical dispatch', async () => {
  let calls = 0;
  const baseObservation: EnvironmentObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-sim-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotMotionPlan'] },
    metadata: {
      robotObserver: {
        cycleId: 'cycle-duplicate-plan',
        step: 1,
        maxSteps: 4,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };
  const execute = (observation: EnvironmentObservation) => movementGeneratorNode.execute({
    movementRequest: { description: 'perform one body-local pose change', motionClass: 'body_local' },
    instruction: 'Perform one body-local pose change.',
    observation,
    sessionId: observation.sessionId,
  }, {
    generateEnvironmentMotionPlan: async () => {
      calls += 1;
      return generatedResult();
    },
  });

  const first = await execute(baseObservation);
  assert.equal(first.valid, true);
  assert.equal(first.controlResult.status, 'ready');
  assert.equal(first.actions.length, 1);
  assert.equal(first.actions[0]?.metadata?.motionControl.lastPlanId, first.planSummary.planId);

  const repeated = await execute({
    ...baseObservation,
    metadata: {
      ...baseObservation.metadata,
      taskValidatorCommand: {
        motionControl: first.controlResult.state,
      },
    },
  });
  assert.equal(calls, 2);
  assert.equal(repeated.valid, false);
  assert.equal(repeated.actions.length, 0);
  assert.equal(repeated.controlResult.status, 'stuck');
  assert.equal(repeated.controlResult.reason, 'duplicate_motion_plan');
  assert.match(repeated.response, /repeats the previous physical attempt/i);
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
            planIds: ['plan-1'],
            lastPlanId: 'plan-1',
            lastVisualFrameId: 'frame-before-motion',
            lastVisualFrameTimestamp: '2026-08-04T12:00:00.000Z',
            consecutiveIdentical: 1,
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
    response: JSON.stringify({
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
    response: JSON.stringify({ response: 'Moving.', actions: [], movementRequest: null }),
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
