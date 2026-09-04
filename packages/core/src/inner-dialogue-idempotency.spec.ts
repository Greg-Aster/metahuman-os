import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { loadBufferForUser } from './conversation-buffer.js'
import { withUserContext } from './context.js'
import { eventBus } from './infrastructure/event-bus/client.js'
import { InnerDialogueSaverNode } from './nodes/cognitive/inner-dialogue-saver.node.js'
import { InnerDialogueBufferNode } from './nodes/output/inner-dialogue-buffer.node.js'
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

test('Inner Buffer admission deduplicates one producer execution across buffer and memory', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-inner-dialogue-idempotency-'))
  const username = `inner-dialogue-idempotency-${process.pid}`
  const idempotencyKey = 'inner-curiosity:test-execution'
  const timestamp = '2026-08-28T10:00:00.000Z'
  const content = 'A stable private question and answer.'
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

  const submit = () => withUserContext(
    { userId: 'inner-dialogue-user', username, role: 'owner' },
    async () => {
      const context = {
        username,
        recordPersonaMemory: true,
        idempotencyKey,
        memoryTimestamp: timestamp,
      }
      const admission = await InnerDialogueBufferNode.execute({
        entry: {
          role: 'reflection',
          content,
          meta: {
            type: 'inner_question',
            tags: ['inner-curiosity', 'inner'],
            idempotencyKey,
          },
        },
      }, context, {})
      const memory = await InnerDialogueSaverNode.execute({ entries: admission.entries }, context, {})
      return { admission, memory }
    },
  )

  const first = await submit()
  const replay = await submit()
  assert.equal(first.admission.persisted, true)
  assert.equal(first.admission.savedCount, 1)
  assert.deepEqual(first.admission.roleCounts, { reflection: 1 })
  assert.equal(first.admission.results.length, 1)
  assert.equal(first.memory.saved, true)
  assert.equal(replay.admission.persisted, true)
  assert.equal(replay.admission.savedCount, 1)
  assert.equal(replay.memory.saved, true)
  assert.equal(replay.memory.results[0]?.deduplicated, true)

  const buffer = loadBufferForUser(username, 'inner')
  assert.equal(buffer.messages.length, 1)
  assert.equal(buffer.messages[0]?.content, content)
  assert.equal(buffer.messages[0]?.meta?.idempotencyKey, idempotencyKey)
  assert.deepEqual(buffer.messages[0]?.meta?.tags, ['inner-curiosity', 'inner'])

  const memories = jsonFiles(getProfilePaths(username).episodic)
  assert.equal(memories.length, 1)
  const memory = JSON.parse(fs.readFileSync(memories[0], 'utf8')) as Record<string, unknown>
  assert.equal(memory.content, content)
  assert.equal(memory.timestamp, timestamp)
})

test('Inner Buffer derives a role-scoped key and reuses durable text on retry', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-inner-dialogue-retry-'))
  const username = `inner-dialogue-retry-${process.pid}`
  const executionKey = 'reflector:test-user:task-stable'
  const timestamp = '2026-08-29T10:00:00.000Z'
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

  const admit = (content: string) => withUserContext(
    { userId: 'real-user-id', username, role: 'owner' },
    () => InnerDialogueBufferNode.execute({ text: content }, {
      username,
      idempotencyKey: executionKey,
      memoryTimestamp: timestamp,
    }, {
      role: 'reflection',
      tags: ['reflection'],
    }),
  )

  const partial = await admit('The first durable reflection.')
  assert.equal(partial.saved, true)
  assert.equal(jsonFiles(getProfilePaths(username).episodic).length, 0)

  const retry = await admit('A changed model response on retry.')
  const save = await withUserContext(
    { userId: 'real-user-id', username, role: 'owner' },
    () => InnerDialogueSaverNode.execute({ entries: retry.entries }, {
      username,
      recordPersonaMemory: true,
    }, {}),
  )
  const repeated = await admit('Another changed response.')
  const repeatedSave = await withUserContext(
    { userId: 'real-user-id', username, role: 'owner' },
    () => InnerDialogueSaverNode.execute({ entries: repeated.entries }, {
      username,
      recordPersonaMemory: true,
    }, {}),
  )
  assert.equal(retry.text, 'The first durable reflection.')
  assert.equal(repeated.text, 'The first durable reflection.')
  assert.equal(save.saved, true)
  assert.equal(repeatedSave.saved, true)
  assert.equal(repeatedSave.results[0]?.deduplicated, true)

  const buffer = loadBufferForUser(username, 'inner')
  assert.equal(buffer.messages.length, 1)
  assert.equal(buffer.messages[0]?.content, 'The first durable reflection.')
  assert.equal(buffer.messages[0]?.meta?.idempotencyKey, `${executionKey}:reflection`)

  const memories = jsonFiles(getProfilePaths(username).episodic)
  assert.equal(memories.length, 1)
  const memory = JSON.parse(fs.readFileSync(memories[0], 'utf8')) as Record<string, unknown>
  assert.equal(memory.content, 'The first durable reflection.')
  assert.equal(memory.timestamp, timestamp)
})

test('Inner Buffer does not release passthrough when admission fails', async () => {
  const result = await InnerDialogueBufferNode.execute({
    entries: [{ role: 'dream', content: 'A dream that was not admitted.' }],
    passthrough: 'A dream that was not admitted.',
  }, {}, {})

  assert.equal(result.saved, false)
  assert.equal(result.reason, 'No authenticated username')
  assert.equal(result.passthrough, undefined)
})
