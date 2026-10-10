import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnvironmentSessionSuggestions, parseExpressionSuggestions } from './property-suggestions.js'

test('expression dropdown uses advertised library identifiers without interpreting motion names', () => {
  assert.deepEqual(parseExpressionSuggestions({ expressionLibrary: [
    { name: 'bow', label: 'Bow', group: 'Motion faces' },
    { name: 'thinking', label: 'Thinking', group: 'Expressions' },
  ] }), [{ value: 'bow', label: 'Bow' }, { value: 'thinking', label: 'Thinking' }])
  assert.deepEqual(parseExpressionSuggestions({ expressionLibrary: [] }), [])
})

test('environment session suggestions retain stable IDs and useful live labels', () => {
  assert.deepEqual(parseEnvironmentSessionSuggestions({
    sessions: [
      {
        sessionId: 'robot-1',
        environmentId: 'ainekio',
        adapter: 'ainekio-gateway',
        status: 'connected',
      },
      { sessionId: 'sim-1', status: 'stale' },
      { sessionId: '' },
      null,
    ],
  }), [
    { value: 'robot-1', label: 'ainekio · ainekio-gateway · connected' },
    { value: 'sim-1', label: 'stale' },
  ])
})

test('invalid environment session payloads produce no suggestions', () => {
  assert.deepEqual(parseEnvironmentSessionSuggestions(null), [])
  assert.deepEqual(parseEnvironmentSessionSuggestions({ sessions: 'invalid' }), [])
})
