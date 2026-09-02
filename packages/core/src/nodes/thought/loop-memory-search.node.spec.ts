import assert from 'node:assert/strict'
import test from 'node:test'

import { executeLoopMemorySearch } from './loop-memory-search.node.js'

const baseEvaluation = {
  isComplete: false,
  nextSearchTerms: ['connection', 'pattern'],
  thoughts: ['One new thought.'],
  seedMemory: 'Original seed.',
  seenMemoryIds: ['already-seen'],
}

test('Loop Memory Search performs one bounded profile query and excludes generated inner content', async () => {
  const queries: Array<{ query: string; options?: Record<string, any> }> = []
  const result = await executeLoopMemorySearch(
    { evaluation: baseEvaluation },
    { username: 'test-user' },
    { maxResults: 2, excludeSeen: true },
    {
      query: async (query, options) => {
        queries.push({ query, options })
        return [
          { item: { id: 'generated', type: 'episodic', memoryType: 'reflection', path: '', text: 'Generated.', vector: [] }, score: 1 },
          { item: { id: 'already-seen', type: 'episodic', memoryType: 'observation', path: '', text: 'Seen.', vector: [] }, score: 0.9 },
          { item: { id: 'historical-1', type: 'episodic', memoryType: 'observation', path: '', text: 'Historical evidence.', vector: [] }, score: 0.8 },
        ]
      },
    },
  )

  assert.deepEqual(queries, [{
    query: 'connection pattern',
    options: { topK: 6, username: 'test-user' },
  }])
  assert.equal(result.shouldExit, false)
  assert.deepEqual(result.memoryIds, ['historical-1'])
  assert.deepEqual(result.context.relatedMemories, ['Historical evidence.'])
  assert.deepEqual(result.context.thoughts, ['One new thought.'])
})

test('Loop Memory Search exits without querying when evaluation is complete', async () => {
  let calls = 0
  const result = await executeLoopMemorySearch(
    { evaluation: { ...baseEvaluation, isComplete: true } },
    { username: 'test-user' },
    {},
    { query: async () => { calls += 1; return [] } },
  )
  assert.equal(result.shouldExit, true)
  assert.equal(calls, 0)
})

test('Loop Memory Search fails invalid limits and missing profile identity', async () => {
  const query = async () => []
  await assert.rejects(
    executeLoopMemorySearch({ evaluation: baseEvaluation }, { username: 'test-user' }, { maxResults: 0 }, { query }),
    /maxResults must be an integer from 1 to 5/,
  )
  await assert.rejects(
    executeLoopMemorySearch({ evaluation: baseEvaluation }, {}, {}, { query }),
    /authenticated username/,
  )
})
