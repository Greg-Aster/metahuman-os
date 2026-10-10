import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'

const repo = path.resolve(import.meta.dirname, '../../../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-tool-use-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Tool workflow tests prohibit network') }
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
fs.cpSync(path.join(repo, 'etc/cognitive-graphs'), path.join(root, 'etc/cognitive-graphs'), { recursive: true })
for (const name of ['agents.json', 'services.json']) fs.copyFileSync(path.join(repo, 'etc', name), path.join(root, 'etc', name))
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
let fullGraphRun = false
let failed = false
let calls = 0
const modelInputs: any[] = []
const terminal = await import('../../terminal/client.js')
mock.module(new URL('../../terminal/client.ts', import.meta.url).href, { namedExports: { ...terminal,
  executeBigBrotherTool: async (request: any) => {
    calls++
    assert.equal(request.data.request, 'Inspect the requested file.')
    if (fullGraphRun) {
      assert.equal(request.data.selectedContext.activePersona, null)
      assert.equal(loadBufferForUser('tool-full-graph', 'conversation').messages.at(-1)?.content, 'I will look into it.')
    } else assert.equal(request.data.selectedContext.marker, 'selected-context')
    assert.equal(request.reasoning, true)
    assert.equal(request.model, 'fixture-codex')
    return { success: !failed, output: failed ? '' : 'Located /tmp/fixture.txt; source: local filesystem.',
      error: failed ? 'Fixture provider failed' : undefined, executionTime: 10, metadata: {} }
  },
} })
const router = await import('../../model-router.js')
mock.module(new URL('../../model-router.ts', import.meta.url).href, { namedExports: { ...router,
  callLLM: async (input: any) => {
    modelInputs.push(input)
    if (fullGraphRun && input.role === 'orchestrator') return { content: JSON.stringify({
      needsResponse: true, needsAction: false, needsToolUse: true, taskContext: [], conversationContext: ['persona.personality'],
    }) }
    const evidence = JSON.parse(input.messages[1].content)
    assert.equal(evidence.currentInstruction, 'Inspect the requested file.')
    if (fullGraphRun) {
      assert.equal(evidence.activePersona, 'conversation-only-persona')
      if (evidence.toolWork.state === 'selected') return { content: 'I will look into it.' }
    }
    assert.equal(evidence.toolWork.state, failed ? 'failed' : 'completed', evidence.toolWork.error)
    return { content: failed ? 'The delegated request failed.' : 'The file is /tmp/fixture.txt.' }
  },
} })
const { nodeExecutors } = await import('../index.js')
nodeExecutors.set('tts', async () => ({ spoken: false }))
const { createUser } = await import('../../users.js')
const { runDurableGraph, withGraphWork } = await import('../../durable-execution/runtime.js')
const { validateSvelteFlowGraph, DEFAULT_GRAPH_SCHEDULER } = await import('../../cognitive-graph-schema.js')
const { getQueueManager } = await import('../../queue/unified-queue-manager.js')
const { ExecutionEngine } = await import('../../queue/execution-engine.js')
const { openExecutionStore } = await import('../../durable-execution/storage.js')
const { loadBufferForUser } = await import('../../conversation-buffer.js')
const { withUserContext } = await import('../../context.js')
const manager = getQueueManager()
const engine = new ExecutionEngine({}, manager)
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

for (const fail of [false, true]) {
  test(`independent tool workflow returns ${fail ? 'failure' : 'success'} after its parent finishes without another user turn`, async () => {
    failed = fail
    calls = 0
    modelInputs.length = 0
    const username = `tool-fixture-${fail}`
    createUser(username, 'fixture-password', 'standard')
    await withUserContext({ username, userId: username, role: 'standard' }, async () => {
      const graph = validateSvelteFlowGraph({ name: 'Tool admission fixture', version: '1.0', format: 'svelte-flow',
        scheduler: DEFAULT_GRAPH_SCHEDULER,
        nodes: [
          { id: 'request', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'text_input', properties: { message: 'Inspect the requested file.' } } },
          { id: 'evidence', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'text_input', properties: { message: JSON.stringify({ marker: 'selected-context', currentInstruction: 'Inspect the requested file.' }) } } },
          { id: 'json', type: 'utilityNode', position: { x: 0, y: 0 }, data: { nodeType: 'json_parser', properties: {} } },
          { id: 'tool', type: 'utilityNode', position: { x: 0, y: 0 }, data: { nodeType: 'big_brother_tool_request', properties: { model: 'fixture-codex' } } },
        ], edges: [
          { id: 'request-tool', source: 'request', sourceHandle: 'text', target: 'tool', targetHandle: 'request' },
          { id: 'evidence-json', source: 'evidence', sourceHandle: 'text', target: 'json', targetHandle: 'text' },
          { id: 'json-tool', source: 'json', sourceHandle: 'data', target: 'tool', targetHandle: 'selectedContext' },
        ] })
      const parent = manager.enqueue({ type: 'generic', username, input: {}, maxAttempts: 1 })
      manager.claim(parent.id)
      const initial = await withGraphWork(parent, id => manager.attachExecution(parent.id, id),
        () => runDurableGraph({ graph, context: { username, userId: username, recordPersonaMemory: false } }),
        async input => manager.enqueue(input))
      assert.equal(initial.status, 'completed', initial.error?.stack)
      assert.equal(calls, 0, 'Admission does not wait for or call Codex')
      const work = manager.getAllTasks().find(task => task.username === username && task.handler === 'environment.tools')!
      assert.equal(work.durable?.scope, 'independent')
      assert.equal(work.durable?.recovery, 'reconcile', 'Interrupted external work is not blindly replayed')
      manager.complete(parent.id, true, {})
      manager.claim(work.id)
      await (engine as any).execute(work)
      assert.equal(calls, 1)
      assert.equal(modelInputs.length, 1)
      assert.equal(manager.getTask(work.id)?.state, fail ? 'failed' : 'completed')
      const buffer = loadBufferForUser(username, 'conversation').messages
      assert.equal(buffer.filter(entry => entry.role === 'user').length, 0, 'The result is not synthetic user input')
      assert.equal(buffer.filter(entry => entry.role === 'assistant').length, 1)
      assert.equal(buffer[0].meta?.taskId, work.id)
      assert.equal(buffer[0].meta?.state, fail ? 'failed' : 'completed')
      const store = openExecutionStore(username)
      try {
        assert.equal(store.get(initial.executionId!).status, 'completed')
        assert.ok(manager.getTask(work.id)?.graphExecutions?.some(id => id !== initial.executionId))
      } finally { store.close() }
    })
  })
}


test('Environment acknowledges tool work before dispatch and preserves independently selected conversation context', async () => {
  fullGraphRun = true
  failed = false
  calls = 0
  modelInputs.length = 0
  const username = 'tool-full-graph'
  createUser(username, 'fixture-password', 'standard')
  const full = JSON.parse(fs.readFileSync(path.join(repo, 'etc/cognitive-graphs/environment-mode.json'), 'utf8'))
  const excluded = new Set(['input-events', 'continue-user-input', 'remaining-objective', 'review-remaining-objective', 'await-objective-input'])
  const graph = validateSvelteFlowGraph({ ...full,
    scheduler: { ...full.scheduler, eventInputNodeId: undefined },
    nodes: full.nodes.filter((node: any) => !excluded.has(node.id)),
    edges: full.edges.filter((edge: any) => !excluded.has(edge.source) && !excluded.has(edge.target)),
  })
  graph.nodes.find(node => node.id === 'tool-request')!.data.properties!.model = 'fixture-codex'
  const replacements: Record<string, any> = {
    user_input: async () => ({ message: 'Inspect the requested file.' }),
    environment_bridge_input: async () => ({ observation: { sessionId: 'fixture', timestamp: new Date().toISOString(), capabilities: { actions: [] } } }),
    observation_history: async () => ({ observations: [] }),
    persona_loader: async () => ({ persona: {}, taskFormatted: '', conversationFormatted: 'conversation-only-persona' }),
    robot_status_out: async () => ({ persisted: true }),
    environment_face_expression: async (input: any) => ({ control: input.control, success: true }),
    environment_training_output: async () => ({}),
  }
  const originals = new Map(Object.keys(replacements).map(key => [key, nodeExecutors.get(key)!]))
  for (const [key, value] of Object.entries(replacements)) nodeExecutors.set(key, value)
  try {
    await withUserContext({ username, userId: username, role: 'standard' }, async () => {
      const parent = manager.enqueue({ type: 'generic', username, input: {}, maxAttempts: 1 })
      manager.claim(parent.id)
      const run = (executionId?: string) => withGraphWork(parent, id => manager.attachExecution(parent.id, id),
        () => runDurableGraph({ graph, executionId, context: { username, userId: username, userMessage: 'Inspect the requested file.', recordPersonaMemory: false } }),
        async input => manager.enqueue(input))
      const initial = await run()
      assert.equal(initial.status, 'waiting', initial.error?.stack)
      assert.equal(modelInputs.length, 1, 'Only intent inference; local task inference is skipped')
      assert.equal(manager.getAllTasks().some(task => task.username === username && task.handler === 'environment.tools'), false,
        'Codex cannot begin before the acknowledgment is delivered')
      const acknowledgment = manager.getAllTasks().find(task => task.username === username && task.handler === 'environment.conversation')!
      manager.claim(acknowledgment.id)
      await (engine as any).execute(acknowledgment)
      assert.equal(manager.getTask(acknowledgment.id)?.state, 'completed', manager.getTask(acknowledgment.id)?.error?.message)
      const resumed = await run(initial.executionId)
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
      const work = manager.getAllTasks().find(task => task.username === username && task.handler === 'environment.tools')!
      assert.ok(work, 'Tool work admitted after acknowledgment')
      manager.claim(work.id)
      await (engine as any).execute(work)
      assert.equal(manager.getTask(work.id)?.state, 'completed', manager.getTask(work.id)?.error?.message)
      assert.equal(calls, 1)
      assert.deepEqual(modelInputs.map(input => input.role), ['orchestrator', 'persona', 'persona'])
      assert.deepEqual(loadBufferForUser(username, 'conversation').messages.map(entry => entry.content),
        ['I will look into it.', 'The file is /tmp/fixture.txt.'])
    })
  } finally {
    for (const [key, value] of originals) nodeExecutors.set(key, value)
    fullGraphRun = false
  }
})
