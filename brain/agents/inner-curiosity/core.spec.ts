import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  GraphExecutionState,
  GraphRunParams,
  NodeExecutionState,
  SvelteFlowGraph,
} from '@metahuman/core'
import {
  executeInnerCuriosityForUser,
  parseInnerCuriosityArgs,
  runInnerCuriosity,
  type InnerCuriosityDependencies,
} from './core.js'

const NOW = '2026-08-28T12:00:00.000Z'
const GRAPH = {
  version: '1.0',
  format: 'svelte-flow',
  scheduler: {
    version: 1,
    activation: 'demand',
    skippedState: 'explicit',
    sideEffectOrder: 'serial-topological',
    maxLoopIterations: 5,
  },
  name: 'Inner Curiosity Test Graph',
  nodes: [],
  edges: [],
} as SvelteFlowGraph

function node(
  nodeId: string,
  nodeType: string,
  status: NodeExecutionState['status'],
  outputs?: Record<string, unknown>,
  error?: Error,
): [string, NodeExecutionState] {
  return [nodeId, {
    nodeId,
    status,
    definition: { type: nodeType },
    ...(outputs ? { outputs } : {}),
    ...(error ? { error } : {}),
  }]
}

function graphState(
  entries: Array<[string, NodeExecutionState]>,
  status: GraphExecutionState['status'] = 'completed',
): GraphExecutionState {
  return { nodes: new Map(entries), startTime: 0, endTime: 1, status }
}

function generatedState(deduplicated = false): GraphExecutionState {
  return graphState([
    node('state', 'inner_curiosity_state', 'completed', {
      status: deduplicated ? 'prepared' : 'new',
      execution: {
        username: 'test-user',
        executionId: 'task-stable',
      },
    }),
    node('sample', 'curiosity_weighted_sampler', deduplicated ? 'skipped' : 'completed', {
      count: 1,
    }),
    node('no-memories', 'inner_curiosity_no_memories', 'skipped'),
    node('complete', 'inner_curiosity_complete', 'completed', {
      outcome: {
        status: 'generated',
        username: 'test-user',
        executionId: 'task-stable',
        deduplicated,
        memoriesConsidered: 1,
        searchResults: 1,
        followOn: {
          admitted: false,
          skipped: true,
          reason: 'probability',
          probability: 0.2,
          roll: 0.8,
        },
      },
    }),
  ])
}

function dependencies(
  state: GraphExecutionState,
  overrides: Partial<InnerCuriosityDependencies> = {},
): InnerCuriosityDependencies {
  return {
    loadGraph: async () => ({ graph: GRAPH, source: '/test/inner-curiosity.json' }),
    executeGraph: async (_params: GraphRunParams) => state,
    resolveUserId: () => 'test-user-id',
    now: () => new Date(NOW),
    newExecutionId: () => 'execution-generated',
    ...overrides,
  }
}

test('Inner Curiosity delegates one authenticated cycle to its canonical graph', async () => {
  let received: GraphRunParams | undefined
  const deps = dependencies(generatedState(), {
    executeGraph: async params => {
      received = params
      return generatedState()
    },
  })

  const result = await executeInnerCuriosityForUser('test-user', {
    executionId: 'task-stable',
    executionTimestamp: NOW,
  }, deps)

  assert.deepEqual(result, {
    status: 'generated',
    username: 'test-user',
    executionId: 'task-stable',
    deduplicated: false,
    memoriesConsidered: 1,
    searchResults: 1,
    followOn: {
      admitted: false,
      skipped: true,
      reason: 'probability',
      probability: 0.2,
      roll: 0.8,
    },
  })
  assert.equal(received?.graph, GRAPH)
  assert.equal(received?.context.username, 'test-user')
  assert.equal(received?.context.userId, 'test-user-id')
  assert.equal(received?.context.executionId, 'task-stable')
  assert.equal(received?.context.executionTimestamp, NOW)
  assert.equal(received?.context.requestedExecutionTimestamp, NOW)
  assert.equal(received?.context.idempotencyKey, 'inner-curiosity:test-user:task-stable')
  assert.equal(received?.context.recordPersonaMemory, true)
  assert.equal(received?.context.allowMemoryWrites, true)
})

test('completed receipts and empty samples become explicit graph-owned outcomes', async t => {
  await t.test('completed receipt', async () => {
    const state = graphState([
      node('state', 'inner_curiosity_state', 'completed', {
        outcome: {
          status: 'generated',
          username: 'test-user',
          executionId: 'task-stable',
          deduplicated: true,
          memoriesConsidered: 2,
          searchResults: 4,
        },
      }),
      node('sample', 'curiosity_weighted_sampler', 'skipped'),
      node('no-memories', 'inner_curiosity_no_memories', 'skipped'),
      node('complete', 'inner_curiosity_complete', 'skipped'),
    ])
    const result = await executeInnerCuriosityForUser(
      'test-user',
      { executionId: 'task-stable' },
      dependencies(state),
    )
    assert.equal(result.status, 'generated')
    if (result.status === 'generated') assert.equal(result.deduplicated, true)
  })

  await t.test('no memories', async () => {
    const state = graphState([
      node('state', 'inner_curiosity_state', 'completed', {
        execution: { username: 'test-user', executionId: 'task-stable' },
      }),
      node('sample', 'curiosity_weighted_sampler', 'completed', { count: 0 }),
      node('no-memories', 'inner_curiosity_no_memories', 'completed', {
        outcome: {
          status: 'skipped',
          username: 'test-user',
          executionId: 'task-stable',
          reason: 'no-memories',
        },
      }),
      node('complete', 'inner_curiosity_complete', 'skipped'),
    ])
    const result = await executeInnerCuriosityForUser(
      'test-user',
      { executionId: 'task-stable' },
      dependencies(state),
    )
    assert.deepEqual(result, {
      status: 'skipped',
      username: 'test-user',
      executionId: 'task-stable',
      reason: 'no-memories',
    })
  })
})

test('graph load, execution, and output contract failures remain failures', async t => {
  await t.test('missing graph', async () => {
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', {}, dependencies(generatedState(), {
        loadGraph: async () => null,
      })),
      /could not be loaded/,
    )
  })

  await t.test('failed node', async () => {
    const state = graphState([
      node('question', 'inner_curiosity_question_generator', 'failed', undefined, new Error('model unavailable')),
    ], 'failed')
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', {}, dependencies(state)),
      /question: model unavailable/,
    )
  })

  await t.test('malformed outcome', async () => {
    const state = generatedState()
    state.nodes.get('complete')!.outputs = { outcome: { status: 'generated' } }
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', {}, dependencies(state)),
      /outcome username/,
    )
  })
})

test('identity, cancellation, and private CLI arguments are validated before cognition', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(
    executeInnerCuriosityForUser('test-user', { signal: controller.signal }, dependencies(generatedState())),
    /cancelled by test/,
  )

  await assert.rejects(
    executeInnerCuriosityForUser('test-user', { executionTimestamp: 'not-a-date' }, dependencies(generatedState())),
    /must be a valid date/,
  )
  await assert.rejects(runInnerCuriosity({}), /requires a resolved username/)
  assert.throws(() => parseInnerCuriosityArgs(['--legacy']), /Unknown inner-curiosity option/)
  assert.deepEqual(parseInnerCuriosityArgs([], {
    MH_TRIGGER_USERNAME: 'test-user',
    MH_TASK_ID: 'task-stable',
    MH_TASK_CREATED_AT: NOW,
  }), {
    username: 'test-user',
    executionId: 'task-stable',
    executionTimestamp: NOW,
  })
})
