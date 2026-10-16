import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReinforcementResponse } from './desire-generation.node.js'

test('relevance review preserves a lower model-selected target strength', () => {
  const result = parseReinforcementResponse(JSON.stringify({
    'desire-one': { targetStrength: 0.2, reason: 'The attributed evidence reduces its relevance', evidenceIds: ['recent_memory:memory-one'] },
  }), new Set(['desire-one']), new Set(['recent_memory:memory-one']))
  assert.deepEqual(result, [{
    id: 'desire-one', targetStrength: 0.2, reason: 'The attributed evidence reduces its relevance', evidenceIds: ['recent_memory:memory-one'],
  }])
})

test('every supplied desire must receive a valid strength assessment', () => {
  const ids = new Set(['one', 'two'])
  const evidence = new Set(['task:one'])
  const decision = { targetStrength: 0.5, reason: 'Recorded assessment', evidenceIds: [] }
  assert.throws(() => parseReinforcementResponse(JSON.stringify({ one: decision }), ids, evidence), /every supplied desire/)
  for (const targetStrength of [-0.1, 1.1, '0.2', null]) {
    assert.throws(() => parseReinforcementResponse(JSON.stringify({ one: { ...decision, targetStrength }, two: decision }), ids, evidence), /invalid/)
  }
  assert.equal(parseReinforcementResponse(JSON.stringify({ one: decision, two: decision }), ids, evidence).length, 2)
})
