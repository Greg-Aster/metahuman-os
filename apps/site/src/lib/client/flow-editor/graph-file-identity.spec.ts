import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeGraphFileName,
  overwritesDifferentGraph,
  saveDialogFileName,
} from './graph-file-identity'

test('the current loaded filename remains the default save target', () => {
  assert.equal(
    saveDialogFileName('boredom-autonomy-mode', 'Robot Autonomy Executor'),
    'boredom-autonomy-mode',
  )
})

test('a new graph derives a safe filename from its display name', () => {
  assert.equal(saveDialogFileName('', 'Mood Persona Review (Draft)'), 'mood-persona-review-draft')
  assert.equal(normalizeGraphFileName('My Graph.JSON'), 'my-graph-json')
})

test('only an existing graph other than the loaded graph needs overwrite confirmation', () => {
  const known = ['environment-mode', 'robot-autonomy-executor']
  assert.equal(overwritesDifferentGraph('environment-mode', 'environment-mode', known), false)
  assert.equal(overwritesDifferentGraph('environment-mode', 'new-workflow', known), false)
  assert.equal(overwritesDifferentGraph('environment-mode', 'robot-autonomy-executor', known), true)
})
