import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_GRAPH_SCHEDULER,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core'
import {
  buildDreamerGraphContext,
  evaluateDreamerGraph,
  parseDreamerArgs,
  run,
  taskTriggerKind,
} from './core.js'
import agent, { meta } from './index.js'

const nodeIds = {
  dreamer_memory_curator: 'curator-editable-id',
  dreamer_dream_generator: 'generator-editable-id',
  dreamer_continuation_generator: 'continuation-editable-id',
  dreamer_dream_saver: 'saver-editable-id',
  inner_dialogue_buffer: 'buffer-editable-id',
} as const

const graph = {
  version: '1.0',
  format: 'svelte-flow',
  name: 'Dreamer contract fixture',
  cognitiveMode: 'agent',
  scheduler: { ...DEFAULT_GRAPH_SCHEDULER },
  nodes: Object.entries(nodeIds).map(([nodeType, id]) => ({
    id,
    type: 'cognitiveNode',
    position: { x: 0, y: 0 },
    data: { label: nodeType, nodeType, properties: {} },
  })),
  edges: [],
} as SvelteFlowGraph

const successfulOutputs: Record<keyof typeof nodeIds, Record<string, any>> = {
  dreamer_memory_curator: { count: 5, avgAgeDays: 12, oldestAgeDays: 40 },
  dreamer_dream_generator: { dream: 'An initial dream.' },
  dreamer_continuation_generator: {
    count: 2,
    dreams: [
      { dream: 'Continuation one.', index: 1 },
      { dream: 'Continuation two.', index: 2 },
    ],
  },
  dreamer_dream_saver: {
    saved: true,
    savedCount: 3,
    bufferEntries: [
      { role: 'dream' },
      { role: 'reasoning' },
      { role: 'dream' },
      { role: 'dream' },
    ],
  },
  inner_dialogue_buffer: { saved: true, savedCount: 4, roleCounts: { dream: 3, reasoning: 1 } },
}

function graphState(
  overrides: Partial<typeof successfulOutputs> = {},
  status: GraphExecutionState['status'] = 'completed',
): GraphExecutionState {
  const outputs = { ...successfulOutputs, ...overrides }
  const nodes = new Map(
    Object.entries(nodeIds).map(([nodeType, id]) => [id, {
      nodeId: id,
      status: 'completed',
      startTime: 0,
      endTime: 1,
      inputs: {},
      outputs: outputs[nodeType as keyof typeof successfulOutputs],
    }]),
  )
  return { nodes, startTime: 0, endTime: 1, status } as GraphExecutionState
}

test('Dreamer graph evaluation follows node types and requires both persistence owners', () => {
  assert.deepEqual(evaluateDreamerGraph(graph, graphState(), 3), {
    dreamsGenerated: 3,
    memoriesCurated: 5,
    continuationCount: 2,
    avgAgeDays: 12,
    oldestAgeDays: 40,
  })

  assert.throws(
    () => evaluateDreamerGraph(graph, graphState({
      dreamer_dream_saver: { saved: false, savedCount: 0, error: 'disk full' },
    }), 3),
    /Dream persistence failed: disk full/,
  )
  assert.throws(
    () => evaluateDreamerGraph(graph, graphState({
      inner_dialogue_buffer: { saved: false, error: 'buffer unavailable' },
    }), 3),
    /Inner-dialogue persistence failed: buffer unavailable/,
  )
})

test('Dreamer treats insufficient memory as an explicit skip', () => {
  assert.deepEqual(
    evaluateDreamerGraph(graph, graphState({ dreamer_memory_curator: {
      count: 2,
      avgAgeDays: 3,
      oldestAgeDays: 5,
    } }), 3),
    {
      dreamsGenerated: 0,
      memoriesCurated: 2,
      continuationCount: 0,
      avgAgeDays: 3,
      oldestAgeDays: 5,
      skippedReason: 'insufficient_memories',
    },
  )
})

test('Dreamer surfaces graph failures and configured-limit violations', () => {
  const failed = graphState({}, 'failed')
  failed.nodes.set(nodeIds.dreamer_dream_generator, {
    nodeId: nodeIds.dreamer_dream_generator,
    status: 'failed',
    startTime: 0,
    endTime: 1,
    inputs: {},
    error: new Error('model unavailable'),
  })
  assert.throws(() => evaluateDreamerGraph(graph, failed, 3), /model unavailable/)
  assert.throws(() => evaluateDreamerGraph(graph, graphState(), 2), /configured limit of 2/)
})

test('Dreamer exposes one strict runtime contract', () => {
  assert.equal(agent.meta, meta)
  assert.equal(agent.run, run)
  assert.equal(meta.id, 'dreamer')
  assert.equal(meta.defaultInterval, undefined)
  assert.deepEqual(parseDreamerArgs([], {}), {})
  assert.deepEqual(parseDreamerArgs(['--force'], {}), { forceRun: true })
  assert.throws(() => parseDreamerArgs(['--single-user']), /Unknown dreamer option/)
  assert.equal(taskTriggerKind('{"triggeredBy":"sleep-workflow"}'), 'sleep-workflow')
  assert.equal(taskTriggerKind('{"triggeredBy":"manual"}'), 'manual')
  assert.throws(() => taskTriggerKind('{invalid'), /valid JSON/)
})

test('Dreamer carries the Work Coordinator retry identity into graph persistence', () => {
  const executionTimestamp = '2026-09-02T12:34:56.000Z'
  const parsed = parseDreamerArgs([], {
    MH_TRIGGER_USERNAME: 'test-profile',
    MH_TASK_ID: 'dream-task-stable',
    MH_TASK_CREATED_AT: executionTimestamp,
  })
  assert.deepEqual(parsed, {
    username: 'test-profile',
    executionId: 'dream-task-stable',
    executionTimestamp,
  })

  const context = buildDreamerGraphContext('test-profile', 3, parsed)
  assert.equal(context.idempotencyKey, 'dreamer:test-profile:dream-task-stable')
  assert.equal(context.memoryTimestamp, executionTimestamp)
  assert.equal(context.maxDreams, 3)
})
