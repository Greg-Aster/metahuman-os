import assert from 'node:assert/strict'
import {
  SESSION_ACTIVITY_WRITE_INTERVAL_MS,
  shouldPersistSessionActivity,
} from './sessions.js'

const now = Date.parse('2026-07-17T12:00:00.000Z')

assert.equal(
  shouldPersistSessionActivity(
    { lastActivity: new Date(now - SESSION_ACTIVITY_WRITE_INTERVAL_MS + 1).toISOString() },
    now
  ),
  false
)
assert.equal(
  shouldPersistSessionActivity(
    { lastActivity: new Date(now - SESSION_ACTIVITY_WRITE_INTERVAL_MS).toISOString() },
    now
  ),
  true
)
assert.equal(shouldPersistSessionActivity({ lastActivity: 'invalid' }, now), true)

console.log('session activity persistence contract passed')
