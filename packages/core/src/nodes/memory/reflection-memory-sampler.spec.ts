import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerProfileStorageConfigGetter } from '../../path-builder.js'
import {
  loadReflectionMemoryCandidates,
  ReflectionMemorySamplerNode,
} from './reflection-memory-sampler.node.js'

function profile(t: test.TestContext): { username: string; episodic: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-reflection-sampler-'))
  const username = `reflection-sampler-${process.pid}-${Date.now()}-${Math.random()}`
  const episodic = path.join(root, 'memory', 'episodic')
  fs.mkdirSync(episodic, { recursive: true })
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { username, episodic }
}

function memory(id: string, content: string, timestamp: string): Record<string, unknown> {
  return {
    id,
    timestamp,
    content,
    type: 'observation',
    tags: [],
    entities: [],
    metadata: {},
  }
}

test('Reflection sampler uses canonical bounded records and reports unusable files', t => {
  const { username, episodic } = profile(t)
  fs.writeFileSync(path.join(episodic, '2026-08-29-b.json'), JSON.stringify(memory(
    'evt-newest',
    'The user decided to plant tomatoes.',
    '2026-08-29T12:00:00.000Z',
  )))
  fs.writeFileSync(path.join(episodic, '2026-08-29-a.json'), JSON.stringify(memory(
    'evt-older',
    'Rain changed the garden schedule.',
    '2026-08-29T11:00:00.000Z',
  )))
  fs.writeFileSync(path.join(episodic, 'bad.json'), '{broken')
  fs.writeFileSync(path.join(episodic, 'large.json'), JSON.stringify(memory(
    'evt-large',
    'x'.repeat(5_000),
    '2026-08-29T10:00:00.000Z',
  )))
  fs.writeFileSync(path.join(episodic, 'locked.json.enc'), '{}')
  fs.writeFileSync(path.join(episodic, 'ignored.bin'), Buffer.from([0, 1, 2]))

  const scan = loadReflectionMemoryCandidates(username, 'user', {
    maxFiles: 10,
    maxFileSizeBytes: 1_000,
  })
  assert.deepEqual(scan.candidates.map(candidate => candidate.id), ['evt-newest', 'evt-older'])
  assert.equal(scan.filesConsidered, 5)
  assert.equal(scan.failures.length, 3)
  assert.match(scan.failures.map(failure => failure.error).join('\n'), /exceeds 1000 bytes/)
  assert.match(scan.failures.map(failure => failure.error).join('\n'), /profile is locked/)
})

test('Reflection sampler rejects invalid limits and does not hide a partial unusable pool', async t => {
  const { username, episodic } = profile(t)
  fs.writeFileSync(path.join(episodic, 'one.json'), JSON.stringify(memory(
    'evt-one',
    'Only one usable memory.',
    '2026-08-29T12:00:00.000Z',
  )))
  fs.writeFileSync(path.join(episodic, 'bad.json'), '{broken')

  const partial = await ReflectionMemorySamplerNode.execute({}, { username }, {
    contentMode: 'user',
    memoryCount: 4,
    maxCandidateFiles: 10,
    maxFileSizeBytes: 1_000,
    recencyHalfLifeDays: 14,
    associationBoost: 1.5,
    maxMemoryChars: 1_200,
  })
  assert.equal(partial.ready, false)
  assert.equal(partial.count, 1)
  assert.equal(partial.failedCount, 1)
  assert.match(partial.error, /failed validation/)

  const invalid = await ReflectionMemorySamplerNode.execute({}, { username }, {
    contentMode: 'user',
    memoryCount: 0,
  })
  assert.equal(invalid.ready, false)
  assert.match(invalid.error, /memoryCount must be an integer between 2 and 8/)
})
