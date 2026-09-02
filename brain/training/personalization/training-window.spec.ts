import assert from 'node:assert/strict'
import test from 'node:test'

import { selectRollingTrainingWindow } from './training-window.js'

const day = 24 * 60 * 60 * 1000
const now = Date.parse('2026-09-01T00:00:00.000Z')

function record(id: string, daysAgo: number) {
  return {
    id,
    originalTimestamp: new Date(now - daysAgo * day).toISOString(),
  }
}

test('rolling window keeps all recent records and bounded coverage of older history', () => {
  const selected = selectRollingTrainingWindow([
    record('old-90', 90),
    record('recent-2', 2),
    record('old-60', 60),
    record('recent-20', 20),
    record('old-40', 40),
  ], 30, 2, now)

  assert.deepEqual(selected.map(item => item.id), [
    'old-90',
    'old-40',
    'recent-20',
    'recent-2',
  ])
})

test('rolling window can exclude all older history and rejects invalid timestamps', () => {
  assert.deepEqual(
    selectRollingTrainingWindow([record('old', 60), record('recent', 1)], 30, 0, now).map(item => item.id),
    ['recent'],
  )
  assert.throws(
    () => selectRollingTrainingWindow([{ id: 'broken', originalTimestamp: 'not-a-date' }], 30, 0, now),
    /invalid originalTimestamp/,
  )
})
