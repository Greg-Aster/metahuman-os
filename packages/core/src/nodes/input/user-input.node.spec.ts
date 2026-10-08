import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

process.env.METAHUMAN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-user-input-'))
const buffer = await import('../../conversation-buffer.js')
const memory = await import('../../memory.js')
const writes: Array<{ destination: string; content: string; timestamp: unknown; key: string }> = []
let failMemory = false
mock.module('../../conversation-buffer.js', { namedExports: { ...buffer,
  admitBufferEntry: async (_username: string, _mode: string, entry: any) => {
    writes.push({ destination: 'buffer', content: entry.content, timestamp: entry.timestamp, key: entry.meta.idempotencyKey })
    return entry
  },
} })
mock.module('../../memory.js', { namedExports: { ...memory,
  captureEventWithDetails: (content: string, options: any) => {
    if (failMemory) throw new Error('fixture storage failure')
    writes.push({ destination: 'memory', content, timestamp: options.timestamp, key: options.idempotencyKey })
    return { eventId: 'fixture-memory', filePath: '/fixture-memory' }
  },
} })
const { UserInputNode } = await import('./user-input.node.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); mock.restoreAll() })
const context = { username: 'input-fixture', userId: 'input-fixture', userMessage: '  Exact input.  ',
  memoryTimestamp: '2026-10-07T23:00:00.000Z', idempotencyKey: 'current-turn', recordPersonaMemory: true }

test('independent destination switches preserve exact text and one entry identity', async () => {
  for (const [saveToBuffer, saveToLongTermMemory] of [[false, false], [true, false], [false, true], [true, true]]) {
    writes.length = 0
    const result = await UserInputNode.execute({}, context, { saveToBuffer, saveToLongTermMemory })
    assert.equal(result.message, context.userMessage)
    assert.equal(result.bufferSaved, saveToBuffer)
    assert.equal(result.memorySaved, saveToLongTermMemory)
    assert.deepEqual(writes.map(write => write.destination), [saveToBuffer && 'buffer', saveToLongTermMemory && 'memory'].filter(Boolean))
    for (const write of writes) {
      assert.equal(write.content, context.userMessage)
      assert.equal(write.key, 'current-turn:user')
      assert.equal(new Date(write.timestamp as string | number).toISOString(), context.memoryTimestamp)
    }
  }
  writes.length = 0
  await UserInputNode.execute({}, context, {})
  assert.deepEqual(writes, [], 'Existing workflows retain their opt-out defaults')
})

test('forwarded and buffered turns keep their individual identities', async () => {
  const turns = ['first', 'second'].map((content, index) => ({ userMessage: content,
    userMessageEntry: { role: 'user', content, timestamp: 1000 + index, meta: { idempotencyKey: 'original-' + index } } }))
  for (const saveToBuffer of [false, true]) {
    writes.length = 0
    const result = await UserInputNode.execute({}, { ...context, pendingInstructionTurns: turns }, { saveToBuffer, saveToLongTermMemory: true })
    assert.deepEqual(result.entries.map((entry: any) => entry.meta.idempotencyKey), ['original-0', 'original-1'])
    assert.equal(result.entry.content, 'second')
    assert.deepEqual(writes.filter(write => write.destination === 'memory').map(write => write.content), ['first', 'second'])
  }
})

test('profile memory permissions and storage failures remain visible', async () => {
  writes.length = 0
  const denied = await UserInputNode.execute({}, { ...context, recordPersonaMemory: false }, { saveToBuffer: true, saveToLongTermMemory: true })
  assert.equal(denied.bufferSaved, true)
  assert.equal(denied.memorySaved, false)
  assert.deepEqual(writes.map(write => write.destination), ['buffer'])
  failMemory = true
  try {
    await assert.rejects(UserInputNode.execute({}, context, { saveToLongTermMemory: true }), /fixture storage failure/)
  } finally { failMemory = false }
})
