import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js'
import type { DiagnosticRequest } from './types.js'

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-diagnostic-context-'))
process.env.METAHUMAN_ROOT = isolatedRoot
globalThis.fetch = async () => { throw new Error('No network in diagnostic context tests') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => eventBus.disconnect())
const { executeGraph } = await import('../graph-executor.js')
const { nodeRegistry, nodeExecutors } = await import('../nodes/index.js')
const { defineNode } = await import('../nodes/types.js')
const { bigBrotherSchema } = await import('../nodes/utility/big-brother.schema.js')
const { buildBigBrotherDiagnostic } = await import('../nodes/utility/big-brother.node.js')

test('diagnostic packet maps numeric node IDs to named sources and preserves distinct empty inputs', async () => {
  let packet: DiagnosticRequest | undefined
  const source = defineNode({
    id: 'diagnostic_fixture_source', name: 'Fixture source', category: 'utility',
    description: 'Fixture request evidence', inputs: [{ name: 'data', type: 'any', optional: true }],
    outputs: [{ name: 'value', type: 'any', description: 'Fixture output evidence' }],
    execute: async (_inputs, context) => ({ value: context.graphNode.id === '23' ? false : '' }),
  })
  const sink = defineNode({
    ...bigBrotherSchema, id: 'diagnostic_fixture_sink',
    execute: async (inputs, context, properties) => {
      packet = buildBigBrotherDiagnostic(inputs, context, properties)
      return { sessionId: 'fixture', submissionId: 'fixture', status: 'submitted' }
    },
  })
  for (const node of [source, sink]) {
    nodeRegistry.set(node.id, node)
    nodeExecutors.set(node.id, node.execute)
  }
  const graph: SvelteFlowGraph = {
    name: 'Diagnostic provenance', version: '1.0', format: 'svelte-flow',
    scheduler: { version: 1, activation: 'demand', skippedState: 'explicit',
      sideEffectOrder: 'serial-topological', maxLoopIterations: 5 },
    nodes: [
      { id: '17', type: 'genericNode', position: { x: 0, y: 0 },
        data: { nodeType: source.id, label: 'User Input', properties: {} } },
      { id: '23', type: 'genericNode', position: { x: 0, y: 100 },
        data: { nodeType: source.id, label: 'Motion Result', properties: {} } },
      { id: '31', type: 'genericNode', position: { x: 100, y: 0 },
        data: { nodeType: sink.id, label: 'Big Brother', properties: {} } },
    ],
    edges: [
      { id: 'input', source: '17', sourceHandle: 'value', target: '31', targetHandle: 'data' },
      { id: 'motion', source: '23', sourceHandle: 'value', target: '31', targetHandle: 'data2' },
      { id: 'inactive', source: '23', sourceHandle: 'value', target: '31', targetHandle: 'data3',
        data: { when: { output: 'value', equals: true } } },
    ],
  }
  const unchanged = JSON.stringify(graph)
  const originalEntry = { role: 'user', content: 'fixture request', timestamp: 'fixture-time' }
  try {
    const result = await executeGraph(graph, { userMessage: 'fixture request', userMessageEntry: originalEntry })
    assert.equal(result.status, 'completed', result.error?.message)
    assert.ok(packet)
    assert.deepEqual(packet.data, { data: '', data2: false })
    assert.equal(packet.source!.originalRequest, 'fixture request')
    assert.deepEqual(packet.source!.originalEntry, originalEntry)
    const metadata = packet.source!.graphNode as any
    assert.equal(metadata.graphName, graph.name)
    assert.equal(metadata.label, 'Big Brother')
    assert.deepEqual(metadata.inputs[0].source, {
      id: '17', type: source.id, label: 'User Input', name: source.name, description: source.description,
    })
    assert.equal(metadata.inputs[0].outputDescription, 'Fixture output evidence')
    assert.equal(metadata.inputs[0].status, 'completed')
    assert.equal(metadata.inputs[0].active, true)
    assert.equal(typeof metadata.inputs[0].durationMs, 'number')
    assert.equal(metadata.inputs[1].source.label, 'Motion Result')
    assert.equal(metadata.inputs[2].active, false)
    assert.equal(JSON.stringify(graph), unchanged, 'Source metadata must not modify the graph')
    const locations = packet.source!.locations as Record<string, string>
    assert.equal(locations.serverLog, path.join(isolatedRoot, 'logs/server.log'))
    assert.equal(locations.agentLogs, path.join(isolatedRoot, 'logs/run/agents'))

    // A branch attached to input can submit before a later node fails without output.
    nodeExecutors.set(source.id, async (_inputs, context) => {
      if (context.graphNode.id === '23') throw new Error('fixture response failure')
      return { value: '' }
    })
    packet = undefined
    graph.nodes = [graph.nodes[0], graph.nodes[2], graph.nodes[1]]
    graph.edges = [graph.edges[0],
      { id: 'later', source: '31', sourceHandle: 'status', target: '23', targetHandle: 'data' }]
    const failed = await executeGraph(graph, { userMessage: 'unanswered request' })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error?.message, 'fixture response failure')
    assert.ok(packet, 'An early diagnostic must survive a later response failure')
    assert.equal((packet as DiagnosticRequest).source!.originalRequest, 'unanswered request')
  } finally {
    for (const node of [source, sink]) {
      nodeRegistry.delete(node.id)
      nodeExecutors.delete(node.id)
    }
  }
})

test('diagnostic input collection preserves all eight ports including null and false', () => {
  const inputs = { data: null, data2: false, data3: '', data4: 0, data5: [], data6: {}, data7: 'value', data8: 8 }
  const packet = buildBigBrotherDiagnostic({ ...inputs, unrelated: 'omit' }, {})
  assert.deepEqual(packet.data, inputs)
  assert.equal(packet.reasoning, true)
})
