import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { encrypt, initializeEncryption, lockProfile } from './encryption.js'
import {
  scanEpisodicMemoryRecords,
  updateEpisodicMemoryMetadata,
  type EpisodicEvent,
} from './memory.js'
import { registerProfileStorageConfigGetter } from './path-builder.js'

setAuditEnabled(false)

function event(id: string): EpisodicEvent {
  return {
    id,
    timestamp: '2026-08-29T12:00:00.000Z',
    content: 'The user is planning a garden project.',
    type: 'observation',
    tags: ['inbox'],
    entities: [],
    metadata: { cognitiveMode: 'agent' },
  }
}

const organizerMetadata = {
  processed: true as const,
  processedAt: '2026-08-29T12:01:00.000Z',
  organizerStatus: 'updated' as const,
}

function profile(t: test.TestContext): { username: string; episodic: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-memory-enrichment-'))
  const username = `memory-enrichment-${process.pid}-${Date.now()}-${Math.random()}`
  const episodic = path.join(root, 'memory', 'episodic')
  fs.mkdirSync(episodic, { recursive: true })
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { username, episodic }
}

test('Core scans and atomically updates one validated episodic record', t => {
  const { username, episodic } = profile(t)
  const directory = path.join(episodic, '2026', '08')
  const filePath = path.join(directory, 'memory.json')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ ...event('evt-one'), preservedField: 'keep-me' }))

  const outcomes = [...scanEpisodicMemoryRecords(username)]
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].status, 'record')
  if (outcomes[0].status !== 'record') return
  assert.equal(outcomes[0].record.relativePath, path.join('2026', '08', 'memory.json'))

  const updated = updateEpisodicMemoryMetadata({
    username,
    relativePath: outcomes[0].record.relativePath,
    expectedId: 'evt-one',
    tags: ['inbox', 'garden'],
    entities: ['Community Garden'],
    metadata: {
      ...organizerMetadata,
      model: 'test-model',
    },
  })

  assert.equal(updated.encrypted, false)
  const durable = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  assert.deepEqual(durable.tags, ['inbox', 'garden'])
  assert.deepEqual(durable.entities, ['Community Garden'])
  assert.equal(durable.metadata.processed, true)
  assert.equal(durable.preservedField, 'keep-me')
  assert.equal(fs.readdirSync(path.join(directory, '.backups')).length, 1)
})

test('Core reports malformed, oversized, and locked encrypted records explicitly', t => {
  const { username, episodic } = profile(t)
  fs.writeFileSync(path.join(episodic, 'bad.json'), '{broken')
  fs.writeFileSync(path.join(episodic, 'large.json'), JSON.stringify(event('evt-large')) + ' '.repeat(200))
  fs.writeFileSync(path.join(episodic, 'locked.json.enc'), '{}')
  fs.writeFileSync(path.join(episodic, 'wrong-types.json'), JSON.stringify({
    id: 1,
    timestamp: '2026-08-29T12:00:00.000Z',
    content: 'x',
  }))
  fs.writeFileSync(path.join(episodic, 'ignored.bin'), Buffer.from([0, 1, 2]))

  const outcomes = [...scanEpisodicMemoryRecords(username, { maxFileSizeBytes: 150 })]
  assert.equal(outcomes.length, 4)
  assert.equal(outcomes.every(outcome => outcome.status === 'failed'), true)
  const errors = outcomes.map(outcome => outcome.status === 'failed' ? outcome.error : '').join('\n')
  assert.match(errors, /Unexpected token|Expected property name|JSON/)
  assert.match(errors, /exceeds 150 bytes/)
  assert.match(errors, /unavailable while the profile is locked/)
  assert.match(errors, /requires string id, timestamp, and content fields/)
})

test('Core scans encrypted episodic records through the unlocked profile owner', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-memory-enrichment-encrypted-'))
  const username = `memory-enrichment-encrypted-${process.pid}-${Date.now()}`
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

  fs.writeFileSync(
    path.join(episodic, 'memory.json.enc'),
    JSON.stringify(encrypt(JSON.stringify(event('evt-encrypted')), key)),
  )

  const outcomes = [...scanEpisodicMemoryRecords(username)]
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].status, 'record')
  if (outcomes[0].status !== 'record') return
  assert.equal(outcomes[0].record.encrypted, true)
  assert.equal(outcomes[0].record.event.id, 'evt-encrypted')
})

test('Core rejects invalid bounds, path traversal, and stale record identity', t => {
  const { username, episodic } = profile(t)
  fs.writeFileSync(path.join(episodic, 'memory.json'), JSON.stringify(event('evt-stable')))

  assert.throws(
    () => [...scanEpisodicMemoryRecords(username, { maxFileSizeBytes: 0 })],
    /positive integer/,
  )
  assert.throws(
    () => [...scanEpisodicMemoryRecords(username, { maxFiles: 0 })],
    /maximum file count must be a positive integer/,
  )
  assert.throws(
    () => updateEpisodicMemoryMetadata({
      username,
      relativePath: '../memory.json',
      expectedId: 'evt-stable',
      tags: [],
      entities: [],
      metadata: organizerMetadata,
    }),
    /escapes its profile root/,
  )
  assert.throws(
    () => updateEpisodicMemoryMetadata({
      username,
      relativePath: 'memory.json',
      expectedId: 'evt-replaced',
      tags: [],
      entities: [],
      metadata: organizerMetadata,
    }),
    /identity changed/,
  )
  assert.throws(
    () => updateEpisodicMemoryMetadata({
      username,
      relativePath: 'memory.json',
      expectedId: 'evt-stable',
      tags: [],
      entities: [],
      metadata: { ...organizerMetadata, cognitiveMode: 'dual' } as any,
    }),
    /outside the Organizer contract/,
  )
})

test('Core can bound a newest-first episodic scan for finite agents', t => {
  const { username, episodic } = profile(t)
  for (const [file, id] of [
    ['2026-08-27.json', 'evt-oldest'],
    ['2026-08-28.json', 'evt-middle'],
    ['2026-08-29.json', 'evt-newest'],
  ]) {
    fs.writeFileSync(path.join(episodic, file), JSON.stringify(event(id)))
  }

  const outcomes = [...scanEpisodicMemoryRecords(username, {
    maxFiles: 2,
    newestFirst: true,
  })]
  assert.equal(outcomes.length, 2)
  assert.deepEqual(outcomes.map(outcome => outcome.status === 'record' ? outcome.record.event.id : ''), [
    'evt-newest',
    'evt-middle',
  ])
})
