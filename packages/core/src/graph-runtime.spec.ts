import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphExecutionState } from './graph-executor.js'
import { requireGraphNodeOutput } from './graph-runtime.js'

function state(nodes: GraphExecutionState['nodes']): GraphExecutionState {
  return { nodes, startTime: 0, status: 'completed' }
}

test('graph owners resolve outputs by stable node type rather than visual id', () => {
  const graphState = state(new Map([
    ['renumbered-node', {
      nodeId: 'renumbered-node',
      status: 'completed',
      definition: { type: 'desire_plan_generator' },
      outputs: { plan: { id: 'plan-1' } },
    }],
  ]))

  assert.deepEqual(
    requireGraphNodeOutput(graphState, 'desire_plan_generator'),
    { plan: { id: 'plan-1' } },
  )
})

test('graph output contracts fail on missing, ambiguous, failed, or empty owners', () => {
  assert.throws(
    () => requireGraphNodeOutput(state(new Map()), 'owner'),
    /found 0/,
  )

  assert.throws(
    () => requireGraphNodeOutput(state(new Map([
      ['1', { nodeId: '1', status: 'completed', definition: { type: 'owner' }, outputs: {} }],
      ['2', { nodeId: '2', status: 'completed', definition: { type: 'owner' }, outputs: {} }],
    ])), 'owner'),
    /found 2/,
  )

  assert.throws(
    () => requireGraphNodeOutput(state(new Map([
      ['1', { nodeId: '1', status: 'failed', definition: { type: 'owner' } }],
    ])), 'owner'),
    /status failed/,
  )

  assert.throws(
    () => requireGraphNodeOutput(state(new Map([
      ['1', { nodeId: '1', status: 'completed', definition: { type: 'owner' } }],
    ])), 'owner'),
    /produced no outputs/,
  )
})
