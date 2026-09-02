import assert from 'node:assert/strict'
import test from 'node:test'

import { setAuditEnabled, type GraphExecutionState, type SvelteFlowGraph } from '@metahuman/core'
import {
  evaluateTrainOfThoughtGraph,
  parseTrainOfThoughtArgs,
  runTrainOfThought,
  type TrainOfThoughtDependencies,
} from './core.js'

setAuditEnabled(false)

const NOW = '2026-08-29T12:00:00.000Z'
const graph: SvelteFlowGraph = {
  version: '1.0',
  format: 'svelte-flow',
  name: 'test train',
  cognitiveMode: 'agent',
  nodes: [
    { id: 'aggregate', type: 'cognitiveNode', position: { x: 0, y: 0 }, data: { label: 'aggregate', nodeType: 'thought_aggregator', properties: {} } },
    { id: 'persist', type: 'outputNode', position: { x: 1, y: 0 }, data: { label: 'persist', nodeType: 'inner_dialogue_buffer', properties: {} } },
  ],
  edges: [],
}

function completedState(overrides: Record<string, Record<string, any>> = {}): GraphExecutionState {
  const nodes = new Map<string, any>([
    ['aggregate', {
      nodeId: 'aggregate',
      status: 'completed',
      outputs: {
        result: 'A coherent chain.',
        insight: 'A new grounded connection.',
        thoughtCount: 3,
        ...overrides.aggregate,
      },
      definition: { type: 'thought_aggregator' },
    }],
    ['persist', {
      nodeId: 'persist',
      status: 'completed',
      outputs: {
        saved: true,
        persisted: true,
        eventId: 'evt-train',
        eventPath: 'memory/episodic/train.json',
        ...overrides.persist,
      },
      definition: { type: 'inner_dialogue_buffer' },
    }],
  ])
  return { nodes, startTime: 0, endTime: 1, status: 'completed' }
}

function dependencies(overrides: Partial<TrainOfThoughtDependencies> = {}): TrainOfThoughtDependencies {
  return {
    resolveTargetUser: () => ({ userId: 'user-id', username: 'test-user', role: 'owner' }),
    sampleSeed: async () => 'A sampled historical memory.',
    loadGraph: async () => graph,
    executeGraph: async () => completedState(),
    runWithUserContext: (async (_user: unknown, operation: () => Promise<any>) => operation()) as any,
    newExecutionId: () => 'execution-generated',
    now: () => NOW,
    ...overrides,
  }
}

test('Train of Thought uses an upstream result as the exact graph seed', async () => {
  let graphContext: Record<string, any> | undefined
  const outcome = await runTrainOfThought({
    username: 'test-user',
    seed: 'A persisted reflection.',
    sourceAgent: 'reflector',
    executionId: 'parent-execution',
    executionTimestamp: NOW,
  }, dependencies({
    sampleSeed: async () => { throw new Error('manual sampler must not run') },
    executeGraph: async params => {
      graphContext = params.context
      return completedState()
    },
  }))

  assert.equal(outcome.status, 'generated')
  if (outcome.status !== 'generated') return
  assert.equal(outcome.seedSource, 'supplied')
  assert.equal(outcome.sourceAgent, 'reflector')
  assert.equal(outcome.thoughtCount, 3)
  assert.equal(graphContext?.seedMemory, 'A persisted reflection.')
  assert.equal(graphContext?.username, 'test-user')
  assert.equal(graphContext?.idempotencyKey, 'train-of-thought:test-user:parent-execution')
})

test('manual Train of Thought uses the bounded canonical memory sampler and skips honestly when empty', async () => {
  let sampleCalls = 0
  const generated = await runTrainOfThought({ username: 'test-user' }, dependencies({
    sampleSeed: async () => { sampleCalls += 1; return 'Historical seed.' },
  }))
  assert.equal(generated.status, 'generated')
  assert.equal(generated.seedSource, 'memory')
  assert.equal(sampleCalls, 1)

  const skipped = await runTrainOfThought({ username: 'test-user' }, dependencies({
    sampleSeed: async () => null,
  }))
  assert.deepEqual(skipped, {
    status: 'skipped',
    reason: 'no-memories',
    username: 'test-user',
    executionId: 'execution-generated',
    seedSource: 'memory',
    sourceAgent: undefined,
  })
})

test('Train of Thought rejects graph and persistence failures', async () => {
  const failed = completedState()
  failed.status = 'failed'
  failed.nodes.set('aggregate', {
    nodeId: 'aggregate',
    status: 'failed',
    error: new Error('model unavailable'),
    definition: { type: 'thought_aggregator' },
  })
  await assert.rejects(
    runTrainOfThought({ username: 'test-user', seed: 'Seed.' }, dependencies({
      executeGraph: async () => failed,
    })),
    /model unavailable/,
  )

  assert.throws(
    () => evaluateTrainOfThoughtGraph(graph, completedState({ persist: { saved: false, persisted: false, error: 'disk full' } }), {
      username: 'test-user',
      executionId: 'execution',
      seedSource: 'supplied',
    }),
    /disk full/,
  )
})

test('Train of Thought CLI parsing consumes coordinator identity and seeded payload', () => {
  assert.deepEqual(parseTrainOfThoughtArgs([], {
    MH_TRIGGER_USERNAME: 'test-user',
    MH_TASK_ID: 'task-follow-on',
    MH_TASK_CREATED_AT: NOW,
    MH_TASK_PAYLOAD: JSON.stringify({
      seed: 'Persisted private result.',
      sourceAgent: 'inner-curiosity',
      executionId: 'inner-curiosity:test-user:execution-1',
    }),
  }), {
    username: 'test-user',
    executionId: 'inner-curiosity:test-user:execution-1',
    executionTimestamp: NOW,
    seed: 'Persisted private result.',
    sourceAgent: 'inner-curiosity',
  })

  assert.deepEqual(parseTrainOfThoughtArgs([
    '--username', 'manual-user',
    '--seed', 'Manual seed.',
    '--source-agent', 'reflector',
  ], {}), {
    username: 'manual-user',
    executionId: undefined,
    executionTimestamp: undefined,
    seed: 'Manual seed.',
    sourceAgent: 'reflector',
  })
  assert.throws(() => parseTrainOfThoughtArgs(['--single-user'], {}), /Unknown train-of-thought option/)
  assert.throws(
    () => parseTrainOfThoughtArgs([], { MH_TASK_PAYLOAD: '{broken' }),
    /valid JSON/,
  )
  assert.throws(
    () => parseTrainOfThoughtArgs(['--source-agent', 'Not Valid'], {}),
    /must be kebab-case/,
  )
})
