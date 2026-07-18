import assert from 'node:assert/strict'
import { handleGetSecurityPolicy } from './security-policy.js'
import type { UnifiedRequest, UnifiedUser } from '../types.js'

function request(user: UnifiedUser): UnifiedRequest {
  return {
    path: '/api/security/policy',
    method: 'GET',
    user,
  }
}

const ownerResponse = await handleGetSecurityPolicy(request({
  userId: 'owner-id',
  username: 'owner-user',
  role: 'owner',
  isAuthenticated: true,
}))

assert.equal(ownerResponse.status, 200)
assert.equal(ownerResponse.data?.policy.role, 'owner')
assert.equal(ownerResponse.data?.policy.canManageUsers, true)
assert.equal(ownerResponse.data?.policy.canViewAudit, true)
assert.equal('isAdmin' in ownerResponse.data.policy, false)

const standardResponse = await handleGetSecurityPolicy(request({
  userId: 'standard-id',
  username: 'standard-user',
  role: 'standard',
  isAuthenticated: true,
}))

assert.equal(standardResponse.status, 200)
assert.equal(standardResponse.data?.policy.role, 'standard')
assert.equal(standardResponse.data?.policy.canManageUsers, false)
assert.equal(standardResponse.data?.policy.canViewAudit, false)

console.log('security policy API projection contract passed')
