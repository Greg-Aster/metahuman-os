import assert from 'node:assert/strict'
import test from 'node:test'
import { safeOutputPreview, updateTimeline } from './execution-observability'

test('timeline updates a node in place and preserves execution order', () => {
  let entries = updateTimeline([], 'node_start', { nodeId: 'a', timestamp: 1 })
  entries = updateTimeline(entries, 'node_start', { nodeId: 'b', timestamp: 2 })
  entries = updateTimeline(entries, 'node_complete', { nodeId: 'a', timestamp: 3, durationMs: 12 })
  assert.deepEqual(entries.map(entry => entry.nodeId), ['a', 'b'])
  assert.equal(entries[0].state, 'completed')
  assert.equal(entries[0].durationMs, 12)
})

test('safe output previews omit embedded media and bound long values', () => {
  assert.match(safeOutputPreview({ image: `data:image/png;base64,${'a'.repeat(100)}` }), /embedded media omitted/)
  assert(safeOutputPreview('x'.repeat(1_000), 100).length <= 101)
  assert.doesNotMatch(safeOutputPreview({ serviceToken: 'private', nested: { password: 'also-private' } }), /private/)
  assert.match(safeOutputPreview({ authorization: 'Bearer private' }), /redacted/)
})
