import assert from 'node:assert/strict'
import test from 'node:test'

import type { RouterCallOptions } from '../../model-router.js'
import {
  executePersonaProfileExtractor,
  parsePersonaDraft,
} from './persona-profile-extractor.node.js'

test('persona extraction is a graph-owned typed model operation', async () => {
  let request: RouterCallOptions | undefined
  const output = await executePersonaProfileExtractor(
    { messages: [{ role: 'user', content: 'I value reliable, concise communication.' }] },
    { username: 'profile-a', userId: 'account-a', cognitiveMode: 'agent' },
    {},
    {
      callModel: async input => {
        request = input
        return {
          content: JSON.stringify({
            values: [{ priority: 1, value: 'Reliability', description: 'Prefers dependable behavior' }],
            communicationStyle: { tone: ['concise'] },
          }),
          provider: 'test',
          model: 'test',
          modelId: 'test',
          role: 'curator',
        }
      },
    },
  )

  assert.equal(request?.userId, 'account-a')
  assert.equal((output.persona as { values: unknown[] }).values.length, 1)
  assert.equal(typeof (output.confidence as { overall: number }).overall, 'number')
})

test('persona extraction rejects unsupported fields and malformed scores', () => {
  assert.throws(
    () => parsePersonaDraft('{"secret":"unsupported"}'),
    /invalid top-level shape/,
  )
  assert.throws(
    () => parsePersonaDraft('{"bigFive":{"openness":101}}'),
    /between 0 and 100/,
  )
  assert.throws(
    () => parsePersonaDraft('{"bigFive":{"invented":50}}'),
    /only Big Five traits/,
  )
})
