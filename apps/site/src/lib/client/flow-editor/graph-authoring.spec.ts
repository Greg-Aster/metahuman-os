import assert from 'node:assert/strict'
import test from 'node:test'
import type { Edge, Node } from '@xyflow/svelte'
import { DEFAULT_GRAPH_SCHEDULER } from '@metahuman/core/cognitive-graph-contract'
import {
  autoLayoutNodes,
  branchResults,
  connectionProblem,
  connectionTypeWarning,
  decorateEdge,
  inspectSchemaHealth,
  parseScalar,
  validateAuthoringGraph,
} from './graph-authoring'

function node(id: string, input = 'input', output = 'output'): Node {
  return {
    id,
    type: 'genericNode',
    position: { x: 0, y: 0 },
    data: {
      nodeType: `cognitive/${id}`,
      properties: {},
      schema: {
        id,
        name: id,
        category: 'utility',
        color: '#fff',
        bgColor: '#000',
        description: id,
        inputs: input ? [{ name: input, type: 'string', description: 'input' }] : [],
        outputs: output ? [{ name: output, type: 'string', description: 'output' }] : [],
        execution: { activation: input ? 'required-inputs' : 'any-input', requiredInputs: input ? [input] : [] },
      },
    },
  }
}

test('connection validation rejects undeclared handles and duplicates', () => {
  const nodes = [node('a', '', 'text'), node('b', 'text', '')]
  const connection = { source: 'a', target: 'b', sourceHandle: 'text', targetHandle: 'text' }
  assert.equal(connectionProblem(nodes, [], connection), null)
  assert.match(connectionProblem(nodes, [], { ...connection, targetHandle: 'missing' }) || '', /declared input/)
  assert.match(connectionProblem(nodes, [{ id: 'e', ...connection }], connection) || '', /already exists/)
})

test('control edges do not require data handles and validate their branch output', () => {
  const source = node('source', '', 'route')
  const target = node('target', '', '')
  const controlEdge = {
    id: 'control',
    source: 'source',
    target: 'target',
    sourceHandle: 'route',
    targetHandle: 'control',
    data: { kind: 'control', when: { output: 'route', equals: 'go' } },
  } as Edge
  const graph = {
    version: '1.0',
    name: 'test',
    description: '',
    scheduler: DEFAULT_GRAPH_SCHEDULER,
    nodes: [source, target],
    edges: [controlEdge],
  }

  assert.equal(connectionProblem(graph.nodes, [], controlEdge as any), null)
  assert.deepEqual(validateAuthoringGraph(graph).filter(issue => issue.level === 'error'), [])

  controlEdge.data = { kind: 'control', when: { output: 'missing', equals: 'go' } }
  assert(validateAuthoringGraph(graph).some(issue => issue.edgeId === 'control' && /undeclared output missing/.test(issue.message)))
})

test('connection validation reports type mismatches without blocking deliberate adapter paths', () => {
  const source = node('source', '', 'value')
  const target = node('target', 'value', '')
  ;(source.data.schema as any).outputs[0].type = 'object'
  ;(target.data.schema as any).inputs[0].type = 'string'
  const connection = { source: 'source', target: 'target', sourceHandle: 'value', targetHandle: 'value' }

  assert.equal(connectionProblem([source, target], [], connection), null)
  assert.match(connectionTypeWarning([source, target], connection) || '', /object output.*string input/)
})

test('edge decoration and branch results explain selected paths', () => {
  const edge = decorateEdge({
    id: 'branch',
    source: 'a',
    target: 'b',
    sourceHandle: 'output',
    targetHandle: 'input',
    data: { when: { output: 'choice', equals: 'go' }, loop: true, comment: 'retry path' },
  })
  assert.equal(edge.animated, true)
  assert.match(String(edge.label), /choice = go/)
  const graph = {
    version: '1.0',
    name: 'test',
    description: '',
    scheduler: DEFAULT_GRAPH_SCHEDULER,
    nodes: [node('a'), node('b')],
    edges: [edge],
  }
  assert.equal(branchResults(graph, { a: { choice: 'go' } })[0].selected, true)
})

test('authoring validation catches required inputs and invalid loop metadata', () => {
  const graph = {
    version: '1.0',
    name: 'test',
    description: '',
    scheduler: DEFAULT_GRAPH_SCHEDULER,
    nodes: [node('required')],
    edges: [{
      id: 'loop', source: 'required', target: 'required', sourceHandle: 'output', targetHandle: 'input', data: { loop: true },
    } as Edge],
  }
  const messages = validateAuthoringGraph(graph).map(issue => issue.message)
  assert(messages.some(message => message.includes('requires a branch condition')))
})

test('authoring validation enforces schema properties and reports documentation coverage', () => {
  const configured = node('configured', '', '')
  ;(configured.data.schema as any).propertySchemas = {
    prompt: {
      type: 'text_multiline',
      default: '',
      label: 'Prompt',
      required: true,
      validation: { minLength: 5 },
    },
  }
  configured.data.properties = { prompt: 'no' }
  const graph = {
    version: '1.0',
    name: 'test',
    description: '',
    scheduler: DEFAULT_GRAPH_SCHEDULER,
    nodes: [configured],
    edges: [],
  }

  assert(validateAuthoringGraph(graph).some(issue => issue.propertyKey === 'prompt' && issue.level === 'error'))
  assert.equal(inspectSchemaHealth(graph.nodes).undocumentedProperties, 1)

  ;(configured.data.schema as any).propertySchemas.payload = {
    type: 'json',
    default: {},
    label: 'Payload',
  }
  ;(configured.data.properties as any).payload = '{'
  assert(validateAuthoringGraph(graph).some(issue => issue.propertyKey === 'payload' && issue.level === 'error'))
})

test('auto layout follows dependency rank and scalar parsing preserves intent', () => {
  const nodes = [node('a'), node('b'), node('c')]
  const edges = [
    { id: 'ab', source: 'a', target: 'b', sourceHandle: 'output', targetHandle: 'input' },
    { id: 'bc', source: 'b', target: 'c', sourceHandle: 'output', targetHandle: 'input' },
  ] as Edge[]
  const laidOut = autoLayoutNodes(nodes, edges)
  assert(laidOut[0].position.x < laidOut[1].position.x)
  assert(laidOut[1].position.x < laidOut[2].position.x)
  assert.equal(parseScalar('false'), false)
  assert.equal(parseScalar('12.5'), 12.5)
  assert.equal(parseScalar('robot'), 'robot')
})
