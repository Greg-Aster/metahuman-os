import assert from 'node:assert/strict'
import test from 'node:test'

import {
  handleListPersonaArchives,
  handlePersonaArchiveAction,
} from './persona-archives.js'
import type { UnifiedUser } from '../types.js'

const guest: UnifiedUser = {
  userId: '',
  username: '',
  role: 'guest',
  isAuthenticated: false,
}

const owner: UnifiedUser = {
  userId: 'owner-id',
  username: 'owner',
  role: 'owner',
  isAuthenticated: true,
}

test('persona archive handlers require authentication', async () => {
  const response = await handleListPersonaArchives({
    path: '/api/persona-archives',
    method: 'GET',
    user: guest,
  })
  assert.deepEqual(response, { status: 401, error: 'Authentication required' })
})

test('persona archive handler rejects traversal before profile access', async () => {
  const response = await handlePersonaArchiveAction({
    path: '/api/persona-archives',
    method: 'POST',
    user: owner,
    body: { action: 'view', filename: '../core.json' },
  })
  assert.deepEqual(response, { status: 400, error: 'Invalid persona archive filename' })
})

test('persona archive handler rejects unknown actions without storage access', async () => {
  const response = await handlePersonaArchiveAction({
    path: '/api/persona-archives',
    method: 'POST',
    user: owner,
    body: { action: 'rename', filename: 'anything.json' },
  })
  assert.deepEqual(response, { status: 400, error: 'Invalid action' })
})
