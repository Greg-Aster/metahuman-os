import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../../cognitive-graph-schema.js'
import { findMissingExecutors } from '../../graph-runtime.js'
import { getNode } from '../index.js'

const root = path.resolve(process.cwd())

function load(name: string): SvelteFlowGraph {
  return validateSvelteFlowGraph(JSON.parse(
    fs.readFileSync(path.join(root, 'etc', 'cognitive-graphs', name), 'utf8'),
  ))
}

function assertRegisteredHandles(graph: SvelteFlowGraph): void {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  for (const edge of graph.edges) {
    const source = nodes.get(edge.source)
    const target = nodes.get(edge.target)
    assert.ok(source, `missing source node for ${edge.id}`)
    assert.ok(target, `missing target node for ${edge.id}`)
    const sourceDefinition = getNode(source!.data.nodeType)
    const targetDefinition = getNode(target!.data.nodeType)
    assert.ok(sourceDefinition, `missing source executor for ${source!.data.nodeType}`)
    assert.ok(targetDefinition, `missing target executor for ${target!.data.nodeType}`)
    assert.ok(
      sourceDefinition!.outputs.some(output => output.name === edge.sourceHandle),
      `${edge.id} uses missing source handle ${source!.data.nodeType}.${edge.sourceHandle}`,
    )
    assert.ok(
      targetDefinition!.inputs.some(input => input.name === edge.targetHandle),
      `${edge.id} uses missing target handle ${target!.data.nodeType}.${edge.targetHandle}`,
    )
  }
}

test('Train of Thought graph uses only registered executors and current handle contracts', () => {
  const graph = load('train-of-thought.json')
  assert.deepEqual(findMissingExecutors(graph), [])
  assertRegisteredHandles(graph)
  assert.equal(graph.nodes.some(node => node.data.nodeType.startsWith('scratchpad_')), false)
  assert.equal(graph.nodes.filter(node => node.data.nodeType === 'inner_dialogue_buffer').length, 1)
  assert.equal(graph.nodes.filter(node => node.data.nodeType === 'thought_aggregator').length, 1)
  const backEdge = graph.edges.find(edge => edge.source === 'route' && edge.target === 'generate')
  assert.match(backEdge?.data?.comment || '', /BACK-EDGE/)
})

test('Reflector and Inner Curiosity own explicit 20 percent seeded follow-on nodes', () => {
  for (const [name, sourceAgent] of [
    ['reflector-mode.json', 'reflector'],
    ['inner-curiosity-follow-on.json', 'inner-curiosity'],
  ] as const) {
    const graph = load(name)
    assertRegisteredHandles(graph)
    const triggers = graph.nodes.filter(node => node.data.nodeType === 'agent_trigger')
    assert.equal(triggers.length, 1, `${name} must have exactly one follow-on trigger`)
    assert.equal(triggers[0].data.properties?.agentName, 'train-of-thought')
    assert.equal(triggers[0].data.properties?.sourceAgent, sourceAgent)
    assert.equal(triggers[0].data.properties?.probability, 0.2)
    const incoming = graph.edges.filter(edge => edge.target === triggers[0].id)
    assert.equal(incoming.length, 1)
    assert.equal(incoming[0].targetHandle, 'seed')
  }
})
