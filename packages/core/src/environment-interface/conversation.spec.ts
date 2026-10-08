import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-conversation-work-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network or physical dispatch in conversation work tests') }
let generate = async () => 'Original response.'
const router = await import('../model-router.js')
mock.module('../model-router.js', { namedExports: { ...router, callLLM: async () => ({ content: await generate() }) } })
const voice = await import('../tts/robot-speech.js')
mock.module('../tts/robot-speech.js', { namedExports: { ...voice, getSpeechOutputSettings: () => ({ speechDisabled: false, outputTarget: 'local' }) } })
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const { createUser } = await import('../users.js')
const { withUserContext } = await import('../context.js')
const { getQueueManager } = await import('../queue/unified-queue-manager.js')
const { ExecutionEngine } = await import('../queue/execution-engine.js')
const { runDurableGraph, withGraphWork } = await import('../durable-execution/runtime.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { loadBufferForUser } = await import('../conversation-buffer.js')
const { getTTSQueueState } = await import('../tts/delivery-queue.js')
const username = 'conversation-work-fixture'
createUser(username, 'fixture-only-password', 'owner')
fs.mkdirSync(path.join(root, 'etc/cognitive-graphs'), { recursive: true })
fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/environment-conversation-mode.json', import.meta.url),
  path.join(root, 'etc/cognitive-graphs/environment-conversation-mode.json'))
const manager = getQueueManager()
const engine = new ExecutionEngine({}, manager)
const graph: any = { name: 'Conversation Work Fixture', version: '1.0', format: 'svelte-flow',
  scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 0 },
  nodes: [
    { id: 'input', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'text_input', properties: {} } },
    { id: 'context', type: 'environmentNode', position: { x: 1, y: 0 }, data: { nodeType: 'environment_context_builder', properties: {} } },
    { id: 'conversation', type: 'environmentNode', position: { x: 2, y: 0 }, data: { nodeType: 'environment_conversation', properties: { role: 'persona', format: 'text' } } },
  ], edges: [
    { id: 'input-context', source: 'input', sourceHandle: 'text', target: 'context', targetHandle: 'instruction' },
    { id: 'context-conversation', source: 'context', sourceHandle: 'messages', target: 'conversation', targetHandle: 'messages' },
  ] }
after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

async function start(request: string) {
  const timestamp = Date.now()
  const generation = getTTSQueueState(username).generation
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', resource: 'local-llm', username, source: 'user', input: { request } })
  assert.ok(manager.claim(work.id))
  const state = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runDurableGraph({ graph,
    context: { username, userId: username, cognitiveMode: 'environment', userMessage: request,
      userMessageEntry: { role: 'user', content: request, timestamp }, memoryTimestamp: timestamp,
      ttsGeneration: generation, recordPersonaMemory: false } }), async input => manager.enqueue(input))
  manager.complete(work.id, true, {})
  assert.equal(state.status, 'waiting', state.error?.stack)
  const conversation = manager.getAllTasks().find(value => value.handler === 'environment.conversation' && value.durable?.executionId === state.executionId)!
  assert.ok(conversation)
  return { state, conversation, timestamp, generation }
}

const execute = (work: any) => (engine as unknown as { execute(work: any): Promise<void> }).execute(work)

test('Coordinator generates without the parent lease and delivers once through the same execution with original turn metadata', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const run = await start('First exact request')
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    generate = async () => { entered(); await blocked; return 'A delayed response.' }
    manager.claim(run.conversation.id)
    const pending = execute(run.conversation)
    await started
    const store = openExecutionStore(username)
    try {
      const record = store.get(run.state.executionId!)
      const lease = store.claim(record.executionId, record.definition)
      store.release(lease)
      assert.equal(store.list(username).length, 1, 'Conversation work must not create a second objective')
    } finally { store.close() }
    release()
    await pending
    assert.equal(manager.getTask(run.conversation.id)!.state, 'completed', JSON.stringify(manager.getTask(run.conversation.id)!.error))
    let entries = loadBufferForUser(username, 'conversation').messages
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.role, 'assistant')
    assert.equal(entries[0]!.content, 'A delayed response.')
    assert.equal(entries[0]!.timestamp, run.timestamp)
    const outputStore = openExecutionStore(username)
    try {
      const speech = outputStore.dispatches(run.state.executionId!).filter(effect => effect.kind === 'local_tts')
      assert.equal(speech.length, 1)
      assert.equal((speech[0]!.payload as any).generation, run.generation)
    } finally { outputStore.close() }
    await execute(manager.getTask(run.conversation.id)!)
    entries = loadBufferForUser(username, 'conversation').messages
    assert.equal(entries.length, 1, 'Repeated work receipt cannot deliver a duplicate response')
  })
})

test('failed generation is a failed finite work receipt and never fabricates a response', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const run = await start('Second exact request')
    const count = loadBufferForUser(username, 'conversation').messages.length
    generate = async () => { throw new Error('Simulated backend failure') }
    manager.claim(run.conversation.id)
    await execute(run.conversation)
    assert.equal(manager.getTask(run.conversation.id)!.state, 'failed')
    assert.match(manager.getTask(run.conversation.id)!.error!.message, /Simulated backend failure/)
    assert.equal(loadBufferForUser(username, 'conversation').messages.length, count)
    const store = openExecutionStore(username)
    try {
      assert.notEqual(store.get(run.state.executionId!)!.status, 'failed', 'Speech failure does not fail the active objective')
      assert.ok(store.events(run.state.executionId!).some(event => event.kind === 'work_result' && (event.payload as any).result.state === 'failed'))
    } finally { store.close() }
  })
})
