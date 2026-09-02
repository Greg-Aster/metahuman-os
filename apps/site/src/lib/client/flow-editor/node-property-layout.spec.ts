import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANVAS_TEXTAREA_MAX_HEIGHT,
  CANVAS_TEXTAREA_MIN_HEIGHT,
  getCanvasTextareaHeight,
} from './node-property-layout.js'

test('canvas textareas grow with content within bounded heights', () => {
  assert.equal(getCanvasTextareaHeight(24), CANVAS_TEXTAREA_MIN_HEIGHT)
  assert.equal(getCanvasTextareaHeight(184.2), 185)
  assert.equal(getCanvasTextareaHeight(900), CANVAS_TEXTAREA_MAX_HEIGHT)
})

test('invalid textarea measurements use the safe minimum', () => {
  assert.equal(getCanvasTextareaHeight(Number.NaN), CANVAS_TEXTAREA_MIN_HEIGHT)
  assert.equal(getCanvasTextareaHeight(Number.POSITIVE_INFINITY), CANVAS_TEXTAREA_MIN_HEIGHT)
})
