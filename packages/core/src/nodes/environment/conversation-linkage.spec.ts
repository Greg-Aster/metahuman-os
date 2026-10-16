import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
mock.module('../../durable-execution/graph-contract.js', { namedExports: { graphContextSnapshot: (context: unknown) => context } })
mock.module('../../graph-streaming.js', { namedExports: { loadGraphForMode: async () => ({ graph: {} }) } })
const { environmentConversationNode, environmentConversationDeliveryNode } = await import('./conversation.node.js')
import { prepareConversationEntries } from '../output/conversation-buffer.node.js'
import { assembleCuratorSources } from '../curator/source-assembler.js'

const timestamp = Date.parse('2026-10-15T00:00:00.000Z')
function input(key: string, text: string) {
  return prepareConversationEntries({ userMessage: text }, { graphExecution: { occurrenceId: key }, memoryTimestamp: timestamp, cognitiveMode: 'environment', sessionId: 'session' })[0]!
}
function source(entry: any, id: string) {
  return { id, type: 'conversation', content: entry.content, timestamp: new Date(entry.timestamp).toISOString(), metadata: { ...entry.meta, role: entry.role }, path: `/tmp/${id}.json` }
}

test('delayed conversation delivery retains its admitted input across a newer correction', async () => {
  const original = input('execution:input-node-1', 'Original question')
  const correction = input('execution:input-node-2', 'Corrected question')
  const work = await environmentConversationNode.execute({ instructionEntry: original, metadata: { origin: 'fixture' } }, {
    graphExecution: { dispatch: () => ({ effectId: 'effect-1' }) },
  } as any, {})
  let response: any
  await environmentConversationDeliveryNode.execute({ work: work.work }, {
    userMessageEntry: correction,
    graphExecution: {
      pendingEvents: () => [],
      events: () => [{ eventId: 'result-1', kind: 'work_result', payload: { effectId: 'effect-1', result: { state: 'completed', result: { response: 'Original answer' } } } }],
      callGraph: async (_graph: any, context: any) => {
        response = prepareConversationEntries({ response: context.environmentConversationResponse, metadata: context.environmentConversationMetadata }, {
          ...context, graphExecution: { occurrenceId: 'execution:delivery-node-3' }, memoryTimestamp: timestamp, cognitiveMode: 'environment',
        })[0]
        return { nodes: new Map([['buffer', { status: 'completed', definition: { type: 'conversation_buffer' }, outputs: { persisted: true, entries: [response] } }]]) }
      },
    },
  } as any, {})
  assert.equal(response.meta.inReplyTo, original.meta?.idempotencyKey)
  assert.notEqual(response.meta.idempotencyKey, original.meta?.idempotencyKey)
  assert.equal(response.meta.origin, 'fixture')
  const paired = assembleCuratorSources([source(original, 'u1'), source(correction, 'u2'), source(response, 'a1')])
  assert.equal(paired.memories.length, 1)
  assert.equal(paired.memories[0]!.content, 'Original question')
  assert.equal(paired.memories[0]!.response, 'Original answer')
  assert.equal(paired.memories[0]!.metadata?.cognitiveMode, 'environment')
  assert.deepEqual(paired.deferredPaths, ['/tmp/u2.json'])
})

test('autonomous output does not inherit an unrelated user entry from context', async () => {
  const work = await environmentConversationNode.execute({}, {
    userMessageEntry: input('old:input', 'An older question'),
    graphExecution: { dispatch: () => ({ effectId: 'autonomous' }) },
  } as any, {})
  assert.equal(work.work.metadata.inReplyTo, undefined)
})

test('multiple explicitly linked replies become distinct recorded exchanges', () => {
  const user = source(input('request', 'Question'), 'u')
  const replies = ['one', 'two'].map((id) => source(prepareConversationEntries({ response: id, metadata: { inReplyTo: user.metadata.idempotencyKey } }, {
    graphExecution: { occurrenceId: 'delivery:' + id }, memoryTimestamp: timestamp,
  })[0], id))
  const result = assembleCuratorSources([user, ...replies])
  assert.equal(result.memories.length, 2)
  assert.deepEqual(result.deferredPaths, [])
  assert.deepEqual(result.memories.map(memory => memory.response).sort(), ['one', 'two'])
  assert.notEqual(result.memories[0]!.id, result.memories[1]!.id)
  assert.ok(result.memories.every(memory => memory.sourceMemoryIds?.includes('u')))
  assert.equal(result.memories[0]!.sourceHashes!.u, result.memories[1]!.sourceHashes!.u)
  assert.deepEqual(result.memories.map(memory => memory.sourceMemoryIds?.[1]).sort(), ['one', 'two'])
  assert.notEqual(replies[0]!.metadata.idempotencyKey, replies[1]!.metadata.idempotencyKey)
})

test('reply pairing requires the exact admitted request key, not a shared session or timestamp', () => {
  const user = source(input('execution:input-node', 'Question'), 'u')
  const assistant = source(prepareConversationEntries({ response: 'Unrelated answer', metadata: { inReplyTo: 'another-request:user' } }, {
    graphExecution: { occurrenceId: 'execution:delivery-node' }, memoryTimestamp: timestamp, sessionId: 'session',
  })[0], 'a')
  const result = assembleCuratorSources([user, assistant])
  assert.equal(result.memories.length, 0)
  assert.deepEqual(result.deferredPaths.sort(), ['/tmp/a.json', '/tmp/u.json'])
})
