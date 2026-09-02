import assert from 'node:assert/strict'
import test from 'node:test'

import type { RouterMessage, RouterResponse } from '../../model-router.js'
import { MemoryLoaderNode } from './memory-loader.node.js'
import {
  enrichOrganizerMemory,
  parseOrganizerAnalysis,
} from './llm-enricher.node.js'

test('Organizer analysis requires typed JSON and normalizes bounded values', () => {
  assert.deepEqual(
    parseOrganizerAnalysis('```json\n{"tags":[" Garden ","garden"],"entities":[" Alice "]}\n```'),
    { tags: ['Garden'], entities: ['Alice'] },
  )
  assert.throws(() => parseOrganizerAnalysis('not json'), /did not contain a JSON object/)
  assert.throws(
    () => parseOrganizerAnalysis('{"tags":"garden","entities":[]}'),
    /tags must be an array of strings/,
  )
})

test('Organizer enrichment processes the complete saved conversation and persists validated metadata', async () => {
  let messages: RouterMessage[] = []
  const fakeCall = async (input: { messages: RouterMessage[] }): Promise<RouterResponse> => {
    messages = input.messages
    return {
      content: '{"tags":["gardening"],"entities":["Alice"]}',
      model: 'test-model',
      modelId: 'test-model-id',
      role: 'curator',
      provider: 'test',
    }
  }

  const result = await enrichOrganizerMemory({
    id: 'evt-one',
    content: 'Me: "I am planning a garden"',
    response: 'Private assistant response that must not be analyzed',
    type: 'conversation',
    tags: ['inbox'],
    entities: [],
  }, {
    username: 'profile-user',
    organizerTimestamp: '2026-08-29T12:00:00.000Z',
  }, {}, fakeCall as Parameters<typeof enrichOrganizerMemory>[3])

  assert.equal(typeof messages[1].content, 'string')
  const userPrompt = messages[1].content as string
  assert.match(userPrompt, /planning a garden/)
  assert.match(userPrompt, /Private assistant response/)
  assert.equal(result.outcome, 'updated')
  assert.deepEqual(result.memory.tags, ['inbox', 'gardening'])
  assert.deepEqual(result.memory.entities, ['Alice'])
  assert.equal(result.memory.metadata.processed, true)
  assert.equal(result.memory.metadata.model, 'test-model-id')
})

test('Organizer reprocessing removes only old semantic enrichment', async () => {
  const fakeCall = async (): Promise<RouterResponse> => ({
    content: '{"tags":["new-topic"],"entities":[]}',
    model: 'test-model',
    modelId: 'test-model-id',
    role: 'curator',
    provider: 'test',
  })
  const result = await enrichOrganizerMemory({
    id: 'evt-two',
    content: 'Fresh user content',
    type: 'observation',
    tags: ['inbox', 'old-topic'],
    entities: ['Old Entity'],
  }, {
    username: 'profile-user',
    organizerReprocess: true,
  }, {}, fakeCall as Parameters<typeof enrichOrganizerMemory>[3])

  assert.deepEqual(result.memory.tags, ['inbox', 'new-topic'])
  assert.deepEqual(result.memory.entities, [])
})

test('Organizer enriches saved inner dialogue instead of treating an agent as a capture gateway', async () => {
  let calls = 0
  const result = await enrichOrganizerMemory({
    id: 'evt-reflection',
    content: 'Model-generated reflection',
    type: 'inner_dialogue',
    metadata: { role: 'reflection' },
  }, { username: 'profile-user' }, {}, (async () => {
    calls += 1
    return {
      content: '{"tags":["reflection-topic"],"entities":[]}',
      model: 'test-model',
      modelId: 'test-model-id',
      role: 'curator',
      provider: 'test',
    }
  }) as Parameters<typeof enrichOrganizerMemory>[3])

  assert.equal(calls, 1)
  assert.equal(result.outcome, 'updated')
  assert.deepEqual(result.memory.tags, ['reflection-topic'])
  assert.deepEqual(result.memory.entities, [])
  assert.equal(result.memory.metadata.organizerStatus, 'updated')
})

test('Organizer memory input rejects direct graph execution without agent context', async () => {
  await assert.rejects(
    () => MemoryLoaderNode.execute({}, {}, {}),
    /requires a memory supplied by the Organizer agent/,
  )
  const output = await MemoryLoaderNode.execute({}, {
    organizerMemory: { id: 'evt-one', relativePath: 'memory.json' },
  }, {})
  assert.equal(output.memory.id, 'evt-one')
})
