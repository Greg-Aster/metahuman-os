import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentActionParserNode } from '../nodes/environment/action-parser.node.js';
import { environmentInstructionInterpreterNode } from '../nodes/environment/instruction-interpreter.node.js';
import {
  movementGeneratorNode,
  normalizeGeneratedMotionPlan,
} from '../nodes/environment/movement-generator.node.js';

const joints = ['R1', 'R2', 'L1', 'L2', 'R4', 'R3', 'L3', 'L4'];
const movementRouting = { needsAction: true, actionType: 'robot_movement' };
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
      robotCommands: ['walk', 'wave', 'bow', 'shrug'],
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
    movementRequest: { description: 'lift one front leg' },
    observation,
    sessionId: observation.sessionId,
  }, {});
  assert.deepEqual(generated.actions, []);
  assert.equal(generated.rejected, true);
  assert.match(generated.error, /not advertised/i);
});
