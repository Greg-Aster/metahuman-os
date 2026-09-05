import assert from 'node:assert/strict'
import test from 'node:test'
import {
  graphEditorLocation,
  isGraphEditorLocation,
} from './graph-editor-location'

test('graph editor URLs preserve the current route, query, and view hash', () => {
  assert.equal(
    graphEditorLocation('http://127.0.0.1:4321/?profile=guest#view=chat', true),
    'http://127.0.0.1:4321/?profile=guest&workspace=graph-editor#view=chat',
  )
})

test('leaving the editor removes only the graph workspace identity', () => {
  assert.equal(
    graphEditorLocation('http://127.0.0.1:4321/?profile=guest&workspace=graph-editor#view=chat', false),
    'http://127.0.0.1:4321/?profile=guest#view=chat',
  )
})

test('the editor is restored only for its explicit per-tab URL', () => {
  assert.equal(isGraphEditorLocation('http://127.0.0.1:4321/?workspace=graph-editor#view=chat'), true)
  assert.equal(isGraphEditorLocation('http://127.0.0.1:4321/#view=chat'), false)
  assert.equal(isGraphEditorLocation('http://127.0.0.1:4321/?workspace=other#view=chat'), false)
})
