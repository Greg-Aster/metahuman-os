import assert from 'node:assert/strict'
import test from 'node:test'

import type { RouterCallOptions } from '../../model-router.js'
import {
  executePreferenceLearning,
  parseExtractedPreferences,
  parsePreferenceContradiction,
} from './preference-learning.node.js'

test('preference extraction is a graph-owned typed model operation', async () => {
  let request: RouterCallOptions | undefined
  const output = await executePreferenceLearning(
    {
      operation: 'extract',
      events: [{ type: 'conversation', content: 'Please keep answers concise.' }],
      categories: ['communication'],
    },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async input => {
        request = input
        return {
          content: JSON.stringify({
            preferences: [{
              category: 'communication',
              description: 'Prefers concise answers',
              behavior: 'Answer briefly unless detail is requested',
              confidence: 0.9,
            }],
          }),
          provider: 'test',
          model: 'test',
          modelId: 'test',
          role: 'curator',
        }
      },
    },
  )
  assert.equal(output.count, 1)
  assert.equal(request?.userId, 'account-a')
})

test('preference parsing rejects malformed extraction and contradiction decisions', () => {
  assert.throws(() => parseExtractedPreferences('{"preferences":[{"category":"unknown"}]}'), /item 1 is invalid/)
  assert.throws(() => parsePreferenceContradiction('{"contradicts":"maybe"}'), /required typed fields/)
})
