import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Exercise the real editable graphs, buffer, memory and durable admission owners.
// Rendering stays queued in this isolated installation; no model or hardware is called.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-task-speech-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the speech fixture') }
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const voice = await import('../../tts/robot-speech.js')
mock.module(new URL('../../tts/robot-speech.ts', import.meta.url).href, { namedExports: {
  ...voice,
  getSpeechOutputSettings: () => ({ provider: 'kokoro', outputTarget: 'robot', speechDisabled: false }),
  getRobotSpeakerSession: () => 'fixture-body',
} })
const { createUser } = await import('../../users.js')
const { getProfilePaths } = await import('../../path-builder.js')
const { withUserContext } = await import('../../context.js')
const { getQueueManager } = await import('../../queue/unified-queue-manager.js')
const { runDurableGraph, withGraphWork } = await import('../../durable-execution/runtime.js')
const { loadGraphForMode } = await import('../../graph-streaming.js')
const { loadBufferForUser } = await import('../../conversation-buffer.js')
const username = 'task-speech-fixture'
createUser(username, 'fixture-only-password', 'owner')
const profile = getProfilePaths(username)
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
fs.cpSync(path.join(repo, 'etc/cognitive-graphs'), path.join(root, 'etc/cognitive-graphs'), { recursive: true })
const manager = getQueueManager()

test('final Persona reply reaches buffer, memory and speech once and survives resume', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const { graph } = await loadGraphForMode('environment-conversation', username)
    const text = "You know, that look on your face is giving off serious 'I'm one bug away from enlightenment' vibes. Or maybe you're just trying to decide if you should stare at the screen or stare at the wall. Either way, I'm rooting for you."
    const metadata = { source: 'autonomy', dialogueSource: 'boredom-observer', correlationId: 'observer-cycle',
      tags: ['robot-operator', 'boredom-observer', 'autonomy-trigger'] }
    const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'user', username,
      maxAttempts: 1, input: {} })
    assert.ok(manager.claim(work.id))
    const started = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runDurableGraph({
      graph, context: { username, userId: username, cognitiveMode: 'environment', allowMemoryWrites: true,
        environmentConversationMetadata: metadata,
        environmentConversationResponse: text },
    }), async input => manager.enqueue(input))
    assert.equal(started.error, undefined)
    assert.equal(started.status, 'waiting', 'The root retains outstanding renderer work, independently of task progression')
    assert.equal(started.pending?.length ?? 0, 0, 'No graph node waits for speech playback')
    const entries = loadBufferForUser(username, 'conversation').messages
    assert.equal(entries.length, 1)
    assert.equal(entries[0].content, text)
    assert.equal(entries[0].role, 'assistant')
    assert.equal(entries[0].meta?.executionId, started.executionId)
    for (const [key, value] of Object.entries(metadata)) assert.deepEqual(entries[0].meta?.[key], value)
    const speech = manager.getAllTasks().filter(item => item.handler === 'tts.robot-speech')
    assert.equal(speech.length, 1)
    assert.equal(speech[0].input.text, text)
    assert.equal(speech[0].durable?.executionId, started.executionId)
    // Resuming the same durable execution cannot create a second feed entry or renderer.
    await runDurableGraph({ graph, executionId: started.executionId, context: { username } })
    assert.equal(loadBufferForUser(username, 'conversation').messages.length, 1)
    assert.equal(manager.getAllTasks().filter(item => item.handler === 'tts.robot-speech').length, 1)
    const memories = fs.readdirSync(profile.episodic, { recursive: true })
      .filter(file => String(file).endsWith('.json'))
      .map(file => JSON.parse(fs.readFileSync(path.join(profile.episodic, String(file)), 'utf8')))
      .filter(entry => entry.content === text)
    assert.equal(memories.length, 1, 'Selected speech is recorded once by the existing memory owner')
    for (const [key, value] of Object.entries(metadata)) assert.deepEqual(memories[0].metadata?.[key], value)
  })
})

after(() => {
  eventBus.disconnect()
  mock.restoreAll()
  fs.rmSync(root, { recursive: true, force: true })
})
