import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const conversation = [{ role: 'user', content: 'Continue the request.', timestamp: '2026-10-10T01:35:00Z' }]
const inner = [{ role: 'assistant', content: 'An earlier private reflection.', timestamp: '2026-10-10T01:30:00Z' }]
const reads: string[] = []
mock.module(new URL('../../chat-settings.ts', import.meta.url).href, {
  namedExports: { loadChatSettingsForUser: () => ({ unifiedConsciousness: true }) },
})
mock.module(new URL('../../conversation-buffer.ts', import.meta.url).href, {
  namedExports: { loadBufferForUser: (_username: string, mode: string) => {
    reads.push(mode)
    return { messages: mode === 'inner' ? inner : conversation }
  } },
})
const { ConversationHistoryNode } = await import('./conversation-history.node.js')

test('conversation-only selection retains its full entries without loading inner dialogue', async () => {
  reads.length = 0
  const result = await ConversationHistoryNode.execute({}, { username: 'fixture' }, { includeInnerDialogue: false })
  assert.deepEqual(reads, ['conversation'])
  assert.deepEqual(result.history, conversation)
  assert.equal(result.innerDialogueCount, 0)
})

test('existing workflows retain unified history unless they explicitly deselect it', async () => {
  for (const properties of [{}, { includeInnerDialogue: true }]) {
    reads.length = 0
    const result = await ConversationHistoryNode.execute({}, { username: 'fixture' }, properties)
    assert.deepEqual(reads, ['conversation', 'inner'])
    assert.equal(result.innerDialogueCount, 1)
    assert.deepEqual(result.history.at(-1), conversation[0])
    assert.equal(result.history[0].meta.isInnerDialogue, true)
    assert.equal(result.history[0].meta.originalRole, 'assistant')
  }
})

test('explicit inner-buffer selection still works with implicit merging disabled', async () => {
  reads.length = 0
  const result = await ConversationHistoryNode.execute({}, { username: 'fixture' }, { mode: 'inner', includeInnerDialogue: false })
  assert.deepEqual(reads, ['inner'])
  assert.deepEqual(result.history, inner)
})
