import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyGraphHistory,
  recordGraphHistory,
  redoGraphHistory,
  undoGraphHistory,
} from './graph-history'

test('graph history records, undoes, and redoes snapshots', () => {
  let history = emptyGraphHistory<number>()
  history = recordGraphHistory(history, 1)
  history = recordGraphHistory(history, 2)

  const undone = undoGraphHistory(history, 3)
  assert.equal(undone.value, 2)
  assert.deepEqual(undone.history, { past: [1], future: [3] })

  const redone = redoGraphHistory(undone.history, 2)
  assert.equal(redone.value, 3)
  assert.deepEqual(redone.history, { past: [1, 2], future: [] })
})

test('new edits clear redo history and history is bounded', () => {
  const history = recordGraphHistory({ past: [1, 2], future: [4] }, 3, 2)
  assert.deepEqual(history, { past: [2, 3], future: [] })
})
