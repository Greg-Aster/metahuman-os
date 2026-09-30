import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-sync-buffer-'))
process.env.METAHUMAN_ROOT = root
const { setAuditEnabled } = await import('./audit.js')
const { eventBus } = await import('./infrastructure/event-bus/client.js')
const { getBufferPathForUser, getBufferNotificationPath, loadBufferForUser } = await import('./conversation-buffer.js')
const { getProfilePaths } = await import('./paths.js')
const { exportProfileSyncBundle, importProfileSyncBundle, validateProfileSyncBundle } = await import('./profile-sync.js')
const { storageClient } = await import('./storage-client.js')
const { listActiveLocks } = await import('./buffer-locks.js')
const { handleBufferStream } = await import('./api/handlers/buffer-stream.js')
setAuditEnabled(false)
eventBus.disconnect()
after(() => {
  eventBus.disconnect()
  fs.rmSync(root, { recursive: true, force: true })
})

const modes = ['conversation', 'inner', 'system', 'robot'] as const

test('sync exports the actual per-user buffer paths and imports only into the selected profile', async () => {
  const source = 'buffer-source'
  const target = 'buffer-target'
  const other = 'buffer-other'
  const originals = new Map<string, string>()
  const otherOriginals = new Map<string, string>()
  for (const mode of modes) {
    const file = getBufferPathForUser(source, mode)
    const content = JSON.stringify({ messages: [{ role: 'assistant', content: `Synthetic ${mode} entry`, timestamp: 1000 }], lastUpdated: '2026-09-29T12:00:00.000Z', userMessageCount: 0 })
    fs.writeFileSync(file, content)
    originals.set(mode, content)
    const otherContent = JSON.stringify({ messages: [{ role: 'user', content: `Other profile ${mode}`, timestamp: 500 }] })
    otherOriginals.set(mode, otherContent)
    fs.writeFileSync(getBufferPathForUser(other, mode), otherContent)
  }
  const obsolete = path.join(getProfilePaths(source).state, 'conversation-buffer.inner.json')
  fs.writeFileSync(obsolete, '{"messages":[]}')
  const bundle = await exportProfileSyncBundle(source)
  assert.deepEqual(bundle.files.map(file => file.path).sort(), modes.map(mode => `state/conversation-buffer-${mode}.json`).sort())
  assert.equal(bundle.stats?.excludedFiles, 1)
  const imported = await importProfileSyncBundle(target, bundle, { expectedSourceUsername: source })
  assert.equal(imported.success, true)
  assert.equal(imported.imported, 4)
  assert.equal((await importProfileSyncBundle(target, bundle)).success, true)
  for (const mode of modes) {
    assert.equal(fs.readFileSync(getBufferPathForUser(target, mode), 'utf8'), originals.get(mode))
    assert.equal(loadBufferForUser(target, mode).messages.length, 1)
    assert.equal(fs.readFileSync(getBufferPathForUser(source, mode), 'utf8'), originals.get(mode))
    assert.equal(fs.readFileSync(getBufferPathForUser(other, mode), 'utf8'), otherOriginals.get(mode))
    assert.equal(fs.existsSync(getBufferNotificationPath(other, mode)), false)
  }
  for (const name of ['conversation-buffer.json', 'conversation-buffer.inner.json', 'conversation-buffer-unknown.json', 'device-local.json']) {
    assert.throws(() => validateProfileSyncBundle({ ...bundle, files: [{ path: `state/${name}`, content: '{}' }] }), /Unsupported profile bundle path/)
  }
})

test('buffer import uses the selected profile lock and emits an update to its existing chat stream', async () => {
  const source = 'stream-source'
  const target = 'stream-target'
  const file = getBufferPathForUser(source, 'conversation')
  fs.writeFileSync(file, JSON.stringify({ messages: [{ role: 'assistant', content: 'Synthetic imported history', timestamp: 2000 }], lastUpdated: '2026-09-29T12:00:00.000Z' }))
  const bundle = await exportProfileSyncBundle(source)
  const abort = new AbortController()
  const response = await handleBufferStream({ method: 'GET', query: { mode: 'conversation' }, user: { username: target, isAuthenticated: true }, signal: abort.signal } as any)
  const stream = response.stream as AsyncGenerator<string>
  try {
    await stream.next() // connected
    const empty = await stream.next()
    assert.deepEqual(JSON.parse(empty.value.slice(6)).messages, [])
    const update = stream.next() // arm the existing notification watcher
    const timer = setTimeout(() => abort.abort(), 2000)
    try {
      const imported = await importProfileSyncBundle(target, bundle, {}, {
        ...storageClient,
        remove: storageClient.delete,
        write: async request => {
          assert.ok(listActiveLocks().some(lock => lock.username === target && lock.mode === 'conversation'))
          return storageClient.write(request)
        },
      })
      assert.equal(imported.success, true)
      const next = await update
      assert.equal(next.done, false, 'import must notify the open chat stream')
      assert.equal(JSON.parse(next.value.slice(6)).messages.length, 1)
    } finally { clearTimeout(timer) }
  } finally {
    abort.abort()
    await stream.return('')
  }
})
