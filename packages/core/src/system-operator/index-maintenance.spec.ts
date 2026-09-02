import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { encrypt, initializeEncryption, lockProfile } from '../encryption.js'
import { registerProfileStorageConfigGetter } from '../path-builder.js'
import { checkIndexHealth } from './index-maintenance.js'

test('index health counts unlocked encrypted records and fails visibly while locked', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-index-health-encrypted-'))
  const username = `index-health-encrypted-${process.pid}-${Date.now()}`
  const episodic = path.join(root, 'memory', 'episodic')
  fs.mkdirSync(episodic, { recursive: true })
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'encrypted', encryption: { type: 'aes256' } }
    : undefined)
  const { key } = initializeEncryption(root, 'test-password')
  t.after(() => {
    lockProfile(root)
    fs.rmSync(root, { recursive: true, force: true })
  })

  fs.writeFileSync(path.join(episodic, 'memory.json.enc'), JSON.stringify(encrypt(JSON.stringify({
    id: 'encrypted-memory',
    timestamp: '2026-08-31T12:00:00.000Z',
    content: 'Encrypted memory content.',
    type: 'observation',
    tags: [],
    entities: [],
  }), key)))

  const health = checkIndexHealth(username)
  assert.equal(health.totalMemories, 1)
  assert.equal(health.missingFromIndex, 1)
  assert.equal(health.needsRebuild, true)

  lockProfile(root)
  assert.throws(
    () => checkIndexHealth(username),
    /unavailable while the profile is locked/,
  )
})
