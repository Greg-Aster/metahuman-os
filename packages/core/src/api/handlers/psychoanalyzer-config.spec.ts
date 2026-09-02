import assert from 'node:assert/strict'
import test from 'node:test'

import { handleGetPsychoanalyzerConfig } from './psychoanalyzer-config.js'

test('psychoanalyzer configuration rejects unauthenticated reads before profile access', async () => {
  const response = await handleGetPsychoanalyzerConfig({
    path: '/api/psychoanalyzer-config',
    method: 'GET',
    user: {
      userId: '',
      username: '',
      role: 'guest',
      isAuthenticated: false,
    },
  })

  assert.deepEqual(response, { status: 401, error: 'Authentication required' })
})
