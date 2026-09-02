import assert from 'node:assert/strict'
import test from 'node:test'

import { ConditionalRouterNode } from './conditional-router.node.js'

test('Conditional Router consumes graph-runtime named handles', async () => {
  const exited = await ConditionalRouterNode.execute({
    condition: true,
    trueData: { thoughts: ['complete'] },
    falseData: { memories: ['continue'] },
  }, {})
  assert.equal(exited.branch, 'true')
  assert.deepEqual(exited.routedData, { thoughts: ['complete'] })

  const continued = await ConditionalRouterNode.execute({
    condition: false,
    trueData: { thoughts: ['complete'] },
    falseData: { memories: ['continue'] },
  }, {})
  assert.equal(continued.branch, 'false')
  assert.deepEqual(continued.routedData, { memories: ['continue'] })
})

test('Conditional Router retains positional compatibility for existing callers', async () => {
  const result = await ConditionalRouterNode.execute({
    0: { isComplete: true },
    1: { result: 'done' },
    2: { result: 'loop' },
  }, {})
  assert.equal(result.branch, 'true')
  assert.deepEqual(result.routedData, { result: 'done' })
})
