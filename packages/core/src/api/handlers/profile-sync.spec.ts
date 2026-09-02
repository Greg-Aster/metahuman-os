import assert from 'node:assert/strict'
import test from 'node:test'

import { PROFILE_SYNC_BUNDLE_VERSION } from '../../profile-sync.js'
import { handleGetProfileMemories, handleImportProfile } from './profile-sync.js'

const user = { id: 'user-1', username: 'alice', role: 'owner', isAuthenticated: true }

test('profile-sync memory transport validates pagination and filters before storage access', async () => {
  const invalidLimit = await handleGetProfileMemories({ method: 'GET', user, query: { limit: '0' } } as any)
  assert.equal(invalidLimit.status, 400)
  assert.match(invalidLimit.error || '', /positive integer/)

  const invalidOffset = await handleGetProfileMemories({ method: 'GET', user, query: { offset: '-1' } } as any)
  assert.equal(invalidOffset.status, 400)
  assert.match(invalidOffset.error || '', /non-negative/)

  const invalidSince = await handleGetProfileMemories({ method: 'GET', user, query: { since: 'never' } } as any)
  assert.equal(invalidSince.status, 400)
  assert.match(invalidSince.error || '', /ISO timestamp/)

  const tooManyExclusions = await handleGetProfileMemories({
    method: 'GET',
    user,
    query: { exclude: Array.from({ length: 101 }, (_, index) => `id-${index}`) },
  } as any)
  assert.equal(tooManyExclusions.status, 400)
  assert.match(tooManyExclusions.error || '', /at most 100/)
})

test('profile import transport rejects traversal before writing a profile file', async () => {
  const response = await handleImportProfile({
    method: 'POST',
    user,
    body: {
      version: PROFILE_SYNC_BUNDLE_VERSION,
      exportedAt: '2026-08-29T12:00:00.000Z',
      username: 'alice',
      files: [{ path: '../../outside.json', content: '{}' }],
    },
  } as any)
  assert.equal(response.status, 400)
  assert.match(response.error || '', /escapes the profile root/)
})

test('profile-sync public transports reject missing credentials', async () => {
  const response = await handleGetProfileMemories({
    method: 'POST',
    user: { id: '', username: '', role: 'guest', isAuthenticated: false },
    body: { username: 'alice', password: 'wrong' },
  } as any)
  assert.equal(response.status, 401)
})
