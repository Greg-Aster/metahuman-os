import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRobotBufferMessage } from './robot-buffer.node.js'

test('receipts identify display feedback separately from motion commands', () => {
  for (const [action, label] of [
    [{ type: 'faceExpression', expression: 'thinking' }, 'display thinking'],
    [{ type: 'faceExpression', expression: 'confused' }, 'display confused'],
    [{ type: 'faceExpression', displayRelease: true }, 'display release'],
    [{ type: 'robotCommand', command: 'walk' }, 'action walk'],
  ] as const) {
    const record = { direction: 'inbound' as const, status: 'completed', message: 'done', actionId: 'action-1', action,
      feedback: { id: 'receipt-1', actionId: 'action-1', type: 'completed' } }
    const entry = createRobotBufferMessage(record)
    assert.equal(entry.content, `Robot ${label} completed: done`)
    assert.deepEqual(entry.meta.bridgeRecord.action, action)
    assert.equal(entry.meta.actionId, record.actionId)
  }
})

test('unidentified receipts do not invent an action identity', () => {
  assert.equal(createRobotBufferMessage({ direction: 'inbound', status: 'completed', message: 'done' }).content,
    'Robot action completed: done')
})
