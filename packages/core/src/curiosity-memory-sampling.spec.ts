import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerProfileStorageConfigGetter } from './path-builder.js'
import {
  sampleCuriosityMemories,
  selectCuriosityMemories,
  type CuriosityMemoryEvidence,
} from './curiosity-memory-sampling.js'

const NOW = Date.parse('2026-08-28T12:00:00.000Z')

function memory(id: string, daysOld: number, content = `Memory content for ${id}`): CuriosityMemoryEvidence {
  return {
    __memoryId: id,
    id,
    timestamp: new Date(NOW - daysOld * 86_400_000).toISOString(),
    type: 'observation',
    content,
  }
}

test('bounded curiosity sampling reads only the newest candidate window and reports unusable records', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curiosity-sampling-'))
  const username = `curiosity-sampling-${process.pid}`
  const episodic = path.join(root, 'memory', 'episodic', '2026', '08', '28')
  fs.mkdirSync(episodic, { recursive: true })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)

  fs.writeFileSync(path.join(episodic, 'evt-010.json'), JSON.stringify({
    id: 'evt-010', timestamp: '2026-08-28T10:00:00.000Z', type: 'observation', content: 'A useful recent memory.',
  }))
  fs.writeFileSync(path.join(episodic, 'evt-009.json'), JSON.stringify({
    id: 'evt-009', timestamp: '2026-08-28T09:00:00.000Z', type: 'inner_dialogue', content: 'Generated recursion.',
  }))
  fs.writeFileSync(path.join(episodic, 'evt-008.json'), '{malformed')
  fs.writeFileSync(path.join(episodic, 'evt-007.json'), JSON.stringify({
    id: 'evt-007', timestamp: '2026-08-28T07:00:00.000Z', type: 'observation', content: 'x'.repeat(1_000),
  }))
  fs.writeFileSync(path.join(episodic, 'evt-006.json'), JSON.stringify({
    id: 'evt-006', timestamp: '2026-08-28T06:00:00.000Z', type: 'observation', content: 'Outside the bounded window.',
  }))

  const result = await sampleCuriosityMemories({
    username,
    sampleSize: 2,
    candidateLimit: 4,
    maxFileBytes: 300,
    now: NOW,
    random: () => 0,
  })

  assert.deepEqual(result.memories.map(item => item.id), ['evt-010'])
  assert.equal(result.diagnostics.filesConsidered, 4)
  assert.equal(result.diagnostics.filesRead, 3)
  assert.equal(result.diagnostics.skippedGenerated, 1)
  assert.equal(result.diagnostics.skippedMalformed, 1)
  assert.equal(result.diagnostics.skippedOversize, 1)
})

test('curiosity selection is distinct and validates resource limits', async () => {
  const selected = selectCuriosityMemories(
    [memory('one', 0), memory('two', 1), memory('three', 2)],
    3,
    14,
    NOW,
    () => 0,
  )
  assert.equal(selected.length, 3)
  assert.equal(new Set(selected.map(item => item.id)).size, 3)

  await assert.rejects(
    sampleCuriosityMemories({ username: 'test', sampleSize: 0 }),
    /sampleSize must be a positive integer/,
  )
  await assert.rejects(
    sampleCuriosityMemories({ username: 'test', sampleSize: 5, candidateLimit: 2 }),
    /candidateLimit must be at least sampleSize/,
  )
  assert.throws(
    () => selectCuriosityMemories([memory('one', 0)], 1, 14, NOW, () => 1),
    /random source/,
  )
})
