import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { submitInnerDialogue } from './buffer-admission.js'
import { loadBufferForUser } from './conversation-buffer.js'
import { eventBus } from './infrastructure/event-bus/client.js'
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

test('the canonical Inner Buffer nodes save an entry without an agent gateway', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-buffer-admission-memory-'))
  const username = `buffer-admission-memory-${process.pid}`
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

  const options = {
    idempotencyKey: 'admission:test:inner',
    memoryTimestamp: '2026-08-30T13:01:00.000Z',
  }
  const originalContent = 'An inner thought admitted through the canonical nodes.'
  assert.equal(await submitInnerDialogue(username, {
    role: 'thought',
    content: originalContent,
    meta: { source: 'user', type: 'user_thought' },
  }, options), true)
  assert.equal(await submitInnerDialogue(username, {
    role: 'thought',
    content: 'A changed retry that must not replace the durable thought.',
    meta: { source: 'user', type: 'user_thought' },
  }, options), true)

  const buffer = loadBufferForUser(username, 'inner')
  assert.equal(buffer.messages.length, 1)
  assert.equal(buffer.messages[0]?.content, originalContent)
  const memories = jsonFiles(getProfilePaths(username).episodic)
    .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
  assert.equal(memories.length, 1)
  assert.deepEqual(memories.map(memory => memory.type), ['inner_dialogue'])
  assert.deepEqual(memories.map(memory => memory.metadata.role), ['thought'])
  assert.deepEqual(memories.map(memory => memory.content), [originalContent])
})
