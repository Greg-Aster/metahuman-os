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
let outputTarget = 'local'
mock.module('../tts/robot-speech.js', { namedExports: { ...voice,
  getSpeechOutputSettings: () => ({ provider: 'kokoro', speechDisabled: false, outputTarget }),
  getRobotSpeakerSession: () => 'speech-fixture-body' } })
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
const { getProfilePaths } = await import('../path-builder.js')
const voiceConfig = getProfilePaths(username).voiceConfig
fs.mkdirSync(path.dirname(voiceConfig), { recursive: true })
fs.writeFileSync(voiceConfig, JSON.stringify({ tts: { provider: 'kokoro', kokoro: {
  langCode: 'a', voice: 'af_heart', speed: 1, autoFallbackToPiper: false,
} }, cache: { enabled: false, directory: path.join(root, 'cache') } }))
fs.mkdirSync(path.join(root, 'etc/cognitive-graphs'), { recursive: true })
fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/environment-conversation-mode.json', import.meta.url),
  path.join(root, 'etc/cognitive-graphs/environment-conversation-mode.json'))
fs.copyFileSync(new URL('../../../../etc/cognitive-graphs/robot-speech-mode.json', import.meta.url),
  path.join(root, 'etc/cognitive-graphs/robot-speech-mode.json'))
const manager = getQueueManager()
const engine = new ExecutionEngine({}, manager)
const graph: any = { name: 'Conversation Work Fixture', version: '1.0', format: 'svelte-flow',
  scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 0 },
  nodes: [
    { id: 'input', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'text_input', properties: {} } },
    { id: 'context', type: 'environmentNode', position: { x: 1, y: 0 }, data: { nodeType: 'environment_context_builder', properties: {} } },
    { id: 'conversation', type: 'environmentNode', position: { x: 2, y: 0 }, data: { nodeType: 'environment_conversation', properties: { role: 'persona', format: 'text' } } },
    { id: 'result', type: 'utilityNode', position: { x: 3, y: 0 }, data: { nodeType: 'work_result_wait', properties: {} } },
    { id: 'after-response', type: 'utilityNode', position: { x: 4, y: 0 }, data: { nodeType: 'execution_context', properties: {} } },
  ], edges: [
    { id: 'input-context', source: 'input', sourceHandle: 'text', target: 'context', targetHandle: 'instruction' },
    { id: 'context-conversation', source: 'context', sourceHandle: 'messages', target: 'conversation', targetHandle: 'messages' },
    { id: 'conversation-result', source: 'conversation', sourceHandle: 'work', target: 'result', targetHandle: 'work' },
    { id: 'result-review', source: 'result', sourceHandle: 'result', target: 'after-response', targetHandle: 'control', data: { kind: 'control' } },
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
  assert.equal(state.nodes.has('after-response'), false, 'Objective review cannot precede final response delivery')
  const conversation = manager.getAllTasks().find(value => value.handler === 'environment.conversation' && value.durable?.executionId === state.executionId)!
  assert.ok(conversation)
  return { state, conversation, timestamp, generation }
}

const execute = (work: any) => (engine as unknown as { execute(work: any): Promise<void> }).execute(work)

async function resume(executionId: string) {
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', resource: `execution:${executionId}`, username, source: 'user', input: {} })
  assert.ok(manager.claim(work.id))
  const result = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runDurableGraph({ graph,
    context: { username, userId: username }, executionId }), async input => manager.enqueue(input))
  manager.complete(work.id, result.status !== 'failed', {})
  assert.equal(result.status, 'completed', result.error?.stack)
  assert.equal(result.nodes.get('after-response')?.status, 'completed')
  return result
}

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
    const joined = await resume(run.state.executionId!)
    assert.equal(joined.nodes.get('result')?.outputs?.result.result.state, 'completed')
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
    const joined = await resume(run.state.executionId!)
    assert.equal(joined.nodes.get('result')?.outputs?.result.result.state, 'failed', 'Failure releases the same join without inventing a response')
    const store = openExecutionStore(username)
    try {
      assert.notEqual(store.get(run.state.executionId!)!.status, 'failed', 'Speech failure does not fail the active objective')
      assert.ok(store.events(run.state.executionId!).some(event => event.kind === 'work_result' && (event.payload as any).result.state === 'failed'))
    } finally { store.close() }
  })
})

test('blocked audio rendering releases conversation, admits another reply and commits playback once', async () => {
  const { KokoroService } = await import('../tts/providers/kokoro-service.js')
  let release!: () => void
  let entered!: () => void
  const rendering = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  let rendered = 0
  const synthesis = mock.method(KokoroService.prototype, 'synthesizeStream', async function* () {
    rendered++; entered(); await blocked
    const audio = Buffer.alloc(44 + 4800)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    yield { index: 0, total: 1, text: 'Fixture speech', audio, isFinal: true, synthesisMs: 0, cacheHit: false }
  })
  outputTarget = 'robot'
  try {
    await withUserContext({ username, userId: username, role: 'owner' }, async () => {
      generate = async () => 'First independently delivered response.'
      const first = await start('First request with audio')
      assert.ok(manager.claim(first.conversation.id))
      await execute(first.conversation)
      assert.equal(manager.getTask(first.conversation.id)?.state, 'completed')
      assert.equal(rendered, 0, 'Conversation delivery must only admit audio work')
      const speech = manager.getAllTasks().find(task => task.handler === 'tts.robot-speech'
        && task.durable?.executionId === first.state.executionId)!
      assert.ok(speech)
      assert.equal(speech.input.generation, first.generation)
      assert.ok(manager.claim(speech.id))
      const pendingSpeech = execute(speech)
      await Promise.race([rendering, pendingSpeech.then(() => { throw new Error(JSON.stringify(manager.getTask(speech.id)?.error)) })])
      try {
        const store = openExecutionStore(username)
        try {
          const record = store.get(first.state.executionId!)
          const lease = store.claim(record.executionId, record.definition)
          store.release(lease)
        } finally { store.close() }
        assert.ok(loadBufferForUser(username, 'conversation').messages.some(message => message.content === 'First independently delivered response.'))
        // A second turn can finish its inference and text delivery while the
        // first audio renderer is deliberately held indefinitely.
        generate = async () => 'Second independently delivered response.'
        const second = await start('Second request during rendering')
        assert.ok(manager.claim(second.conversation.id))
        await execute(second.conversation)
        assert.equal(manager.getTask(second.conversation.id)?.state, 'completed')
        assert.ok(loadBufferForUser(username, 'conversation').messages.some(message => message.content === 'Second independently delivered response.'))
        const movement = manager.enqueue({ type: 'environment_command', handler: 'environment.command', username,
          resource: 'environment:speech-fixture-body', source: 'user',
          input: { id: 'concurrent-motion', sessionId: 'speech-fixture-body', type: 'robotCommand', command: 'bow' } })
        assert.ok(manager.claim(movement.id), 'Speech preparation does not own the body')
        release()
        await pendingSpeech
        assert.equal(manager.getTask(speech.id)?.state, 'completed', JSON.stringify(manager.getTask(speech.id)?.error))
        const playback = manager.getAllTasks().find(task => task.type === 'environment_command'
          && task.input.type === 'speak' && task.durable?.executionId === first.state.executionId)!
        assert.ok(playback)
        assert.equal(playback.resource, 'environment-speech:speech-fixture-body')
        assert.ok(manager.claim(playback.id), 'Playback and movement may both be in flight')
        const { recordEnvironmentActionResult } = await import('./store.js')
        assert.equal(recordEnvironmentActionResult({ id: 'speaker-accepted', actionId: playback.input.id,
          timestamp: new Date().toISOString(), type: 'accepted', message: 'Simulated speaker accepted' })?.admitted, true)
        recordEnvironmentActionResult({ id: 'speaker-completed', actionId: playback.input.id,
          timestamp: new Date().toISOString(), type: 'completed', message: 'Simulated speaker completed' })
        assert.equal(manager.getTask(playback.id)?.state, 'completed')
        assert.equal(manager.getTask(movement.id)?.state, 'leased', 'Speech completion cannot settle movement')
        await execute(manager.getTask(speech.id)!)
        assert.equal(rendered, 1, 'Replaying a committed work receipt cannot regenerate speech')
        const saved = openExecutionStore(username)
        try {
          assert.equal(saved.dispatches(first.state.executionId!).filter(effect => effect.kind === 'coordinator_work'
            && (effect.payload as any).input?.type === 'speak').length, 1)
        } finally { saved.close() }
        manager.complete(movement.id, true)
      } finally { release(); await pendingSpeech }
    })
  } finally { outputTarget = 'local'; synthesis.mock.restore() }
})

test('speech plays the first chunk while later synthesis is pending, with ordered durable admission', async () => {
  const { KokoroService } = await import('../tts/providers/kokoro-service.js')
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const secondStarted = new Promise<void>(resolve => { entered = resolve })
  let rendered = 0
  const synthesis = mock.method(KokoroService.prototype, 'synthesizeStream', async function* () {
    rendered++
    const audio = Buffer.alloc(44 + 4800)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    yield { index: 0, total: 2, text: 'First chunk.', audio, isFinal: false, synthesisMs: 0, cacheHit: false }
    entered(); await blocked
    yield { index: 1, total: 2, text: 'Second chunk.', audio, isFinal: true, synthesisMs: 0, cacheHit: false }
  })
  outputTarget = 'robot'
  try {
    await withUserContext({ username, userId: username, role: 'owner' }, async () => {
      generate = async () => 'First chunk. Second chunk.'
      const run = await start('Please tell me what you see')
      assert.ok(manager.claim(run.conversation.id))
      await execute(run.conversation)
      const speech = manager.getAllTasks().find(task => task.handler === 'tts.robot-speech'
        && task.durable?.executionId === run.state.executionId)!
      assert.ok(manager.claim(speech.id))
      const pending = execute(speech)
      try {
        await Promise.race([secondStarted, pending.then(() => { throw new Error(JSON.stringify(manager.getTask(speech.id)?.error)) })])
        const playbacks = () => manager.getAllTasks().filter(task => task.type === 'environment_command'
          && task.input.type === 'speak' && task.durable?.executionId === run.state.executionId)
        assert.equal(playbacks().length, 1, 'First audio must be admitted before all synthesis completes')
        const first = playbacks()[0]!
        assert.ok(manager.claim(first.id))
        release(); await pending
        assert.equal(manager.getTask(speech.id)?.state, 'completed', JSON.stringify(manager.getTask(speech.id)?.error))
        assert.equal(playbacks().length, 2)
        const second = playbacks().find(task => task.id !== first.id)!
        assert.equal(manager.claim(second.id), null, 'Chunks share the speaker lane and cannot overlap')
        const { recordEnvironmentActionResult } = await import('./store.js')
        for (const [index, playback] of [first, second].entries()) {
          assert.equal(playback.input.metadata.speechChunkIndex, index)
          assert.equal(playback.input.metadata.speechChunkCount, 2)
          assert.equal(playback.input.metadata.speechRequestId, speech.input.requestId)
          if (index) assert.ok(manager.claim(playback.id), 'Next chunk becomes runnable after the prior receipt')
          recordEnvironmentActionResult({ id: `chunk-${index}-accepted`, actionId: playback.input.id,
            timestamp: new Date().toISOString(), type: 'accepted', message: 'Simulated speaker accepted' })
          recordEnvironmentActionResult({ id: `chunk-${index}-completed`, actionId: playback.input.id,
            timestamp: new Date().toISOString(), type: 'completed', message: 'Simulated speaker completed' })
          assert.equal(manager.getTask(playback.id)?.state, 'completed')
        }
        await execute(manager.getTask(speech.id)!)
        assert.equal(rendered, 1, 'Committed work does not synthesize again on replay')
        const saved = openExecutionStore(username)
        try {
          assert.equal(saved.dispatches(run.state.executionId!).filter(effect => effect.kind === 'coordinator_work'
            && (effect.payload as any).input?.type === 'speak').length, 2, 'Committed chunk actions are not duplicated')
        } finally { saved.close() }
      } finally { release(); await pending }
    })
  } finally { outputTarget = 'local'; synthesis.mock.restore() }
})

for (const cancelled of [false, true]) {
  test(`speech rendering ${cancelled ? 'cancellation' : 'failure'} retains delivered text without dispatching audio`, async () => {
    const { KokoroService } = await import('../tts/providers/kokoro-service.js')
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const synthesis = mock.method(KokoroService.prototype, 'synthesizeStream', async function* (
      _text: string, options?: import('../tts/interface.js').TTSSynthesizeOptions,
    ) {
      started(); await pending
      if (cancelled) options?.signal?.throwIfAborted()
      throw new Error('Simulated audio rendering failure')
    })
    outputTarget = 'robot'
    try {
      await withUserContext({ username, userId: username, role: 'owner' }, async () => {
        const response = `Text survives audio ${cancelled ? 'cancellation' : 'failure'}.`
        generate = async () => response
        const run = await start(response)
        assert.ok(manager.claim(run.conversation.id))
        await execute(run.conversation)
        const speech = manager.getAllTasks().find(task => task.handler === 'tts.robot-speech'
          && task.durable?.executionId === run.state.executionId)!
        assert.ok(manager.claim(speech.id))
        const rendering = execute(speech)
        await Promise.race([entered, rendering.then(() => { throw new Error('Renderer did not start') })])
        if (cancelled) manager.cancel(speech.id, 'Explicit fixture cancellation')
        release(); await rendering
        assert.equal(manager.getTask(speech.id)?.state, cancelled ? 'cancelled' : 'failed')
        if (!cancelled) assert.match(manager.getTask(speech.id)?.error?.message ?? '', /Simulated audio rendering failure/)
        assert.ok(loadBufferForUser(username, 'conversation').messages.some(message => message.content === response))
        const store = openExecutionStore(username)
        try {
          assert.equal(store.dispatches(run.state.executionId!).filter(effect => effect.actionId).length, 0)
        } finally { store.close() }
      })
    } finally { release(); outputTarget = 'local'; synthesis.mock.restore() }
  })
}

test('input received during final response work reaches continuation with its own turn metadata', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const run = await start('Describe the returned result')
    const nextTurn = { userMessage: 'Now tell me about cats.', memoryTimestamp: run.timestamp + 1000,
      ttsGeneration: run.generation + 1,
      userMessageEntry: { role: 'user', content: 'Now tell me about cats.', timestamp: run.timestamp + 1000 } }
    const store = openExecutionStore(username)
    try { store.appendEvent(run.state.executionId!, { eventId: 'next-turn', kind: 'user_steering', payload: nextTurn }) }
    finally { store.close() }
    generate = async () => 'The completed result.'
    manager.claim(run.conversation.id)
    await execute(run.conversation)
    const joined = await resume(run.state.executionId!)
    const continuation = joined.nodes.get('result')!.outputs!.userInput
    for (const [field, value] of Object.entries(nextTurn)) assert.deepEqual(continuation[field], value, field)
    assert.ok(continuation.executionEvents.some((event: any) => event.eventId === 'next-turn'))
    const response = loadBufferForUser(username, 'conversation').messages.find(message => message.content === 'The completed result.')!
    assert.equal(response.timestamp, run.timestamp, 'A later input must not redate the original response')
  })
})
