import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeSemanticTurnClassifier,
  parseSemanticTurnDecision,
} from './semantic-turn-classifier.node.js'

test('short semantic turns are classified deterministically inside the node', async () => {
  let modelCalled = false
  const output = await executeSemanticTurnClassifier(
    { transcript: 'I' },
    { username: 'profile-a', userId: 'account-a' },
    {},
    {
      callModel: async () => {
        modelCalled = true
        return 'unexpected'
      },
    },
  )
  assert.equal(output.complete, false)
  assert.equal(modelCalled, false)
})

test('semantic turn parsing fails closed on malformed decisions', () => {
  assert.deepEqual(parseSemanticTurnDecision('{"complete":true,"confidence":0.9,"reason":"complete question"}'), {
    complete: true,
    confidence: 0.9,
    reason: 'complete question',
  })
  assert.throws(() => parseSemanticTurnDecision('complete'), /did not contain/)
  assert.throws(() => parseSemanticTurnDecision('{"complete":true}'), /required typed fields/)
})
