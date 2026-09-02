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
