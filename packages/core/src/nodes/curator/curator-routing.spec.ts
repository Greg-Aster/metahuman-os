import assert from 'node:assert/strict'
import test, { after, mock } from 'node:test'

const router = await import('../../model-router.js')
const calls: any[] = []
let response: Record<string, unknown> = {}
mock.module('../../model-router.js', { namedExports: { ...router,
  callLLM: async (options: unknown) => {
    calls.push(options)
    return { content: JSON.stringify(response) }
  },
} })
const { CuratorLLMNode } = await import('./curator-llm.node.js')
after(() => mock.restoreAll())

test('Curator requests provider JSON mode and retains standalone-source validation', async () => {
  const source = {
    id: 'synthetic-daydream', timestamp: '2026-10-14T12:00:00.000Z',
    content: 'I imagined a garden.', type: 'daydream', path: '/synthetic/daydream.json',
  }
  response = {
    conversationalEssence: 'An imagined garden', suitableForTraining: true,
    userMessage: null, assistantResponse: source.content,
  }
  const invalid = await CuratorLLMNode.execute(
    { memories: [source], personaSummary: 'Synthetic persona' }, { userId: 'synthetic-owner' }, {},
  )
  assert.equal(calls[0].options.format, 'json')
  assert.equal('response_format' in calls[0].options, false)
  assert.equal(invalid.failedCount, 1)
  assert.equal(invalid.acceptedCount, 0)
  assert.match(invalid.curatedMemories[0].error, /non-empty userMessage/)

  response.userMessage = 'Describe the garden you imagined.'
  const valid = await CuratorLLMNode.execute(
    { memories: [source], personaSummary: 'Synthetic persona' }, { userId: 'synthetic-owner' }, {},
  )
  assert.equal(valid.failedCount, 0)
  assert.equal(valid.acceptedCount, 1)
  assert.equal(valid.curatedMemories[0].curated.provenance.kind, 'synthetic-exchange')
  assert.equal(valid.curatedMemories[0].curated.userMessage, response.userMessage)
})
