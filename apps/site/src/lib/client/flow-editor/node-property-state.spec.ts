import assert from 'node:assert/strict'
import test from 'node:test'
import { withUpdatedNodeProperty } from './node-property-state.js'

test('sequential property edits merge from the latest node state', () => {
  const original = {
    title: 'Prompt owner',
    properties: {
      systemPrompt: 'Original prompt',
      temperature: 0.2,
    },
  }

  const firstEdit = withUpdatedNodeProperty(original, 'systemPrompt', 'Edited prompt')
  const secondEdit = withUpdatedNodeProperty(firstEdit, 'temperature', 0.4)

  assert.deepEqual(secondEdit, {
    title: 'Prompt owner',
    properties: {
      systemPrompt: 'Edited prompt',
      temperature: 0.4,
    },
  })
  assert.equal(original.properties.systemPrompt, 'Original prompt')
})

test('malformed property state fails instead of discarding it', () => {
  assert.throws(
    () => withUpdatedNodeProperty({ properties: [] as never }, 'prompt', 'value'),
    /Node properties must be an object/,
  )
})
