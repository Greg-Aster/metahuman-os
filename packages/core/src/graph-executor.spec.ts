import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SvelteFlowGraph } from './cognitive-graph-schema.js'
import type { NodeDefinition } from './nodes/types.js'

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-executor-contracts-'))
process.env.METAHUMAN_ROOT = isolatedRoot
globalThis.fetch = async () => { throw new Error('Network access is forbidden in executor contract tests') }
const { ROOT } = await import('./path-builder.js')
assert.equal(ROOT, isolatedRoot)
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { executeGraph } = await import('./graph-executor.js')
const { nodeExecutors, nodeRegistry } = await import('./nodes/index.js')
const { defineNode } = await import('./nodes/types.js')
const { ExecutionStore } = await import('./durable-execution/store.js')
const { executionDefinition } = await import('./durable-execution/graph-contract.js')
after(() => eventBus.disconnect())

function testNode(
  id: string,
  inputs: NodeDefinition['inputs'],
  outputs: NodeDefinition['outputs'],
  execute: NodeDefinition['execute'],
): NodeDefinition {
  return defineNode({
    id,
    name: id,
    category: 'utility',
    inputs,
    outputs,
    description: `Scheduler test node ${id}`,
    execute,
  })
}

async function withTestNodes<T>(nodes: NodeDefinition[], run: () => Promise<T>): Promise<T> {
  for (const node of nodes) {
    nodeRegistry.set(node.id, node)
    nodeExecutors.set(node.id, node.execute)
  }

  try {
    return await run()
  } finally {
    for (const node of nodes) {
      nodeRegistry.delete(node.id)
      nodeExecutors.delete(node.id)
    }
  }
}

function graph(
  nodes: Array<{ id: string; nodeType: string; activation?: Record<string, unknown> }>,
  edges: SvelteFlowGraph['edges'],
): SvelteFlowGraph {
  return {
    version: '1.0',
    format: 'svelte-flow',
    name: 'scheduler-test',
    scheduler: {
      version: 1,
      activation: 'demand',
      skippedState: 'explicit',
      sideEffectOrder: 'serial-topological',
      maxLoopIterations: 5,
    },
    nodes: nodes.map((node, index) => ({
      id: node.id,
      type: 'genericNode',
      position: { x: index * 100, y: 0 },
      data: {
        label: node.id,
        nodeType: node.nodeType,
        properties: {},
        activation: node.activation,
      },
    })),
    edges,
  }
}

test('the canonical executor resumes saved nodes with their persisted properties and original inputs', async () => {
  let plans = 0
  let fail = true
  const plan = defineNode({
    id: 'test_durable_plan', name: 'durable plan', category: 'utility', description: 'Durable owner fixture',
    inputs: [], outputs: [{ name: 'value', type: 'number' }],
    propertySchemas: { value: { type: 'number', default: 1 } },
    execute: async (_inputs, context, properties) => {
      plans++
      context.graphExecution.dispatch({ kind: 'test-effect', actionId: 'durable-test-action', payload: { value: properties?.value } })
      return { value: properties?.value }
    },
  })
  const review = testNode('test_durable_review', [{ name: 'value', type: 'number' }], [{ name: 'response', type: 'string' }], async (inputs, context) => {
    if (fail) throw new Error('Injected interruption before review succeeds')
    return { response: `${context.userMessage}:${inputs.value}` }
  })
  await withTestNodes([plan, review], async () => {
    const workflow = graph([{ id: 'plan', nodeType: plan.id }, { id: 'review', nodeType: review.id }], [
      { id: 'value', source: 'plan', sourceHandle: 'value', target: 'review', targetHandle: 'value' },
    ])
    workflow.nodes[0].data.properties = { value: 7 }
    const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-durable-graph-')), 'execution.sqlite')
    let store = new ExecutionStore(filename)
    const definition = executionDefinition(workflow)
    const execution = store.create('test-user', definition)
    let lease = store.claim(execution.executionId, definition)
    const first = await executeGraph(workflow, { userMessage: 'original input' }, undefined, undefined, { store, lease })
    assert.equal(first.status, 'failed')
    assert.equal(plans, 1)
    assert.equal(store.pendingDispatches().length, 1)
    store.release(lease)
    store.close()

    fail = false
    store = new ExecutionStore(filename)
    lease = store.claim(execution.executionId, definition)
    const second = await executeGraph(workflow, { userMessage: 'unrelated new context' }, undefined, undefined, { store, lease, resume: true })
    assert.equal(second.status, 'completed')
    assert.equal(second.nodes.get('review')?.outputs?.response, 'original input:7')
    assert.equal(plans, 1, 'checkpointed successful node is not executed again')
    assert.equal(store.pendingDispatches().length, 1, 'dispatch intent is not duplicated')
    store.release(lease)
    store.close()
  })
})

test('actual child graphs wait and recover in the same parent thread without repeating a dispatch', async () => {
  let plans = 0
  let reviews = 0
  const plan = testNode('test_child_plan', [], [{ name: 'action', type: 'object' }], async (_inputs, context) => {
    plans++
    const action = context.graphExecution.dispatch({ kind: 'test-action', payload: { objective: context.userMessage }, actionId: 'child-action' })
    return { action }
  })
  const wait = testNode('test_child_wait', [{ name: 'action', type: 'object' }], [{ name: 'result', type: 'object' }], async (_inputs, context) => ({ result: context.graphExecution.waitForEvent() }))
  const review = testNode('test_child_result', [{ name: 'result', type: 'object' }], [{ name: 'response', type: 'string' }], async (inputs, context) => {
    reviews++
    return { response: `${context.userMessage}:${inputs.result.payload.evidence}` }
  })
  const child = graph([{ id: 'plan', nodeType: plan.id }, { id: 'wait', nodeType: wait.id }, { id: 'review', nodeType: review.id }], [
    { id: 'plan-wait', source: 'plan', sourceHandle: 'action', target: 'wait', targetHandle: 'action' },
    { id: 'wait-review', source: 'wait', sourceHandle: 'result', target: 'review', targetHandle: 'result' },
  ])
  child.name = 'child-workflow'
  const call = testNode('test_parent_call', [], [{ name: 'response', type: 'string' }], async (_inputs, context) => {
    const result = await context.graphExecution.callGraph(child, { userMessage: context.userMessage })
    return result.nodes.get('review').outputs
  })
  await withTestNodes([plan, wait, review, call], async () => {
    const parent = graph([{ id: 'call', nodeType: call.id }], [])
    parent.name = 'parent-workflow'
    const filename = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-child-workflows-')), 'execution.sqlite')
    let store = new ExecutionStore(filename)
    const definition = executionDefinition(parent)
    const execution = store.create('fixture', definition)
    let lease = store.claim(execution.executionId, definition)
    const paused = await executeGraph(parent, { userMessage: 'locate object' }, undefined, undefined, { store, lease })
    assert.equal(paused.status, 'waiting')
    assert.equal(plans, 1)
    assert.equal(reviews, 0)
    assert.equal(store.pendingDispatches().length, 1)
    const namespaces = store.db.prepare('SELECT DISTINCT checkpoint_ns FROM checkpoints').all() as any[]
    assert.ok(namespaces.some(row => row.checkpoint_ns !== ''))
    store.release(lease)
    store.close()
    store = new ExecutionStore(filename)
    lease = store.claim(execution.executionId, definition)
    store.appendEvent(execution.executionId, { eventId: 'physical-result', kind: 'physical_result', actionId: 'child-action', payload: { evidence: 'observed' } })
    const resumed = await executeGraph(parent, { userMessage: 'unrelated replacement' }, undefined, undefined, { store, lease, resumeEventId: 'physical-result' })
    assert.equal(resumed.status, 'completed')
    assert.equal(resumed.nodes.get('call')?.outputs?.response, 'locate object:observed')
    assert.equal(plans, 1)
    assert.equal(reviews, 1)
    assert.equal(store.get(execution.executionId).lastProcessedSequence, 1)
    store.release(lease)
    store.close()
  })
})

test('scheduler invokes only the selected branch and reports the other branch as skipped', async () => {
  const calls: string[] = []
  const events: string[] = []
  const nodes = [
    testNode('test_branch_source', [], [
      { name: 'branch', type: 'string' },
      { name: 'value', type: 'number' },
    ], async () => {
      calls.push('source')
      return { branch: 'left', value: 0 }
    }),
    testNode('test_left_effect', [{ name: 'value', type: 'number' }], [{ name: 'done', type: 'boolean' }], async (inputs) => {
      calls.push(`left:${inputs.value}`)
      return { done: true }
    }),
    testNode('test_right_effect', [{ name: 'value', type: 'number' }], [{ name: 'done', type: 'boolean' }], async () => {
      calls.push('right')
      return { done: true }
    }),
  ]

  await withTestNodes(nodes, async () => {
    const state = await executeGraph(graph([
      { id: 'source', nodeType: 'test_branch_source' },
      { id: 'left', nodeType: 'test_left_effect' },
      { id: 'right', nodeType: 'test_right_effect' },
    ], [
      {
        id: 'left-edge', source: 'source', target: 'left', sourceHandle: 'value', targetHandle: 'value',
        data: { when: { output: 'branch', equals: 'left' } },
      },
      {
        id: 'right-edge', source: 'source', target: 'right', sourceHandle: 'value', targetHandle: 'value',
        data: { when: { output: 'branch', equals: 'right' } },
      },
    ]), {}, event => events.push(`${event.type}:${event.nodeId ?? ''}`))

    assert.equal(state.status, 'completed')
    assert.deepEqual(calls, ['source', 'left:0'])
    assert.equal(state.nodes.get('left')?.status, 'completed')
    assert.equal(state.nodes.get('right')?.status, 'skipped')
    assert.match(state.nodes.get('right')?.skipReason ?? '', /inactive/i)
    assert.ok(events.includes('node_skip:right'))
  })
})

test('scheduler requires every declared input and treats false as active data', async () => {
  let sinkCalls = 0
  const nodes = [
    testNode('test_false_source', [], [{ name: 'value', type: 'boolean' }], async () => ({ value: false })),
    testNode('test_missing_source', [], [{ name: 'value', type: 'string', optional: true }], async () => ({})),
    testNode('test_required_sink', [
      { name: 'flag', type: 'boolean' },
      { name: 'message', type: 'string' },
    ], [{ name: 'done', type: 'boolean' }], async () => {
      sinkCalls++
      return { done: true }
    }),
  ]

  await withTestNodes(nodes, async () => {
    const state = await executeGraph(graph([
      { id: 'false-source', nodeType: 'test_false_source' },
      { id: 'missing-source', nodeType: 'test_missing_source' },
      { id: 'sink', nodeType: 'test_required_sink' },
    ], [
      { id: 'flag', source: 'false-source', target: 'sink', sourceHandle: 'value', targetHandle: 'flag' },
      { id: 'message', source: 'missing-source', target: 'sink', sourceHandle: 'value', targetHandle: 'message' },
    ]), {})

    assert.equal(sinkCalls, 0)
    assert.equal(state.nodes.get('sink')?.status, 'skipped')
    assert.match(state.nodes.get('sink')?.skipReason ?? '', /message/)
  })
})

test('node activation conditions gate an otherwise ready branch', async () => {
  let gatedCalls = 0
  const nodes = [
    testNode('test_gate_source', [], [
      { name: 'enabled', type: 'boolean' },
      { name: 'value', type: 'string' },
    ], async () => ({ enabled: false, value: 'available' })),
    testNode('test_gated_sink', [{ name: 'value', type: 'string' }], [{ name: 'done', type: 'boolean' }], async () => {
      gatedCalls++
      return { done: true }
    }),
  ]

  await withTestNodes(nodes, async () => {
    const state = await executeGraph(graph([
      { id: 'gate', nodeType: 'test_gate_source' },
      {
        id: 'gated',
        nodeType: 'test_gated_sink',
        activation: { when: [{ nodeId: 'gate', output: 'enabled', equals: true }] },
      },
    ], [
      { id: 'gate-data', source: 'gate', target: 'gated', sourceHandle: 'value', targetHandle: 'value' },
    ]), {})

    assert.equal(gatedCalls, 0)
    assert.equal(state.nodes.get('gated')?.status, 'skipped')
    assert.match(state.nodes.get('gated')?.skipReason ?? '', /condition/i)
  })
})

test('scheduler honors explicit loop edges and executes control dependencies serially', async () => {
  const calls: string[] = []
  let pass = 0
  const nodes = [
    testNode('test_loop_seed', [], [{ name: 'value', type: 'number' }], async () => ({ value: 1 })),
    testNode('test_loop_body', [{ name: 'value', type: 'number' }], [{ name: 'value', type: 'number' }], async () => {
      calls.push('body')
      return { value: ++pass }
    }),
    testNode('test_loop_router', [{ name: 'value', type: 'number' }], [
      { name: 'value', type: 'number' },
      { name: 'route', type: 'string' },
    ], async (inputs) => {
      calls.push('router')
      return { value: inputs.value, route: pass < 2 ? 'loop' : 'done' }
    }),
    testNode('test_effect_a', [{ name: 'value', type: 'number' }], [{ name: 'done', type: 'boolean' }], async () => {
      calls.push('effect-a')
      return { done: true }
    }),
    testNode('test_effect_b', [], [{ name: 'done', type: 'boolean' }], async () => {
      calls.push('effect-b')
      return { done: true }
    }),
  ]

  await withTestNodes(nodes, async () => {
    const state = await executeGraph(graph([
      { id: 'seed', nodeType: 'test_loop_seed' },
      { id: 'body', nodeType: 'test_loop_body' },
      { id: 'router', nodeType: 'test_loop_router' },
      { id: 'effect-a', nodeType: 'test_effect_a' },
      { id: 'effect-b', nodeType: 'test_effect_b' },
    ], [
      { id: 'seed-body', source: 'seed', target: 'body', sourceHandle: 'value', targetHandle: 'value' },
      { id: 'body-router', source: 'body', target: 'router', sourceHandle: 'value', targetHandle: 'value' },
      {
        id: 'router-loop', source: 'router', target: 'body', sourceHandle: 'value', targetHandle: 'value',
        data: { loop: true, when: { output: 'route', equals: 'loop' } },
      },
      {
        id: 'router-effect', source: 'router', target: 'effect-a', sourceHandle: 'value', targetHandle: 'value',
        data: { when: { output: 'route', equals: 'done' } },
      },
      {
        id: 'effects-order', source: 'effect-a', target: 'effect-b', sourceHandle: 'done', targetHandle: '',
        data: { kind: 'control' },
      },
    ]), {})

    assert.equal(state.status, 'completed')
    assert.deepEqual(calls, ['body', 'router', 'body', 'router', 'effect-a', 'effect-b'])
  })
})

test('legacy router names and comments cannot silently declare a loop', async () => {
  const nodes = [
    testNode('test_legacy_loop_a', [{ name: 'value', type: 'number' }], [{ name: 'value', type: 'number' }], async inputs => ({ value: inputs.value })),
    testNode('test_legacy_loop_b', [{ name: 'value', type: 'number' }], [{ name: 'value', type: 'number' }], async inputs => ({ value: inputs.value })),
  ]

  await withTestNodes(nodes, async () => {
    await assert.rejects(
      executeGraph(graph([
        { id: 'a', nodeType: 'test_legacy_loop_a' },
        { id: 'b', nodeType: 'test_legacy_loop_b' },
      ], [
        { id: 'a-b', source: 'a', target: 'b', sourceHandle: 'value', targetHandle: 'value' },
        {
          id: 'b-a', source: 'b', target: 'a', sourceHandle: 'value', targetHandle: 'value',
          data: { comment: 'BACK-EDGE' },
        },
      ]), {}),
      /undeclared circular dependency/i,
    )
  })
})

test('activation-only dependencies participate in cycle detection', async () => {
  const nodes = [
    testNode('test_activation_cycle_a', [], [{ name: 'ready', type: 'boolean' }], async () => ({ ready: true })),
    testNode('test_activation_cycle_b', [], [{ name: 'ready', type: 'boolean' }], async () => ({ ready: true })),
  ]

  await withTestNodes(nodes, async () => {
    await assert.rejects(
      executeGraph(graph([
        {
          id: 'a',
          nodeType: 'test_activation_cycle_a',
          activation: { when: [{ nodeId: 'b', output: 'ready', equals: true }] },
        },
        {
          id: 'b',
          nodeType: 'test_activation_cycle_b',
          activation: { when: [{ nodeId: 'a', output: 'ready', equals: true }] },
        },
      ], []), {}),
      /undeclared circular dependency/i,
    )
  })
})

test('editor-only annotations are reported as skipped and never invoke their executor', async () => {
  let calls = 0
  const annotation = defineNode({
    id: 'test_editor_annotation',
    name: 'editor annotation',
    category: 'utility',
    inputs: [],
    outputs: [],
    description: 'Scheduler test editor annotation',
    editorOnly: true,
    execute: async () => {
      calls++
      return {}
    },
  })

  await withTestNodes([annotation], async () => {
    const state = await executeGraph(graph([
      { id: 'annotation', nodeType: annotation.id },
    ], []), {})
    assert.equal(calls, 0)
    assert.equal(state.nodes.get('annotation')?.status, 'skipped')
    assert.match(state.nodes.get('annotation')?.skipReason || '', /editor-only/i)
  })
})

test('node completion events include the measured node duration', async () => {
  const durationNode = testNode('test_duration_event', [], [{ name: 'done', type: 'boolean' }], async () => ({ done: true }))
  await withTestNodes([durationNode], async () => {
    const events: any[] = []
    await executeGraph(graph([{ id: 'duration', nodeType: durationNode.id }], []), {}, event => events.push(event))
    const completed = events.find(event => event.type === 'node_complete')
    assert.equal(typeof completed?.data?.durationMs, 'number')
    assert(completed.data.durationMs >= 0)
  })
})
