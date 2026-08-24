import assert from 'node:assert/strict'
import test from 'node:test'
import { decideMemoryIndexRefresh, refreshMemoryIndex, type MemoryIndexStatus } from './vector-index.js'

const now = Date.parse('2026-08-24T12:00:00.000Z')

function status(createdAt: string): MemoryIndexStatus {
  return {
    exists: true,
    model: 'test-embedder',
    provider: 'test',
    items: 3,
    dimensions: 4,
    createdAt,
  }
}

test('memory index refreshes when missing, stale, or explicitly forced', () => {
  assert.deepEqual(decideMemoryIndexRefresh({ exists: false }, {}, now), {
    refresh: true,
    reason: 'missing',
  })
  assert.deepEqual(decideMemoryIndexRefresh(status('2026-08-22T12:00:00.000Z'), {}, now), {
    refresh: true,
    reason: 'stale',
  })
  assert.deepEqual(decideMemoryIndexRefresh(status('2026-08-24T11:30:00.000Z'), { force: true }, now), {
    refresh: true,
    reason: 'forced',
  })
})

test('memory index refresh skips a recent complete index', () => {
  assert.deepEqual(decideMemoryIndexRefresh(status('2026-08-24T11:30:00.000Z'), {}, now), {
    refresh: false,
    reason: 'recent',
  })
})

test('memory index refresh treats invalid timestamps as stale and rejects invalid age limits', () => {
  assert.deepEqual(decideMemoryIndexRefresh(status('not-a-date'), {}, now), {
    refresh: true,
    reason: 'stale',
  })
  assert.throws(
    () => decideMemoryIndexRefresh(status('2026-08-24T11:30:00.000Z'), { maxAgeHours: -1 }, now),
    /maxAgeHours/,
  )
})

test('memory index refresh rejects unsafe usernames before resolving profile storage', async () => {
  await assert.rejects(
    refreshMemoryIndex({ username: '../other-profile' }),
    /valid username/,
  )
})
