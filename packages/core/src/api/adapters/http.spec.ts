import assert from 'node:assert/strict'
import { buildUnifiedRequest } from './http.js'

const owner = {
  userId: 'owner-id',
  username: 'Owner',
  role: 'owner' as const,
  isAuthenticated: true,
}

const resolved = buildUnifiedRequest({
  path: '/api/status',
  method: 'GET',
  cookieHeader: 'mh_session=does-not-need-to-be-resolved',
  resolvedUser: owner,
})

assert.deepEqual(resolved.user, owner)
assert.equal(resolved.sessionId, 'does-not-need-to-be-resolved')

const explicitlyUnauthenticated = buildUnifiedRequest({
  path: '/api/status',
  method: 'GET',
  cookieHeader: 'mh_session=must-not-be-resolved',
  resolvedUser: null,
})

assert.equal(explicitlyUnauthenticated.user.isAuthenticated, false)
assert.equal(explicitlyUnauthenticated.sessionId, 'must-not-be-resolved')

console.log('http adapter resolved-user handoff contract passed')
