import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enrichGraphWithSchemas,
  serializeGraphForPersistence,
} from './template-converter.js'

function storedGraph(viewport?: { x: number; y: number; zoom: number }) {
  return {
    version: '1.0',
    name: 'Layout persistence',
    description: '',
    nodes: [{
      id: 'node-1',
      type: 'genericNode',
      position: { x: 40, y: 80 },
      width: 515,
      height: 120,
      data: {
        nodeType: 'cognitive/test_prompt',
        properties: { prompt: 'Keep me' },
      },
    }],
    edges: [],
    viewport,
  }
}

test('schema-rendered nodes retain custom widths without restoring legacy fixed heights', () => {
  const graph = enrichGraphWithSchemas(storedGraph())
  const [node] = graph.nodes

  assert.equal(node.width, 515)
  assert.equal('height' in node, false)

  const serialized = serializeGraphForPersistence(graph)
  assert.equal(serialized.nodes[0].width, 515)
  assert.equal('height' in serialized.nodes[0], false)
})

test('stored viewports survive the load and save conversion path', () => {
  const viewport = { x: -240, y: 135, zoom: 0.82 }
  const graph = enrichGraphWithSchemas(storedGraph(viewport))

  assert.deepEqual(graph.viewport, viewport)
  assert.deepEqual(serializeGraphForPersistence(graph).viewport, viewport)
})

test('legacy graphs without a viewport remain eligible for an initial fit', () => {
  const graph = enrichGraphWithSchemas(storedGraph())

  assert.equal(graph.viewport, undefined)
})

test('scheduler, node activation, and edge selection survive load and save', () => {
  const stored = storedGraph() as any
  stored.scheduler = {
    version: 1,
    activation: 'demand',
    skippedState: 'explicit',
    sideEffectOrder: 'serial-topological',
    maxLoopIterations: 7,
  }
  stored.nodes[0].data.activation = {
    when: [{ nodeId: 'gate', output: 'enabled', equals: true }],
  }
  stored.edges = [{
    id: 'loop',
    source: 'node-1',
    target: 'node-1',
    sourceHandle: 'output',
    targetHandle: 'input',
    data: {
      loop: true,
      when: { output: 'branch', equals: 'retry' },
    },
  }]

  const serialized = serializeGraphForPersistence(enrichGraphWithSchemas(stored))
  assert.deepEqual(serialized.scheduler, stored.scheduler)
  assert.deepEqual((serialized.nodes[0].data as any).activation, stored.nodes[0].data.activation)
  assert.deepEqual(serialized.edges[0].data, stored.edges[0].data)
})

test('group frames retain height and child containment while regular node heights remain content-driven', () => {
  const stored = storedGraph() as any
  stored.nodes = [
    {
      id: 'frame-1',
      type: 'noteNode',
      position: { x: 20, y: 30 },
      width: 760,
      height: 480,
      zIndex: -1,
      data: {
        nodeType: 'cognitive/graph_note',
        properties: { title: 'Review branch', content: '', style: 'info', frame: true },
      },
    },
    {
      ...stored.nodes[0],
      id: 'child-1',
      parentId: 'frame-1',
      extent: 'parent',
      expandParent: true,
      zIndex: 1,
    },
  ]

  const graph = enrichGraphWithSchemas(stored)
  assert.equal(graph.nodes[0].height, 480)
  assert.equal(graph.nodes[1].height, undefined)
  assert.equal(graph.nodes[1].parentId, 'frame-1')
  assert.equal(graph.nodes[1].extent, 'parent')

  const serialized = serializeGraphForPersistence(graph)
  assert.equal(serialized.nodes[0].height, 480)
  assert.equal(serialized.nodes[0].zIndex, -1)
  assert.equal(serialized.nodes[1].height, undefined)
  assert.equal(serialized.nodes[1].parentId, 'frame-1')
  assert.equal(serialized.nodes[1].extent, 'parent')
  assert.equal(serialized.nodes[1].expandParent, true)
})
