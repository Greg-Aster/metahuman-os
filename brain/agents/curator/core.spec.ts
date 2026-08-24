import assert from 'node:assert/strict'
import test from 'node:test'

import { loadCuratorGraph, normalizeCuratorOptions, parseCuratorArgs } from './core.js'

test('Curator CLI options are strict and expose bounded batch controls', () => {
  assert.deepEqual(
    parseCuratorArgs(['--username', 'test-user', '--all', '--limit=25', '--max-batches', '4', '--temperature', '0.2']),
    {
      username: 'test-user',
      singleUser: false,
      all: true,
      limit: 25,
      maxBatches: 4,
      temperature: 0.2,
    },
  )
  assert.equal(parseCuratorArgs([], 'trigger-user').username, 'trigger-user')
  assert.throws(() => parseCuratorArgs(['--unknown']), /Unknown curator option/)
  assert.throws(() => parseCuratorArgs(['--limit', '0']), /between 1 and 500/)
  assert.throws(() => parseCuratorArgs(['--temperature', '1.1']), /between 0 and 1/)
  assert.throws(() => normalizeCuratorOptions({ username: '../escape' }), /Invalid username format/)
})

test('Curator runtime options override only canonical graph node properties', async () => {
  const graph = await loadCuratorGraph({ limit: 7, temperature: 0.1 })
  const loader = graph.nodes.find(node => node.data.nodeType === 'uncurated_memory_loader')
  const llm = graph.nodes.find(node => node.data.nodeType === 'curator_llm')
  assert.equal(loader?.data.properties.limit, 7)
  assert.equal(llm?.data.properties.temperature, 0.1)
  assert.equal(graph.nodes.some(node => node.data.nodeType === 'training_pair_appender'), false)
})
