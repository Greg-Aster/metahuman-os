import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRAPH_SCHEDULER,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core';
import {
  evaluateDaydreamerGraph,
  normalizeTriggerProfile,
} from './core.js';
import agent, { meta, run } from './index.js';

const nodeIds = {
  dreamer_memory_curator: 'curator-arbitrary-id',
  daydreamer_generator: 'generator-arbitrary-id',
  dreamer_dream_saver: 'saver-arbitrary-id',
  inner_dialogue_buffer: 'buffer-arbitrary-id',
} as const;

const graph = {
  version: '1.0',
  format: 'svelte-flow',
  name: 'Daydreamer contract fixture',
  cognitiveMode: 'agent',
  scheduler: { ...DEFAULT_GRAPH_SCHEDULER },
  nodes: Object.entries(nodeIds).map(([nodeType, id]) => ({
    id,
    type: 'cognitiveNode',
    position: { x: 0, y: 0 },
    data: { label: nodeType, nodeType, properties: {} },
  })),
  edges: [],
} as SvelteFlowGraph;

const successfulOutputs: Record<keyof typeof nodeIds, Record<string, any>> = {
  dreamer_memory_curator: { count: 5, avgAgeDays: 12 },
  daydreamer_generator: { daydream: 'A grounded test daydream with enough content.' },
  dreamer_dream_saver: { saved: true, eventId: 'evt-daydream' },
  inner_dialogue_buffer: { saved: true, persisted: true },
};

function graphState(
  overrides: Partial<typeof successfulOutputs> = {},
  status: GraphExecutionState['status'] = 'completed',
): GraphExecutionState {
  const outputs = { ...successfulOutputs, ...overrides };
  const nodes = new Map(
    Object.entries(nodeIds).map(([nodeType, id]) => [id, {
      nodeId: id,
      status: 'completed',
      startTime: 0,
      endTime: 1,
      inputs: {},
      outputs: outputs[nodeType as keyof typeof successfulOutputs],
    }]),
  );
  return { nodes, startTime: 0, endTime: 1, status } as GraphExecutionState;
}

test('system scheduler identity resolves through the active authenticated user', () => {
  assert.equal(normalizeTriggerProfile(undefined), null);
  assert.equal(normalizeTriggerProfile('system'), null);
  assert.equal(normalizeTriggerProfile('  system  '), null);
  assert.equal(normalizeTriggerProfile('SYSTEM'), null);
  assert.equal(normalizeTriggerProfile('Ainekio'), 'Ainekio');
});

test('Agent Runtime adapter is valid and rejects obsolete options', async () => {
  assert.equal(agent.meta, meta);
  assert.equal(agent.run, run);
  assert.equal(meta.id, 'daydreamer');
  const result = await run(
    { username: 'unused-test-user', dataDir: '/tmp' },
    { args: ['--force'] },
  );
  assert.equal(result.success, false);
  assert.match(result.error || '', /does not accept runtime options: --force/);
});

test('graph evaluation follows node types and requires both persistence owners', () => {
  assert.deepEqual(evaluateDaydreamerGraph(graph, graphState()), {
    daydreamsGenerated: 1,
    memoriesCurated: 5,
    avgAgeDays: 12,
  });

  assert.throws(
    () => evaluateDaydreamerGraph(graph, graphState({ dreamer_dream_saver: { saved: false, error: 'disk full' } })),
    /Episodic daydream persistence failed: disk full/,
  );
  assert.throws(
    () => evaluateDaydreamerGraph(graph, graphState({ inner_dialogue_buffer: { saved: false, error: 'buffer unavailable' } })),
    /Inner-dialogue persistence failed: buffer unavailable/,
  );
});

test('insufficient memory is an explicit successful skip, not a fabricated generation', () => {
  assert.deepEqual(
    evaluateDaydreamerGraph(graph, graphState({ dreamer_memory_curator: { count: 2, avgAgeDays: 3 } })),
    {
      daydreamsGenerated: 0,
      memoriesCurated: 2,
      avgAgeDays: 3,
      skippedReason: 'insufficient_memories',
    },
  );
});

test('failed graph execution is surfaced to the coordinator', () => {
  const failed = graphState({}, 'failed');
  failed.nodes.set(nodeIds.daydreamer_generator, {
    nodeId: nodeIds.daydreamer_generator,
    status: 'failed',
    startTime: 0,
    endTime: 1,
    inputs: {},
    error: new Error('model unavailable'),
  });

  assert.throws(
    () => evaluateDaydreamerGraph(graph, failed),
    /generator-arbitrary-id: model unavailable/,
  );
});
