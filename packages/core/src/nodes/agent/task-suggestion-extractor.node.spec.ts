import assert from 'node:assert/strict'
import test from 'node:test'

import type { RouterCallOptions } from '../../model-router.js'
import {
  executeTaskSuggestionExtractor,
  parseExtractedTaskSuggestions,
} from './task-suggestion-extractor.node.js'

test('task suggestion extraction is a typed graph-node operation', async () => {
  let request: RouterCallOptions | undefined
  const output = await executeTaskSuggestionExtractor(
    { content: 'I need to verify the new graph in a focused test.' },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async input => {
        request = input
        return {
          content: JSON.stringify({
            tasks: [{
              title: 'Verify the new graph',
              description: 'Run its focused graph test.',
              priority: 'P1',
              tags: ['graph'],
              confidence: 0.9,
              project: null,
              dependencies: null,
            }],
          }),
          model: 'test',
          provider: 'test',
          modelId: 'test',
          role: 'curator',
        }
      },
    },
  )
  assert.equal(output.count, 1)
  assert.equal((output.tasks as Array<{ title: string }>)[0]?.title, 'Verify the new graph')
  assert.equal(request?.userId, 'account-a')
})

test('task suggestion parser rejects malformed and unbounded output', () => {
  assert.throws(() => parseExtractedTaskSuggestions('not json'), /did not contain/)
  assert.throws(
    () => parseExtractedTaskSuggestions(JSON.stringify({ tasks: [{ title: 'Missing fields' }] })),
    /item 1 is invalid/,
  )
  assert.throws(
    () => parseExtractedTaskSuggestions(JSON.stringify({ tasks: Array.from({ length: 21 }, () => ({})) })),
    /bounded tasks array/,
  )
})
