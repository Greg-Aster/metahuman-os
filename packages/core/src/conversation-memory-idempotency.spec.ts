import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { loadBufferForUser } from './conversation-buffer.js'
import { withUserContext } from './context.js'
import { eventBus } from './infrastructure/event-bus/client.js'
import { ConversationBufferNode, prepareConversationEntries } from './nodes/output/conversation-buffer.node.js'
import { MemoryCaptureNode } from './nodes/output/memory-capture.node.js'
import { getProfilePaths, registerProfileStorageConfigGetter, systemPaths } from './path-builder.js'

setAuditEnabled(false)

function jsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return jsonFiles(target)
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : []
  })
}

test('Conversation Buffer entries are saved independently and replay idempotently in Persona Memory', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-conversation-memory-'))
  const username = `conversation-memory-${process.pid}`
  const timestamp = '2026-08-30T12:00:00.000Z'
  const content = '  The same exact words can occur on both sides of a conversation.\n'
  const originalFetch = globalThis.fetch
  const originalEventEmit = eventBus.emit.bind(eventBus)
  const originalRunPath = systemPaths.run
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  t.after(() => { globalThis.fetch = originalFetch })
  t.after(() => { eventBus.emit = originalEventEmit })
  t.after(() => { systemPaths.run = originalRunPath })
  eventBus.emit = () => {}
  systemPaths.run = path.join(root, 'run')
  globalThis.fetch = async () => new Response(JSON.stringify({ task: { id: 'test-index-task' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)

  const admitAndSave = (role: 'user' | 'assistant', value: string, idempotencyKey: string) => withUserContext(
    { userId: 'conversation-memory-user', username, role: 'owner' },
    async () => {
      const context = {
        username,
        recordPersonaMemory: true,
        memoryTimestamp: timestamp,
      }
      const admission = await ConversationBufferNode.execute({
        entry: {
          role,
          content: value,
          meta: { idempotencyKey, source: 'conversation-test' },
        },
      }, context, {})
      const memory = await MemoryCaptureNode.execute({ entries: admission.entries }, context, {})
      return { admission, memory }
    },
  )

  const user = await admitAndSave('user', content, 'conversation:test:user')
  const assistant = await admitAndSave('assistant', content, 'conversation:test:assistant')
  const replay = await admitAndSave(
    'assistant',
    content,
    'conversation:test:assistant',
  )

  assert.equal(user.memory.saved, true)
  assert.equal(assistant.memory.saved, true)
  assert.equal(replay.memory.saved, true)
  assert.equal(replay.admission.entries[0]?.content, content)
  assert.equal(replay.memory.results[0]?.deduplicated, true)
  await assert.rejects(admitAndSave('assistant', 'A conflicting retry.', 'conversation:test:assistant'), /conflict|Buffer rejected/i)

  const buffer = loadBufferForUser(username, 'conversation')
  assert.equal(buffer.messages.length, 2)
  assert.deepEqual(buffer.messages.map(entry => entry.role), ['user', 'assistant'])

  const memories = jsonFiles(getProfilePaths(username).episodic)
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
  assert.equal(memories.length, 2)
  assert.deepEqual(memories.map(memory => memory.metadata.role).sort(), ['assistant', 'user'])
  assert.equal(memories.every(memory => memory.type === 'conversation'), true)
  assert.equal(memories.every(memory => memory.content === content), true)
  assert.equal(memories.every(memory => memory.timestamp === timestamp), true)

  const combined = await withUserContext(
    { userId: 'conversation-memory-user', username, role: 'owner' },
    () => ConversationBufferNode.execute({
      userMessage: 'A fresh graph-connected user turn.',
      response: 'A fresh graph-connected assistant turn.',
    }, {
      username,
      idempotencyKey: 'conversation:test:combined',
      memoryTimestamp: '2026-08-30T12:05:00.000Z',
    }, {}),
  )
  assert.equal(combined.persisted, true)
  assert.deepEqual(combined.entries.map((entry: { role: string }) => entry.role), ['user', 'assistant'])
  assert.deepEqual(
    combined.entries.map((entry: { meta?: { idempotencyKey?: string } }) => entry.meta?.idempotencyKey),
    ['conversation:test:combined:user', 'conversation:test:combined:assistant'],
  )

  const hiddenContextInput = await ConversationBufferNode.execute({}, {
    username,
    userMessage: 'This unconnected request context must not be persisted.',
  }, {})
  assert.equal(hiddenContextInput.persisted, false)
  assert.equal(hiddenContextInput.skipped, true)
  assert.equal(loadBufferForUser(username, 'conversation').messages.length, 4)
})

test('distinct node admissions retain an explicit reply link through memory capture and Curator assembly', async t => {
  const { assembleCuratorSources } = await import('./nodes/curator/source-assembler.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-conversation-linkage-'))
  const username = `conversation-linkage-${process.pid}`
  const previousEmit = eventBus.emit.bind(eventBus)
  const previousFetch = globalThis.fetch
  const previousRun = systemPaths.run
  eventBus.emit = () => {}
  systemPaths.run = path.join(root, 'run')
  globalThis.fetch = async () => new Response(JSON.stringify({ task: { id: 'fixture-index' } }), { status: 200 })
  registerProfileStorageConfigGetter(candidate => candidate === username ? { path: root, type: 'internal' } : undefined)
  t.after(() => { eventBus.emit = previousEmit; globalThis.fetch = previousFetch; systemPaths.run = previousRun; fs.rmSync(root, { recursive: true, force: true }) })
  await withUserContext({ userId: username, username, role: 'owner' }, async () => {
    const base = { username, userId: username, cognitiveMode: 'environment' as const, recordPersonaMemory: true,
      memoryTimestamp: '2026-10-15T00:00:00.000Z', sessionId: 'same-session' }
    const userEntry = prepareConversationEntries({ userMessage: 'The original request' }, { ...base, graphExecution: { occurrenceId: 'execution:user-admission' } })[0]
    const user = await ConversationBufferNode.execute({ entry: userEntry }, base, {})
    await MemoryCaptureNode.execute({ entries: user.entries }, base, {})
    const delivery = { ...base, graphExecution: { occurrenceId: 'execution:response-delivery' } }
    const payload = { response: 'The answer', metadata: { inReplyTo: user.entry.meta.idempotencyKey } }
    for (let replay = 0; replay < 2; replay++) {
      const assistantEntry = prepareConversationEntries(payload, delivery)[0]
      const assistant = await ConversationBufferNode.execute({ entry: assistantEntry }, base, {})
      await MemoryCaptureNode.execute({ entries: assistant.entries }, base, {})
    }
    const records = jsonFiles(getProfilePaths(username).episodic).map(file => ({ ...JSON.parse(fs.readFileSync(file, 'utf8')), path: file }))
    assert.equal(records.length, 2, 'replay must retain the original message identities')
    const assistant = records.find(record => record.metadata.role === 'assistant')!
    assert.equal(assistant.metadata.inReplyTo, user.entry.meta.idempotencyKey)
    assert.notEqual(assistant.metadata.idempotencyKey, assistant.metadata.inReplyTo)
    const assembled = assembleCuratorSources(records)
    assert.equal(assembled.memories.length, 1)
    assert.deepEqual(assembled.deferredPaths, [])
    assert.equal(assembled.memories[0]!.content, 'The original request')
    assert.equal(assembled.memories[0]!.response, 'The answer')
    assert.equal(assembled.memories[0]!.metadata?.cognitiveMode, 'environment')
    assert.equal(assembled.memories[0]!.metadata?.sessionId, 'same-session')
    assert.equal(Object.keys(assembled.memories[0]!.sourceHashes!).length, 2)
  })
})
