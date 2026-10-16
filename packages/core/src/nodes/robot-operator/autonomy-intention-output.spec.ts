import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { randomUUID } from 'node:crypto'

const repo = path.resolve(import.meta.dirname, '../../../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-autonomy-intention-'))
process.env.METAHUMAN_ROOT = root
// The only optional network work is memory indexing. No robot or model transport runs.
globalThis.fetch = async (url) => {
  assert.match(String(url), /unified-queue/)
  return new Response(JSON.stringify({ task: { id: 'fixture-index' } }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const { withUserContext } = await import('../../context.js')
const { loadBufferForUser } = await import('../../conversation-buffer.js')
const { runDurableGraph } = await import('../../durable-execution/runtime.js')
const { validateSvelteFlowGraph } = await import('../../cognitive-graph-schema.js')
const { nodeRegistry, nodeExecutors } = await import('../index.js')
const { robotOperatorEnvironmentDispatchNode } = await import('./environment-dispatch.node.js')
const { getProfilePaths } = await import('../../path-builder.js')

const observedAt = '2026-10-15T17:22:00.000Z'
const decision = {
  instruction: 'Inspect the desk from the doorway.',
  reason: 'The latest observation does not resolve the object on the desk.',
  observed: 'The desk is partially obscured in the supplied image.',
}
const observation = { environmentId: 'fixture', adapter: 'fixture', sessionId: 'fixture-body', timestamp: observedAt,
  capabilities: { actions: ['robotCommand'], robotCommands: ['walk'], movement: true }, state: {} }
const graphs = ['boredom-observer', 'boredom-movement', 'boredom-reflection', 'robot-autonomy-controller']
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(repo, `etc/cognitive-graphs/${name}-mode.json`), 'utf8'))

function handoffGraph(name: string, triggerSource: string, selected: boolean) {
  const source = read(name)
  const dispatch = source.nodes.find((node: any) => node.data.nodeType === 'robot_operator_environment_dispatch')
  const keep = new Set([dispatch.id, 'autonomy-inner-output', 'autonomy-intention-memory', 'selected-workflow'])
  const graph = { ...source, nodes: source.nodes.filter((node: any) => keep.has(node.id)),
    edges: source.edges.filter((edge: any) => keep.has(edge.source) && keep.has(edge.target)),
    scheduler: { ...source.scheduler, eventInputNodeId: undefined } }
  // Retain the real saved dispatch/output wiring; replace unrelated cognition with supplied decisions.
  for (const [field, value] of Object.entries({ decision: selected ? decision : null, observation,
    robotObserver: { cycleId: `cycle-${name}`, step: 1, requestedBy: name, triggerSource, graph: name } })) {
    graph.nodes.push({ id: field, type: 'genericNode', position: { x: 0, y: 0 },
      data: { nodeType: 'text_input', properties: { message: JSON.stringify(value) } } },
    { id: `${field}-json`, type: 'genericNode', position: { x: 0, y: 0 }, data: { nodeType: 'json_parser', properties: {} } })
    graph.edges.push({ id: `${field}-parse`, source: field, sourceHandle: 'text', target: `${field}-json`, targetHandle: 'text' },
      { id: `${field}-dispatch`, source: `${field}-json`, sourceHandle: 'data', target: dispatch.id, targetHandle: field })
  }
  return validateSvelteFlowGraph(graph)
}

let delivered: any[] = []
const original = nodeRegistry.get('workflow_call')!.execute
const simulatedChild = async (inputs: any, context: any) => {
  const entries = loadBufferForUser(context.username, 'inner').messages
  assert.ok(entries.some(entry => entry.meta?.executionId === context.graphExecution.executionId),
    'The intention is visible before the child workflow is called')
  delivered.push(inputs.invocation)
  return { completed: true, childResult: { simulated: true } }
}
nodeRegistry.get('workflow_call')!.execute = simulatedChild
nodeExecutors.set('workflow_call', simulatedChild)
after(() => {
  nodeRegistry.get('workflow_call')!.execute = original
  nodeExecutors.set('workflow_call', original)
  eventBus.disconnect()
  fs.rmSync(root, { recursive: true, force: true })
})

for (const name of graphs) test(`${name} records its exact intention and reason in inner buffer and autonomy memory`, async () => {
  const username = name
  await withUserContext({ userId: username, username, role: 'owner' }, async () => {
    fs.mkdirSync(getProfilePaths(username).etc, { recursive: true })
    const graph = handoffGraph(name, 'autonomy', true)
    const context = { username, userId: username, cognitiveMode: 'environment' as const,
      environment: 'server' as const, operatorMode: 'semi', recordPersonaMemory: true }
    delivered = []
    const result = await runDurableGraph({ graph, context: { ...context, requestId: randomUUID() } })
    assert.equal(result.status, 'completed', result.error?.stack)
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].graph, 'environment')
    assert.equal(delivered[0].context.robotOperatorContext.plannerDecision.instruction, decision.instruction)
    const buffer = loadBufferForUser(username, 'inner').messages
    assert.equal(buffer.length, 1)
    const entry = buffer[0]
    assert.equal(entry.content, `Intention: ${decision.instruction}\n\nReason: ${decision.reason}\n\nObservation: ${decision.observed}`)
    assert.equal(entry.role, 'reflection')
    assert.equal(entry.meta?.source, 'autonomy')
    assert.equal(entry.meta?.agentId, name)
    assert.equal(entry.meta?.executionId, result.executionId)
    assert.equal(entry.meta?.sourceObservationAt, observedAt)
    assert.equal(entry.meta?.sessionId, observation.sessionId)
    assert.equal(entry.meta?.correlationId, `cycle-${name}`)
    assert.ok(entry.meta?.tags?.includes('autonomy'))
    const saved = result.nodes.get('autonomy-intention-memory')!.outputs!
    assert.equal(saved.savedCount, 1)
    const memory = JSON.parse(fs.readFileSync(saved.eventPath, 'utf8'))
    assert.equal(memory.type, 'inner_dialogue')
    assert.ok(memory.tags.includes('autonomy'))
    assert.equal(memory.content, entry.content)
    assert.equal(memory.timestamp, new Date(entry.timestamp!).toISOString())
    for (const field of ['source', 'agentId', 'executionId', 'correlationId', 'sessionId', 'sourceObservationAt', 'plannerDecision']) {
      assert.deepEqual(memory.metadata[field], entry.meta?.[field])
    }
    assert.equal(loadBufferForUser(username, 'conversation').messages.length, 0, 'No public response or TTS is introduced')
    const replay = await runDurableGraph({ graph, context, executionId: result.executionId })
    assert.equal(replay.status, 'completed', replay.error?.stack)
    assert.equal(delivered.length, 1)
    assert.equal(loadBufferForUser(username, 'inner').messages.length, 1, 'A saved execution does not publish its intention again')
    const next = await runDurableGraph({ graph, context: { ...context, requestId: randomUUID() } })
    assert.equal(next.status, 'completed', next.error?.stack)
    assert.equal(loadBufferForUser(username, 'inner').messages.length, 2, 'Separate decisions with equal text remain separate records')
  })
})

test('a rejected handoff produces neither an inner entry nor a memory or child invocation', async () => {
  const username = 'empty-handoff'
  await withUserContext({ userId: username, username, role: 'owner' }, async () => {
    const result = await runDurableGraph({ graph: handoffGraph('boredom-movement', 'autonomy', false),
      context: { username, userId: username, environment: 'server', recordPersonaMemory: true, requestId: randomUUID() } })
    assert.equal(result.status, 'completed', result.error?.stack)
    for (const id of ['autonomy-inner-output', 'autonomy-intention-memory', 'selected-workflow']) {
      assert.equal(result.nodes.get(id)?.status, 'skipped')
    }
    assert.equal(loadBufferForUser(username, 'inner').messages.length, 0)
  })
})

test('manually triggering an autonomy planner preserves trigger attribution without calling its intention a human statement', async () => {
  const output = await robotOperatorEnvironmentDispatchNode.execute({ decision, observation,
    robotObserver: { cycleId: 'manual-cycle', step: 1, triggerSource: 'user', graph: 'boredom-movement', requestedBy: 'boredom-movement' } },
  { username: 'fixture', operatorMode: 'semi' }, {})
  assert.equal(output.innerEntry.meta.source, 'autonomy')
  assert.equal(output.innerEntry.meta.triggerSource, 'user')
  assert.equal(output.innerEntry.meta.plannerDecision.instruction, decision.instruction)
})
