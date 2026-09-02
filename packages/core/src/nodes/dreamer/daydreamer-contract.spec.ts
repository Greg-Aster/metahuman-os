import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { buildDaydreamerMessages } from './daydreamer-generator.node.js';
import { resolveDreamSourceIds } from './dreamer-dream-saver.node.js';
import { isGeneratedInnerMemory } from './dreamer-memory-curator.node.js';

test('daydream generation explicitly includes formatted persona context', () => {
  const messages = buildDaydreamerMessages(
    'Generate a brief private daydream.',
    'Use these memories.',
    'Identity: A curious robot companion.',
  );

  assert.equal(messages.length, 2);
  assert.equal(typeof messages[0].content, 'string');
  assert.equal(typeof messages[1].content, 'string');
  if (typeof messages[0].content !== 'string' || typeof messages[1].content !== 'string') {
    throw new Error('Daydreamer text prompts must remain string messages');
  }
  assert.match(messages[0].content, /Identity: A curious robot companion/);
  assert.match(messages[0].content, /Generate a brief private daydream/);
  assert.equal(messages[1].content, 'Use these memories.');
});

test('dream persistence preserves unique source IDs from explicit and legacy inputs', () => {
  assert.deepEqual(resolveDreamSourceIds({
    sourceIds: ['evt-explicit', 'evt-shared', ''],
    memoriesData: {
      memories: [
        { id: 'evt-legacy' },
        { id: 'evt-shared' },
        {},
      ],
    },
  }), ['evt-explicit', 'evt-shared', 'evt-legacy']);
});

test('generated inner memories are not sampled back into later dreams', () => {
  for (const type of ['dream', 'daydream', 'reflection', 'inner_dialogue']) {
    assert.equal(isGeneratedInnerMemory(type), true, type);
  }
  assert.equal(isGeneratedInnerMemory('conversation'), false);
  assert.equal(isGeneratedInnerMemory('observation'), false);
});

test('daydreamer graph orders persona, citations, persistence, buffer admission, and TTS', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc', 'cognitive-graphs', 'daydreamer-mode.json'),
    'utf8',
  ));
  const nodeTypeById = new Map<string, string>(
    graph.nodes.map((node: any) => [node.id, node.data.nodeType]),
  );
  const edgeTo = (targetType: string, targetHandle: string) => graph.edges.find(
    (edge: any) => nodeTypeById.get(edge.target) === targetType && edge.targetHandle === targetHandle,
  );
  const sourceType = (edge: any) => nodeTypeById.get(edge?.source);

  assert.equal(sourceType(edgeTo('daydreamer_generator', 'personaPrompt')), 'persona_formatter');
  assert.equal(sourceType(edgeTo('dreamer_dream_saver', 'sourceIds')), 'daydreamer_generator');
  assert.equal(sourceType(edgeTo('inner_dialogue_buffer', 'entries')), 'dreamer_dream_saver');
  assert.equal(sourceType(edgeTo('tts', 'innerDialogue')), 'inner_dialogue_buffer');
  assert.equal(graph.nodes.some((node: any) => node.data.nodeType === 'audit_logger'), false);
});
