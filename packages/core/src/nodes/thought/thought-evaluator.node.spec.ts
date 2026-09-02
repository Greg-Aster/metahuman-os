import assert from 'node:assert/strict'
import test from 'node:test'

import { ThoughtEvaluatorNode } from './thought-evaluator.node.js'

test('Thought Evaluator treats zero confidence as a real stop signal', async () => {
  const result = await ThoughtEvaluatorNode.execute({
    thoughtData: {
      thought: 'A sufficiently long but unsupported thought.',
      thoughts: ['A sufficiently long but unsupported thought.'],
      keywords: ['unsupported'],
      confidence: 0,
    },
  }, {}, { minConfidence: 0.4, maxIterations: 4 })
  assert.equal(result.isComplete, true)
  assert.match(result.reason, /below threshold/)
})

test('Thought Evaluator enforces the graph executor loop ceiling', async () => {
  await assert.rejects(
    ThoughtEvaluatorNode.execute({ thoughtData: {} }, {}, { maxIterations: 6 }),
    /maxIterations must be an integer from 1 to 5/,
  )
})
