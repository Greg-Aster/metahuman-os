import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_PROFILE_SYNC_FILE_BYTES,
  PROFILE_SYNC_BUNDLE_VERSION,
  applySyncableCredentials,
  importProfileSyncBundle,
  loadProfileSyncConfig,
  updateProfileSyncCheckpoint,
  validateProfileSyncBundle,
  validateProfileSyncConfig,
  type ProfileSyncBundle,
  type ProfileSyncDependencies,
} from './profile-sync.js'

const NOW = '2026-08-29T12:00:00.000Z'

function bundle(files: ProfileSyncBundle['files']): ProfileSyncBundle {
  return {
    version: PROFILE_SYNC_BUNDLE_VERSION,
    exportedAt: NOW,
    username: 'alice',
    files,
  }
}

function dependencies(overrides: Partial<ProfileSyncDependencies> = {}): ProfileSyncDependencies {
  return {
    write: async request => ({ success: true, path: String(request.relativePath), bytesWritten: Buffer.byteLength(request.data) }),
    read: async () => ({ success: false, error: 'File not found: test' }),
    remove: async () => ({ success: true }),
    resolveProfileRoot: () => ({ success: true, path: '/tmp/profile-sync-test', profileRoot: '/tmp/profile-sync-test' }),
    ...overrides,
  }
}

test('profile bundle validation rejects traversal, malformed data, duplicates, and oversized files', () => {
  assert.throws(
    () => validateProfileSyncBundle(bundle([{ path: '../../outside.json', content: '{}' }])),
    /escapes the profile root/,
  )
  assert.throws(
    () => validateProfileSyncBundle(bundle([{ path: 'etc/config.json', content: '{broken' }])),
    /malformed/,
  )
  assert.throws(
    () => validateProfileSyncBundle(bundle([
      { path: 'persona/core.json', content: '{}' },
      { path: 'persona/core.json', content: '{}' },
    ])),
    /Duplicate/,
  )
  assert.throws(
    () => validateProfileSyncBundle(bundle([{ path: 'persona/avatar.png', content: 'not-base64' }])),
    /must use base64/,
  )
  assert.throws(
    () => validateProfileSyncBundle(bundle([{ path: 'persona/large.txt', content: 'x'.repeat(MAX_PROFILE_SYNC_FILE_BYTES + 1) }])),
    /exceeds/,
  )
  assert.throws(
    () => validateProfileSyncBundle(bundle([{ path: 'memory/episodic/event.json', content: '{}' }])),
    /Unsupported profile bundle path/,
  )
})

test('profile bundle import returns explicit per-file success, skip, and failure outcomes', async () => {
  const result = await importProfileSyncBundle('alice', bundle([
    { path: 'persona/core.json', content: '{}' },
    { path: 'etc/models.json', content: '{}' },
    { path: 'state/conversation-buffer.json', content: '{}' },
  ]), { skipConfig: true, expectedSourceUsername: 'alice' }, dependencies({
    write: async request => request.category === 'state'
      ? { success: false, error: 'disk full' }
      : { success: true, path: String(request.relativePath), bytesWritten: Buffer.byteLength(request.data) },
  }))

  assert.equal(result.success, false)
  assert.equal(result.imported, 1)
  assert.equal(result.skipped, 1)
  assert.equal(result.failed, 1)
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['imported', 'skipped', 'failed'])
  assert.match(result.errors[0], /disk full/)
})

test('sync configuration is strict and never turns malformed data into missing configuration', async () => {
  assert.deepEqual(validateProfileSyncConfig({
    serverUrl: 'https://example.com/',
    username: 'alice',
    password: 'secret',
  }), {
    serverUrl: 'https://example.com',
    username: 'alice',
    password: 'secret',
    lastSyncAt: undefined,
    lastMemorySyncAt: undefined,
  })
  assert.throws(() => validateProfileSyncConfig({ serverUrl: 'file:///tmp/server', username: 'a', password: 'b' }), /http or https/)
  assert.equal(await loadProfileSyncConfig('alice', dependencies()), null)
  await assert.rejects(
    loadProfileSyncConfig('alice', dependencies({ read: async () => ({ success: true, data: '{broken' }) })),
    /Invalid sync server configuration/,
  )
})

test('checkpoint updates retain the previous memory cursor when no memory phase ran', async () => {
  let saved: Record<string, unknown> | undefined
  const deps = dependencies({
    read: async () => ({
      success: true,
      data: JSON.stringify({
        serverUrl: 'https://example.com',
        username: 'alice',
        password: 'secret',
        lastMemorySyncAt: '2026-08-20T00:00:00.000Z',
      }),
    }),
    write: async request => {
      saved = JSON.parse(String(request.data))
      return { success: true, bytesWritten: Buffer.byteLength(request.data) }
    },
  })
  await updateProfileSyncCheckpoint('alice', NOW, undefined, deps)
  assert.equal(saved?.lastSyncAt, NOW)
  assert.equal(saved?.lastMemorySyncAt, '2026-08-20T00:00:00.000Z')
})

test('credential application reports partial persistence failure instead of success', async () => {
  const result = await applySyncableCredentials('alice', {
    runpod: { apiKey: 'key', endpointId: null, templateId: null, gpuType: null },
    remote: { provider: 'runpod', serverUrl: 'https://example.com', model: 'model' },
  }, dependencies({
    write: async request => request.relativePath === 'llm-backend.json'
      ? { success: false, error: 'read-only filesystem' }
      : { success: true, bytesWritten: Buffer.byteLength(request.data) },
  }))
  assert.equal(result.success, false)
  assert.deepEqual(result.saved, ['runpod'])
  assert.match(result.errors[0], /read-only filesystem/)
})
