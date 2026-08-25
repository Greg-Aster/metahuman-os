import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDesireExecutorArgs, run } from './core.js'

test('desire executor accepts only explicit profile and desire selectors', () => {
  assert.deepEqual(
    parseDesireExecutorArgs(['--username', 'profile-a', '--desire-id', 'desire-1']),
    { username: 'profile-a', desireId: 'desire-1' },
  )
  assert.throws(() => parseDesireExecutorArgs(['--single-user']), /Unknown/)
  assert.throws(() => parseDesireExecutorArgs(['--username']), /requires a value/)
})

test('agent runtime rejects invalid admission metadata without throwing', async () => {
  const result = await run(
    { username: 'profile-a', dataDir: '/tmp/profile-a' },
    { options: { source: 'unknown-source' } },
  )
  assert.equal(result.success, false)
  assert.match(result.error || '', /Invalid desire-executor source/)
})
