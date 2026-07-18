import assert from 'node:assert/strict'
import { computeSecurityPolicy, SecurityError } from './security-policy.js'

const owner = computeSecurityPolicy('dual', {
  role: 'owner',
  username: 'owner-user',
})

assert.equal(owner.canEditSystemCode, true)
assert.equal(owner.canAccessAllProfiles, true)
assert.equal(owner.canWriteDocs, true)
assert.equal(owner.canAccessSystemConfigs, true)
assert.equal(owner.canReadProfile('standard-user'), true)
assert.equal(owner.canWriteProfile('standard-user'), true)
assert.equal('isAdmin' in owner, false)
assert.equal('requireAdmin' in owner, false)
owner.requireOwner()

const standard = computeSecurityPolicy('dual', {
  role: 'standard',
  username: 'standard-user',
})

assert.equal(standard.canEditSystemCode, false)
assert.equal(standard.canAccessAllProfiles, false)
assert.equal(standard.canWriteDocs, false)
assert.equal(standard.canAccessSystemConfigs, false)
assert.equal(standard.canReadProfile('standard-user'), true)
assert.equal(standard.canWriteProfile('standard-user'), true)
assert.equal(standard.canReadProfile('someone-else'), false)
assert.equal(standard.canWriteProfile('someone-else'), false)
assert.throws(
  () => standard.requireOwner(),
  (error: unknown) =>
    error instanceof SecurityError
    && error.details.reason === 'insufficient_role'
)

const guest = computeSecurityPolicy('emulation', {
  role: 'guest',
  username: 'guest-user',
})

assert.equal(guest.canEditOwnProfile, false)
assert.equal(guest.canReadProfile('guest-user'), false)
assert.equal(guest.canWriteProfile('guest-user'), false)

console.log('owner-role security policy contract passed')
