import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnvironmentSessionSuggestions, parseModelSuggestions } from './property-suggestions.js'

test('node choices use explicit model inventory and include served adapters', () => {
  assert.deepEqual(parseModelSuggestions({
    availableModels: [{ id: 'global-substitution', model: 'large' }],
    nodeModels: [{ id: 'small', provider: 'ollama', model: 'small', adapters: [] }],
    modelCategories: { lora: [{ id: 'vllm-lora.specialist', name: 'specialist', valid: true, loaded: true }] },
  }), [
    { value: 'small', label: 'ollama: small' },
    { value: 'vllm-lora.specialist', label: 'vllm: specialist' },
  ])
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
