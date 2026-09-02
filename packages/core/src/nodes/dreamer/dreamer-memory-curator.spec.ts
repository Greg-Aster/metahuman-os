import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import type { EpisodicEvent } from '../../memory.js'
import { registerProfileStorageConfigGetter } from '../../path-builder.js'
import { DreamerMemoryCuratorNode } from './dreamer-memory-curator.node.js'

setAuditEnabled(false)

function memory(id: string, type = 'observation'): EpisodicEvent {
  return {
    id,
    timestamp: '2026-09-01T12:00:00.000Z',
    content: `Observation ${id} contains enough bounded memory content for sampling.`,
    type,
    tags: [],
    entities: [],
    metadata: { cognitiveMode: 'agent' },
  }
}

function profile(t: test.TestContext): { username: string; episodic: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-dream-curator-'))
  const username = `dream-curator-${process.pid}-${Date.now()}-${Math.random()}`
  const episodic = path.join(root, 'memory', 'episodic')
  fs.mkdirSync(episodic, { recursive: true })
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { username, episodic }
}

test('Dreamer curator uses bounded canonical scan outcomes without resampling generated inner memory', async t => {
  const { username, episodic } = profile(t)
  for (const id of ['evt-a', 'evt-b', 'evt-c', 'evt-d']) {
    fs.writeFileSync(path.join(episodic, `${id}.json`), JSON.stringify(memory(id)))
  }
  fs.writeFileSync(path.join(episodic, 'evt-daydream.json'), JSON.stringify(memory('evt-daydream', 'daydream')))
  fs.writeFileSync(path.join(episodic, 'malformed.json'), '{broken')

  const result = await DreamerMemoryCuratorNode.execute!(
    {},
    { userId: username, username },
    {
      sampleSize: 3,
      decayDays: 227,
      maxCandidateFiles: 10,
      maxFileSizeBytes: 2 * 1024 * 1024,
      maxMemoryChars: 24,
    },
  )

  assert.equal(result.count, 3)
  assert.equal(result.candidateCount, 4)
  assert.equal(result.failedCount, 1)
  assert.equal(result.excludedCount, 1)
  assert.equal(result.truncatedMemoryCount, 4)
  assert.equal(result.error, undefined)
  assert.equal(result.memories.every((candidate: EpisodicEvent) => candidate.type === 'observation'), true)
  assert.equal(result.memories.every((candidate: EpisodicEvent) => candidate.content.length <= 24), true)
})

test('Dreamer curator makes unreadable insufficient memory and invalid bounds explicit', async t => {
  const { username, episodic } = profile(t)
  fs.writeFileSync(path.join(episodic, 'evt-a.json'), JSON.stringify(memory('evt-a')))
  fs.writeFileSync(path.join(episodic, 'evt-b.json'), JSON.stringify(memory('evt-b')))
  fs.writeFileSync(path.join(episodic, 'malformed.json'), '{broken')

  const result = await DreamerMemoryCuratorNode.execute!(
    {},
    { userId: username, username },
    { sampleSize: 3, maxCandidateFiles: 10 },
  )
  assert.equal(result.count, 0)
  assert.equal(result.failedCount, 1)
  assert.match(result.error, /Only 2 usable memories remained/)

  await assert.rejects(
    () => DreamerMemoryCuratorNode.execute!(
      {},
      { userId: username, username },
      { sampleSize: 2 },
    ),
    /sampleSize must be an integer between 3 and 100/,
  )
  await assert.rejects(
    () => DreamerMemoryCuratorNode.execute!(
      {},
      { userId: username, username },
      { sampleSize: 5, maxCandidateFiles: 4 },
    ),
    /maxCandidateFiles must be an integer between 5 and 10000/,
  )
})
