import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { registerProfileStorageConfigGetter } from './path-builder.js'
import { ROOT } from './paths.js'
import {
  decideMemoryIndexRefresh,
  getIndexStatus,
  indexFilePath,
  MemoryIndexIncompatibleError,
  MemoryIndexReconciliationQueuedError,
  MemoryIndexUnavailableError,
  queryIndex,
  queryIndexWithReconciliation,
  refreshMemoryIndex,
  type MemoryIndexStatus,
} from './vector-index.js'

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
  assert.deepEqual(decideMemoryIndexRefresh({ exists: false, reason: 'legacy' }, {}, now), {
    refresh: true,
    reason: 'legacy',
  })
  assert.deepEqual(decideMemoryIndexRefresh({ exists: false, reason: 'corrupt' }, {}, now), {
    refresh: true,
    reason: 'corrupt',
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

test('memory index inspection distinguishes missing, legacy, and corrupt profile indexes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-vector-index-status-'))
  const username = `vector-index-${process.pid}`
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  assert.deepEqual(getIndexStatus(undefined, username), {
    exists: false,
    reason: 'missing',
  })

  const canonicalPath = indexFilePath(undefined, username)
  const legacyPath = path.join(path.dirname(canonicalPath), 'embeddings-nomic-embed-text.json')
  fs.writeFileSync(legacyPath, JSON.stringify({
    meta: {
      model: 'nomic-embed-text',
      provider: 'ollama',
      createdAt: '2025-11-21T04:20:13.070Z',
      items: 1,
      dimensions: 768,
    },
    data: [],
  }))

  const legacyStatus = getIndexStatus(undefined, username)
  assert.equal(legacyStatus.exists, false)
  if (legacyStatus.exists) return
  assert.equal(legacyStatus.reason, 'legacy')
  assert.equal(legacyStatus.legacyIndexes?.[0]?.fileName, 'embeddings-nomic-embed-text.json')
  await assert.rejects(
    queryIndex('memory query', { username }),
    error => error instanceof MemoryIndexUnavailableError && error.status.reason === 'legacy',
  )

  fs.writeFileSync(canonicalPath, '{broken')
  const corruptStatus = getIndexStatus(undefined, username)
  assert.equal(corruptStatus.exists, false)
  if (corruptStatus.exists) return
  assert.equal(corruptStatus.reason, 'corrupt')
  assert.equal(corruptStatus.legacyIndexes?.length, 1)
})

test('the Core index remains the only maintained semantic-memory implementation', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'brain', 'services', 'memory-service.ts')), false)
  assert.equal(fs.existsSync(path.join(ROOT, 'brain', 'services', 'semantic-search-service.ts')), false)
  const memorySource = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'memory.ts'), 'utf8')
  const vectorSource = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'vector-index.ts'), 'utf8')
  assert.doesNotMatch(memorySource, /memory-service-client|brain\/services\/(?:memory|semantic-search)-service/)
  assert.match(vectorSource, /scanEpisodicMemoryRecords\(username\)/)
  assert.doesNotMatch(vectorSource, /localhost:11434|nomic-embed-text/)
})

test('profile search queues one visible reconciliation for unavailable and incompatible indexes', async () => {
  const submissions: Array<Record<string, any>> = []
  const submitRefresh = async (input: Record<string, any>) => {
    submissions.push(input)
    return { id: `rebuild-${submissions.length}` }
  }

  await assert.rejects(
    queryIndexWithReconciliation('memory query', {
      username: 'profile-one',
      reconciliationSource: 'memory-router',
    }, {
      query: async () => {
        throw new MemoryIndexUnavailableError({ exists: false, reason: 'legacy' })
      },
      submitRefresh,
    }),
    error => error instanceof MemoryIndexReconciliationQueuedError
      && error.taskId === 'rebuild-1'
      && /queued as rebuild-1/.test(error.message),
  )
  await assert.rejects(
    queryIndexWithReconciliation('memory query', {
      username: 'profile-one',
      reconciliationSource: 'semantic-search-node',
    }, {
      query: async () => { throw new MemoryIndexIncompatibleError() },
      submitRefresh,
    }),
    error => error instanceof MemoryIndexReconciliationQueuedError
      && error.taskId === 'rebuild-2',
  )

  assert.deepEqual(submissions, [
    {
      username: 'profile-one',
      source: 'system',
      force: false,
      metadata: { producer: 'memory-router', reason: 'MEMORY_INDEX_UNAVAILABLE' },
    },
    {
      username: 'profile-one',
      source: 'system',
      force: true,
      metadata: { producer: 'semantic-search-node', reason: 'MEMORY_INDEX_INCOMPATIBLE' },
    },
  ])
})
