import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesireOutcomeReviewerArgs, run } from './core.js'

test('outcome reviewer accepts only explicit profile and desire selectors', () => {
  assert.deepEqual(
    parseDesireOutcomeReviewerArgs(['--username', 'profile-a', '--desire-id', 'desire-1']),
    { username: 'profile-a', desireId: 'desire-1' },
  )
  assert.throws(() => parseDesireOutcomeReviewerArgs(['--single-user']), /Unknown/)
  assert.throws(() => parseDesireOutcomeReviewerArgs(['--username']), /requires a value/)
})

test('agent runtime rejects invalid admission metadata', async () => {
  const result = await run(
    { username: 'profile-a', dataDir: '/tmp/profile-a' },
    { options: { source: 'unknown-source' } },
  )
  assert.equal(result.success, false)
  assert.match(result.error || '', /Invalid desire-outcome-reviewer source/)
})
