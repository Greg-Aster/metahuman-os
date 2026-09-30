import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { initializeEncryption, lockProfile } from './encryption.js'
import { systemPaths, registerProfileStorageConfigGetter } from './path-builder.js'
import { profileDataCodec, readFileSync, writeFileSync } from './storage-client.js'
import { getProfileStorageConfig } from './users.js'
import { withUserContext } from './context.js'
import { captureEventWithDetails } from './memory.js'
import { eventBus } from './infrastructure/event-bus/client.js'

setAuditEnabled(false)

test('storage uses the resolved profile key for encrypted files, captures and row stores', async t => {
  t.mock.method(eventBus, 'emit', () => {})
  t.mock.method(globalThis, 'fetch', async () => Response.json({ task: { id: 'fixture-index' } }))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-storage-key-'))
  const username = 'encrypted-training-test'
  const usersDb = systemPaths.usersDb
  systemPaths.usersDb = path.join(root, 'users.json')
  fs.writeFileSync(systemPaths.usersDb, JSON.stringify({ version: 1, users: [{
    id: 'test-owner', username, role: 'owner',
    metadata: { profileStorage: { path: root, type: 'encrypted', encryption: { type: 'aes256' } } },
  }] }))
  registerProfileStorageConfigGetter(getProfileStorageConfig)
  initializeEncryption(root, 'synthetic-test-password')
  t.after(() => {
    lockProfile(root)
    systemPaths.usersDb = usersDb
    fs.rmSync(root, { recursive: true, force: true })
  })

  const request = { username, category: 'memory' as const, subcategory: 'curated/conversations', relativePath: 'sample.json' }
  const write = writeFileSync({ ...request, data: JSON.stringify({ value: 'synthetic training example' }) })
  assert.equal(write.success, true, write.error)
  assert.ok(write.path?.endsWith('.json.enc'))
  assert.equal(fs.existsSync(path.join(root, 'memory/curated/conversations/sample.json')), false)
  assert.doesNotMatch(fs.readFileSync(write.path!, 'utf8'), /synthetic training example/)
  const read = readFileSync({ ...request, encoding: 'utf8' })
  assert.equal(read.success, true, read.error)
  assert.deepEqual(JSON.parse(String(read.data)), { value: 'synthetic training example' })

  const codec = profileDataCodec(username)
  const row = codec.encode({ identity: 'synthetic run' })
  assert.deepEqual(codec.decode(row), { identity: 'synthetic run' })
  assert.doesNotMatch(row, /synthetic run/)

  const capture = (content: string) => withUserContext({ username, userId: 'test-owner', role: 'owner' }, () =>
    captureEventWithDetails(content, { type: 'conversation', timestamp: '2026-09-09T00:00:00Z',
      idempotencyKey: 'fixture-encrypted-capture', metadata: { skipDedup: true, role: 'user' } }))
  const captured = await capture('  Exact encrypted message.\n')
  assert.equal(captured.encrypted, true)
  assert.doesNotMatch(fs.readFileSync(captured.filePath, 'utf8'), /Exact encrypted message/)
  assert.equal((await capture('  Exact encrypted message.\n')).deduplicated, true)
  await assert.rejects(capture('A changed retry'), /conflicts/)

  lockProfile(root)
  await assert.rejects(capture('Must not be written as plaintext'), /locked/i)
  assert.equal(fs.existsSync(captured.filePath.replace(/\.enc$/, '')), false)
  assert.equal(readFileSync({ ...request, encoding: 'utf8' }).success, false)
  assert.equal(writeFileSync({ ...request, data: '{}' }).success, false)
  assert.throws(() => codec.decode(row), /locked/i)
  assert.throws(() => codec.encode({}), /locked/i)
})
