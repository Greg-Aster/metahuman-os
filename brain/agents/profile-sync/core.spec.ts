import assert from 'node:assert/strict'
import test from 'node:test'

import type { CaptureResult, ProfileImportResult, ProfileSyncBundle } from '@metahuman/core'
import {
  fetchProfileBundle,
  fetchMemories,
  PROFILE_SYNC_REQUEST_TIMEOUT_MS,
  parseSyncOptions,
  syncUserProfile,
  type ProfileSyncDependencies,
} from './core.js'

const NOW = new Date('2026-08-29T12:00:00.000Z')
const CONFIG = {
  serverUrl: 'https://sync.example.test',
  username: 'alice',
  password: 'secret',
  lastMemorySyncAt: '2026-08-20T00:00:00.000Z',
}
const BUNDLE: ProfileSyncBundle = {
  version: '1.0.0',
  exportedAt: NOW.toISOString(),
  username: 'alice',
  files: [{ path: 'persona/core.json', content: '{}' }],
}
const PROFILE_RESULT: ProfileImportResult = {
  success: true,
  imported: 1,
  skipped: 0,
  failed: 0,
  outcomes: [{ path: 'persona/core.json', status: 'imported', bytes: 2 }],
  errors: [],
}

function captureResult(eventId: string, deduplicated = false): CaptureResult {
  return {
    eventId,
    filePath: deduplicated ? '' : `/memory/${eventId}.json`,
    encrypted: false,
    timestamp: NOW.toISOString(),
    eventType: 'observation',
    bytesWritten: deduplicated ? 0 : 10,
    deduplicated,
  }
}

function dependencies(overrides: Partial<ProfileSyncDependencies> = {}): ProfileSyncDependencies {
  return {
    loadConfig: async () => CONFIG,
    authenticate: async () => ({ success: true, sessionId: 'session' }),
    fetchBundle: async () => ({ success: true, bundle: BUNDLE }),
    importBundle: async () => PROFILE_RESULT,
    fetchCredentials: async () => ({ status: 'unavailable' }),
    applyCredentials: async () => ({ success: true, saved: [], errors: [] }),
    fetchMemories: async () => ({
      success: true,
      memories: [{ id: 'remote-1', timestamp: NOW.toISOString(), content: 'Remote memory', type: 'observation' }],
      hasMore: false,
      total: 1,
    }),
    captureMemory: () => captureResult('local-1'),
    updateCheckpoint: async () => {},
    now: () => NOW,
    ...overrides,
  }
}

test('profile-sync options reject obsolete, conflicting, unknown, and invalid values', () => {
  assert.deepEqual(parseSyncOptions(['--profile-only', '--skip-config', '--days=30']), {
    memoriesOnly: false,
    profileOnly: true,
    fullSync: false,
    skipConfig: true,
    skipPersona: false,
    days: 30,
  })
  assert.throws(() => parseSyncOptions(['--pull-only']), /Unknown profile-sync option/)
  assert.throws(() => parseSyncOptions(['--all-users']), /Unknown profile-sync option/)
  assert.throws(() => parseSyncOptions(['--days=0']), /positive integer/)
  assert.throws(() => parseSyncOptions(['--days=NaN']), /positive integer/)
  assert.throws(() => parseSyncOptions(['--memories-only', '--profile-only']), /mutually exclusive/)
})

test('successful sync returns explicit outcomes and advances both checkpoints after completion', async () => {
  const checkpoints: Array<[string, string, string | undefined]> = []
  const result = await syncUserProfile('alice', {}, undefined, dependencies({
    updateCheckpoint: async (...args) => { checkpoints.push(args.slice(0, 3) as [string, string, string | undefined]) },
  }))
  assert.equal(result.success, true)
  assert.equal(result.profileFiles, 1)
  assert.equal(result.memoriesImported, 1)
  assert.equal(result.memoriesDeduplicated, 0)
  assert.deepEqual(result.memories.map(outcome => outcome.status), ['imported'])
  assert.deepEqual(checkpoints, [['alice', NOW.toISOString(), NOW.toISOString()]])
})

test('failed memory pages are terminal and never advance the sync cursor', async () => {
  let checkpoints = 0
  const result = await syncUserProfile('alice', { memoriesOnly: true }, undefined, dependencies({
    fetchMemories: async () => ({ success: false, error: 'remote unavailable' }),
    updateCheckpoint: async () => { checkpoints++ },
  }))
  assert.equal(result.success, false)
  assert.match(result.errors[0], /remote unavailable/)
  assert.equal(checkpoints, 0)
})

test('bounded day-range pulls do not replace the complete incremental memory cursor', async () => {
  let memoryCheckpoint: string | undefined = 'not-called'
  const result = await syncUserProfile('alice', { memoriesOnly: true, days: 7 }, undefined, dependencies({
    updateCheckpoint: async (_username, _completedAt, memoryCompletedAt) => { memoryCheckpoint = memoryCompletedAt },
  }))
  assert.equal(result.success, true)
  assert.equal(memoryCheckpoint, undefined)
})

test('partial profile and credential writes fail the job rather than publishing success', async () => {
  let checkpoints = 0
  const result = await syncUserProfile('alice', { profileOnly: true }, undefined, dependencies({
    importBundle: async () => ({
      success: false,
      imported: 1,
      skipped: 0,
      failed: 1,
      outcomes: [
        { path: 'persona/core.json', status: 'imported', bytes: 2 },
        { path: 'etc/models.json', status: 'failed', bytes: 2, error: 'disk full' },
      ],
      errors: ['etc/models.json: disk full'],
    }),
    fetchCredentials: async () => ({ status: 'available', credentials: { remote: { provider: 'runpod', serverUrl: 'x', model: 'm' } } }),
    applyCredentials: async () => ({ success: false, saved: [], errors: ['remote: read-only'] }),
    updateCheckpoint: async () => { checkpoints++ },
  }))
  assert.equal(result.success, false)
  assert.equal(result.profileFiles, 1)
  assert.deepEqual(result.errors, ['etc/models.json: disk full', 'remote: read-only'])
  assert.equal(checkpoints, 0)
})

test('repeated invocation uses stable memory identity and reports deduplication', async () => {
  const seen = new Set<string>()
  const deps = dependencies({
    captureMemory: (_content, options) => {
      const key = options.idempotencyKey || ''
      const duplicate = seen.has(key)
      seen.add(key)
      return captureResult('stable-local-id', duplicate)
    },
  })
  const first = await syncUserProfile('alice', { memoriesOnly: true }, undefined, deps)
  const second = await syncUserProfile('alice', { memoriesOnly: true }, undefined, deps)
  assert.equal(first.memoriesImported, 1)
  assert.equal(second.memoriesImported, 0)
  assert.equal(second.memoriesDeduplicated, 1)
  assert.equal(first.success, true)
  assert.equal(second.success, true)
})

test('malformed memories and empty non-terminal pages fail explicitly', async () => {
  const malformed = await syncUserProfile('alice', { memoriesOnly: true }, undefined, dependencies({
    fetchMemories: async () => ({ success: true, memories: [{ id: 'bad', timestamp: 'never', content: 'x' } as any], hasMore: false }),
  }))
  assert.equal(malformed.success, false)
  assert.match(malformed.errors[0], /invalid timestamp/)

  const pagination = await syncUserProfile('alice', { memoriesOnly: true }, undefined, dependencies({
    fetchMemories: async () => ({ success: true, memories: [], hasMore: true }),
  }))
  assert.equal(pagination.success, false)
  assert.match(pagination.errors[0], /empty non-terminal page/)
})

test('an already-aborted execution performs no remote or persistence work', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(
    syncUserProfile('alice', { signal: controller.signal }, undefined, dependencies({
      loadConfig: async () => { calls++; return CONFIG },
    })),
    /cancelled/,
  )
  assert.equal(calls, 0)
})

test('cancellation after a remote response prevents the next local write and checkpoint', async () => {
  for (const phase of ['authenticate', 'bundle', 'credentials', 'memories'] as const) {
    const controller = new AbortController()
    const calls: string[] = []
    const deps = dependencies({
      authenticate: async () => {
        if (phase === 'authenticate') controller.abort()
        return { success: true, sessionId: 'session' }
      },
      fetchBundle: async () => {
        if (phase === 'bundle') controller.abort()
        return { success: true, bundle: BUNDLE }
      },
      importBundle: async () => { calls.push('profile'); return PROFILE_RESULT },
      fetchCredentials: async () => {
        if (phase === 'credentials') controller.abort()
        return { status: 'available', credentials: {} }
      },
      applyCredentials: async () => { calls.push('credentials'); return { success: true, saved: [], errors: [] } },
      fetchMemories: async () => {
        controller.abort()
        return { success: true, memories: [{ id: 'remote', timestamp: NOW.toISOString(), content: 'test', type: 'observation' }], hasMore: false }
      },
      captureMemory: () => { calls.push('memory'); return captureResult('local') },
      updateCheckpoint: async () => { calls.push('checkpoint') },
    })
    await assert.rejects(syncUserProfile('alice', { signal: controller.signal }, undefined, deps), /cancelled/)
    assert.deepEqual(calls, phase === 'authenticate' || phase === 'bundle' ? []
      : phase === 'credentials' ? ['profile'] : ['profile', 'credentials'])
  }
})

test('a cancelled profile-only import cannot publish a completed checkpoint', async () => {
  const controller = new AbortController()
  let checkpoints = 0
  await assert.rejects(syncUserProfile('alice', { profileOnly: true, skipConfig: true, signal: controller.signal }, undefined, dependencies({
    importBundle: async () => { controller.abort(); return PROFILE_RESULT },
    updateCheckpoint: async () => { checkpoints++ },
  })), /cancelled/)
  assert.equal(checkpoints, 0)
})

test('request cancellation and timeout remain active until the response body is read', async t => {
  for (const mode of ['cancel', 'timeout'] as const) {
    await t.test(mode, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const controller = new AbortController()
      let bodyStarted!: () => void
      const reading = new Promise<void>(resolve => { bodyStarted = resolve })
      let requestSignal: AbortSignal | undefined
      let finishBody!: (value: typeof BUNDLE) => void
      t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
        requestSignal = init.signal as AbortSignal
        return {
          ok: true,
          json: () => new Promise((resolve, reject) => {
            finishBody = resolve
            requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
            bodyStarted()
          }),
        }
      })
      const pending = fetchProfileBundle(CONFIG.serverUrl, 'alice', 'secret', controller.signal)
      await reading
      if (mode === 'cancel') controller.abort(new DOMException('Test cancelled', 'AbortError'))
      else t.mock.timers.tick(PROFILE_SYNC_REQUEST_TIMEOUT_MS + 1)
      const wasAborted = requestSignal?.aborted
      // Settle the baseline implementation too, so a broken timeout cannot hang this test.
      if (!wasAborted) finishBody(BUNDLE)
      const result = await pending
      assert.equal(wasAborted, true)
      assert.equal(result.success, false)
      assert.match(result.error || '', mode === 'cancel' ? /cancelled/ : /timed out/)
    })
  }
})

test('remote pagination must explicitly declare completion and respect the requested limit', async t => {
  const memory = { id: 'remote', timestamp: NOW.toISOString(), content: 'test', type: 'observation' }
  for (const page of [
    { memories: [] },
    { memories: [], hasMore: 'false' },
    { memories: [memory, memory], hasMore: false },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(page)))
    const result = await fetchMemories(CONFIG.serverUrl, 'alice', 'secret', { offset: 0, limit: 1 })
    assert.equal(result.success, false)
    assert.match(result.error || '', /invalid page/)
    t.mock.restoreAll()
  }
})
