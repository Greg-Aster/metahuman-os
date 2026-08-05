import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { getNode } from '../index.js';
import { boredomMovementContextBuilderNode } from './context-builder.node.js';
import { boredomMovementResultParserNode } from './result-parser.node.js';

function postMovementObservation() {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T17:00:00.000Z',
    capabilities: { actions: ['captureImage', 'robotCommand'], visual: true },
    visual: {
      id: 'boredom-image-1',
      timestamp: '2026-08-04T17:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      metadata: { correlationId: 'boredom-cycle-1' },
    },
    metadata: {
      correlationId: 'boredom-cycle-1',
      boredomMovement: {
        cycleId: 'boredom-cycle-1',
        triggerSource: 'autonomy' as const,
        requestedBy: 'boredom-movement' as const,
        graph: 'boredom-movement',
        selectedCommand: 'wave',
      },
    },
  };
}

test('Boredom Movement context accepts only its correlated post-movement image', async () => {
  const observation = postMovementObservation();
  const result = await boredomMovementContextBuilderNode.execute({
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
    personaText: 'Curious, playful, and grounded.',
  }, {}, {
    systemPrompt: 'Reflect on current visual evidence and return configured JSON.',
  });

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.stimulus.performedCommand, 'wave');
  assert.match(String(result.messages[0]?.content), /playful/);
  assert.match(JSON.stringify(result.messages[1]?.content), /performedCommand/);
  assert.match(JSON.stringify(result.messages[1]?.content), /image_url/);
  assert.doesNotMatch(JSON.stringify(result.messages), /robotCommands|conversationHistory|idleThought/);

  const stale = await boredomMovementContextBuilderNode.execute({
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'older-cycle' } }],
  }, {}, { systemPrompt: 'Return configured JSON.' });
  assert.equal(stale.valid, false);
  assert.match(stale.error, /correlated post-movement image/i);
});

test('Boredom Movement parser exposes reflection without an action channel', async () => {
  const parsed = await boredomMovementResultParserNode.execute({
    response: '<think>private</think>{"observed":"A desk and lamp are visible.","reflection":"That little wave made this quiet room feel less still."}',
  }, {});
  assert.equal(parsed.valid, true);
  assert.equal(parsed.observed, 'A desk and lamp are visible.');
  assert.match(parsed.reflection, /quiet room/);
  assert.deepEqual(Object.keys(parsed.result), ['observed', 'reflection']);
  assert.doesNotMatch(JSON.stringify(parsed.result), /action|instruction|private/);
});

test('Boredom Movement graph is a one-model post-image workflow with no Environment delegation', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/boredom-movement-mode.json'),
    'utf8',
  ));
  const nodeTypes = graph.nodes.map((node: any) => node.data?.nodeType);
  assert.equal(nodeTypes.filter((nodeType: string) => nodeType === 'model_router').length, 1);
  assert.equal(nodeTypes.includes('boredom_movement_context_builder'), true);
  assert.equal(nodeTypes.includes('boredom_movement_result_parser'), true);
  assert.equal(nodeTypes.includes('inner_dialogue_buffer'), true);
  assert.equal(nodeTypes.includes('tts'), true);
  for (const forbidden of [
    'conversation_history',
    'robot_operator_context_builder',
    'robot_operator_environment_dispatch',
    'environment_action_parser',
    'environment_send_action',
    'environment_task_validator',
    'movement_generator',
  ]) {
    assert.equal(nodeTypes.includes(forbidden), false, `Boredom Movement Mode must not contain ${forbidden}`);
  }
  const prompt = graph.nodes.find((node: any) => (
    node.data?.nodeType === 'boredom_movement_context_builder'
  ))?.data?.properties?.systemPrompt;
  assert.match(String(prompt), /completed, safe stationary boredom movement/i);
  assert.match(String(prompt), /Do not request, plan, or imply another action/i);
  assert.ok(String(prompt).length < 700);
  assert.ok(getNode('boredom_movement_context_builder'));
  assert.ok(getNode('boredom_movement_result_parser'));

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  assert.equal(services.services['robot-operator'].boredomGraph, 'boredom-movement');
  const handler = fs.readFileSync(
    path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts'),
    'utf8',
  );
  assert.match(handler, /type: 'robotCommand'/);
  assert.match(handler, /graph: config\.boredomGraph/);
  assert.doesNotMatch(handler, /config\.graph|config\.environmentGraph|context\.enqueue/);
});
