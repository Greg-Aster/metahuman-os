import assert from 'node:assert/strict'
import test from 'node:test'

import { parseOutcomeReviewResponse } from './outcome-reviewer.node.js'

const valid = {
  verdict: 'retry',
  reasoning: 'The plan used an unavailable permission.',
  successScore: 0.2,
  failureCategory: 'external_error',
  isFixableBug: false,
  lessonsLearned: ['Check authorization before execution.'],
  nextAttemptSuggestions: ['Ask the user to grant access.'],
  notifyUser: true,
  userMessage: 'Access is required.',
}

test('outcome review parsing accepts a complete typed decision', () => {
  const parsed = parseOutcomeReviewResponse(JSON.stringify(valid))
  assert.equal(parsed.verdict, valid.verdict)
  assert.equal(parsed.reasoning, valid.reasoning)
  assert.deepEqual(parsed.lessonsLearned, valid.lessonsLearned)
  assert.equal(parsed.notifyUser, true)
})

test('outcome review parsing fails closed instead of fabricating repair work', () => {
  assert.throws(
    () => parseOutcomeReviewResponse('not json'),
    /did not contain a JSON object/,
  )
  assert.throws(
    () => parseOutcomeReviewResponse(JSON.stringify({ ...valid, verdict: 'repair' })),
    /verdict is invalid/,
  )
  assert.throws(
    () => parseOutcomeReviewResponse(JSON.stringify({ ...valid, successScore: 4 })),
    /between 0 and 1/,
  )
  assert.throws(
    () => parseOutcomeReviewResponse(JSON.stringify({ ...valid, lessonsLearned: 'none' })),
    /array of non-empty strings/,
  )
})
