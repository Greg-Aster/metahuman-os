import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { SvelteFlowGraph } from '../packages/core/src/cognitive-graph-schema.js'
import { scheduleAcceptedOutput, scheduleLoopIteration } from '../packages/core/src/graph-executor.js'
import { eventBus } from '../packages/core/src/infrastructure/event-bus/client.js'
import { getNode, getNodeExecutor } from '../packages/core/src/nodes/index.js'

const ROOT = process.cwd()
const GRAPH_PATH = path.join(ROOT, 'etc', 'cognitive-graphs', 'dual-mode.json')

async function loadGraph(filePath = GRAPH_PATH): Promise<SvelteFlowGraph> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function edgeExists(
  graph: SvelteFlowGraph,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): boolean {
  return graph.edges.some(edge => edge.source === source
    && edge.sourceHandle === sourceHandle
    && edge.target === target
    && edge.targetHandle === targetHandle)
}

function validateContracts(graph: SvelteFlowGraph): void {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))

  for (const node of graph.nodes) {
    const definition = getNode(node.data.nodeType)
    assert(definition, `Missing executor contract for node ${node.id} (${node.data.nodeType})`)

    for (const property of Object.keys(node.data.properties || {})) {
      assert(
        property in (definition.propertySchemas || {}),
        `Undeclared property ${definition.id}.${property}`,
      )
    }
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    assert(source, `Missing source node for ${edge.id}`)
    assert(target, `Missing target node for ${edge.id}`)

    const sourceDefinition = getNode(source.data.nodeType)!
    const targetDefinition = getNode(target.data.nodeType)!
    assert(
      sourceDefinition.outputs.some(output => output.name === edge.sourceHandle),
      `Undeclared output ${sourceDefinition.id}.${edge.sourceHandle}`,
    )
    assert(
      targetDefinition.inputs.some(input => input.name === edge.targetHandle),
      `Undeclared input ${targetDefinition.id}.${edge.targetHandle}`,
    )
  }
}

function validateWorkflowShape(graph: SvelteFlowGraph): void {
  assert.equal(graph.cognitiveMode, 'dual')
  assert.equal(graph.nodes.length, 21)

  const nodeTypes = new Set(graph.nodes.map(node => node.data.nodeType))
  const runtimeCruft = [
    'session_context',
    'system_settings',
    'cot_stripper',
    'graph_note',
    'output_viewer',
    'text_input',
    'chat_view',
  ]
  for (const nodeType of runtimeCruft) {
    assert(!nodeTypes.has(nodeType), `Runtime graph still contains ${nodeType}`)
  }

  assert(edgeExists(graph, '24', 'analysis', '25', 'orchestratorAnalysis'))
  assert(edgeExists(graph, '25', 'memoryHints', '6', 'orchestratorHints'))
  assert(edgeExists(graph, '29', 'persona', '30', 'persona'))
  assert(edgeExists(graph, '30', 'formatted', '17', 'personaText'))
  assert(edgeExists(graph, '29', 'persona', '8', 'persona'))
  assert(edgeExists(graph, '29', 'persona', '33', 'persona'))

  const backEdges = graph.edges.filter(edge => edge.sourceHandle === 'feedbackContext')
  assert.equal(backEdges.length, 1)
  assert.equal(backEdges[0].source, '34')
  assert.equal(backEdges[0].target, '8')

  const loopBody = new Set<string>()
  const queue = [backEdges[0].target]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (nodeId === '34' || loopBody.has(nodeId)) continue
    loopBody.add(nodeId)
    for (const edge of graph.edges.filter(candidate => candidate.source === nodeId)) {
      if (edge.sourceHandle !== 'feedbackContext') queue.push(edge.target)
    }
  }
  assert.deepEqual([...loopBody].sort(), ['17', '19', '20', '33', '8'])

  assert(edgeExists(graph, '34', 'response', '35', 'data'))
  assert(edgeExists(graph, '34', 'shouldContinueLoop', '35', 'open'))
  assert(edgeExists(graph, '35', 'output', '31', 'response'))
  assert(edgeExists(graph, '31', 'stripped', '23', 'response'))
  assert(edgeExists(graph, '31', 'stripped', '21', 'assistantResponse'))
  assert(edgeExists(graph, '31', 'stripped', '26', 'response'))
  assert(edgeExists(graph, '31', 'stripped', '36', 'conversation'))
  assert(edgeExists(graph, '21', 'saved', '22', 'data'))
  assert(edgeExists(graph, '26', 'persisted', '22', 'status'))
}

function validateLoopScheduling(): void {
  const loopBody = ['8', '17', '33', '19', '20']
  const outputPath = ['35', '31', '23', '21', '26', '36', '22']
  const initialTail = ['35', '31', '23', '21', '26', '36', '22', 'unrelated']

  const retryQueue = scheduleLoopIteration(initialTail, loopBody, outputPath, '34')
  assert.deepEqual(retryQueue, [...loopBody, '34', 'unrelated'])
  for (const outputNode of outputPath) {
    assert(!retryQueue.includes(outputNode), `Rejected output node ${outputNode} remained queued`)
  }

  const acceptedQueue = scheduleAcceptedOutput(
    ['31', '23', 'unrelated', '35'],
    outputPath,
  )
  assert.deepEqual(acceptedQueue, [...outputPath, 'unrelated'])
}

async function validateRoutingExecutors(): Promise<void> {
  const smartRouter = getNodeExecutor('smart_router')
  const feedbackRouter = getNodeExecutor('feedback_router')
  const searchInterpreter = getNodeExecutor('search_interpreter')
  const qualityScorer = getNodeExecutor('quality_scorer')
  assert(smartRouter)
  assert(feedbackRouter)
  assert(searchInterpreter)
  assert(qualityScorer)

  const skippedMemory = await smartRouter({
    orchestratorAnalysis: {
      complexity: 0.1,
      needsMemory: false,
      memoryTier: 'hot',
      memoryQuery: '',
    },
  }, {}, { routeOnComplexity: true, simpleThreshold: 0.3 })
  assert.equal(skippedMemory.memoryHints.needsMemory, false)
  assert.equal(skippedMemory.routeToMemory, false)

  const requestedMemory = await smartRouter({
    orchestratorAnalysis: {
      complexity: 0.1,
      needsMemory: true,
      memoryTier: 'deep',
      memoryQuery: 'a remembered preference',
    },
  }, {}, { routeOnComplexity: true, simpleThreshold: 0.3 })
  assert.equal(requestedMemory.memoryHints.needsMemory, true)
  assert.equal(requestedMemory.memoryHints.memoryTier, 'deep')
  assert.equal(requestedMemory.routeToMemory, true)

  const noMemoryNeeded = await searchInterpreter({
    searchResults: [],
    userQuery: 'hello',
    orchestratorIntent: { needsMemory: false },
  }, {}, {})
  assert.equal(noMemoryNeeded.unknownSignal, false)
  assert.equal(noMemoryNeeded.fullResult.unknownSignal, false)

  const missingRequestedMemory = await searchInterpreter({
    searchResults: [],
    userQuery: 'what did I say before?',
    orchestratorIntent: { needsMemory: true },
  }, {}, {})
  assert.equal(missingRequestedMemory.unknownSignal, true)
  assert.equal(missingRequestedMemory.fullResult.unknownSignal, true)

  const ordinaryLoraOnlyTurn = await qualityScorer({
    response: 'Hello there.',
    originalQuery: 'hello',
    memories: [],
    unknownSignal: false,
    persona: null,
  }, {}, { qualityThreshold: 0.7, strictHallucinationCheck: true })
  assert.equal(ordinaryLoraOnlyTurn.evaluationSkipped, true)
  assert.equal(ordinaryLoraOnlyTurn.passesThreshold, true)

  const qualityPassed = {
    qualityScore: 1,
    passesThreshold: true,
    needsRefinement: false,
    issues: [],
    suggestions: [],
  }

  const critical = await feedbackRouter({
    response: 'unsafe raw response',
    qualityResult: qualityPassed,
    safetyResult: {
      safe: false,
      issues: [{ description: 'critical policy violation', severity: 'critical' }],
    },
    currentIteration: 1,
  }, {}, { maxIterations: 3, allowPartialSuccess: true })
  assert.equal(critical.safetyPassed, false)
  assert.equal(critical.shouldContinueLoop, false)
  assert.notEqual(critical.response, 'unsafe raw response')

  const retry = await feedbackRouter({
    response: 'repairable response',
    qualityResult: qualityPassed,
    safetyResult: {
      safe: false,
      issues: [{ description: 'repairable issue', severity: 'high' }],
    },
    currentIteration: 1,
  }, {}, { maxIterations: 3, allowPartialSuccess: true })
  assert.equal(retry.safetyPassed, false)
  assert.equal(retry.shouldContinueLoop, true)
  assert.equal(retry.routedTo, 'orchestrator')

  const exhausted = await feedbackRouter({
    response: 'unsafe final attempt',
    qualityResult: qualityPassed,
    safetyResult: {
      safe: false,
      issues: [{ description: 'still unsafe', severity: 'high' }],
    },
    currentIteration: 3,
  }, {}, { maxIterations: 3, allowPartialSuccess: true })
  assert.equal(exhausted.shouldContinueLoop, false)
  assert.notEqual(exhausted.response, 'unsafe final attempt')
}

async function validateArtifacts(graph: SvelteFlowGraph): Promise<void> {
  const paths = [
    path.join(ROOT, 'apps', 'site', 'public', 'cognitive-graphs', 'dual-mode.json'),
    path.join(ROOT, 'apps', 'react-native', 'nodejs-assets', 'nodejs-project', 'etc', 'cognitive-graphs', 'dual-mode.json'),
  ]

  for (const artifactPath of paths) {
    assert.deepEqual(await loadGraph(artifactPath), graph, `${artifactPath} drifted from canonical graph`)
  }
}

async function main(): Promise<void> {
  const graph = await loadGraph()
  validateContracts(graph)
  validateWorkflowShape(graph)
  validateLoopScheduling()
  await validateRoutingExecutors()
  await validateArtifacts(graph)
  console.log('Dual-mode graph contract validation passed')
}

main()
  .then(() => {
    eventBus.disconnect()
    process.exit(0)
  })
  .catch(error => {
    eventBus.disconnect()
    console.error(error)
    process.exit(1)
  })
