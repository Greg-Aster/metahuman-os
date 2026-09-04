import assert from 'node:assert/strict'
import test from 'node:test'

import type { Desire, DesireExecution } from '../../agency/types.js'
import type { RouterCallOptions, RouterResponse } from '../../model-router.js'
import {
  parseDesireOutcomeReviewResponse,
  runDesireOutcomeReview,
} from './desire-outcome-reviewer.node.js'

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
  const parsed = parseDesireOutcomeReviewResponse(JSON.stringify(valid))
  assert.equal(parsed.verdict, valid.verdict)
  assert.equal(parsed.reasoning, valid.reasoning)
  assert.deepEqual(parsed.lessonsLearned, valid.lessonsLearned)
  assert.equal(parsed.notifyUser, true)
})

test('outcome review parsing fails closed instead of fabricating repair work', () => {
  assert.throws(
    () => parseDesireOutcomeReviewResponse('not json'),
    /did not contain a JSON object/,
  )
  assert.throws(
    () => parseDesireOutcomeReviewResponse(JSON.stringify({ ...valid, verdict: 'repair' })),
    /verdict is invalid/,
  )
  assert.throws(
    () => parseDesireOutcomeReviewResponse(JSON.stringify({ ...valid, successScore: 4 })),
    /between 0 and 1/,
  )
  assert.throws(
    () => parseDesireOutcomeReviewResponse(JSON.stringify({ ...valid, lessonsLearned: 'none' })),
    /array of non-empty strings/,
  )
})

test('desire outcome review routes its model call through the graph cognitive mode', async () => {
  let request: RouterCallOptions | undefined
  const call = async (input: RouterCallOptions): Promise<RouterResponse> => {
    request = input
    return {
      content: JSON.stringify(valid),
      model: 'test-model',
      modelId: 'test-model',
      role: input.role,
      provider: 'test',
    }
  }
  const desire = {
    id: 'desire-1',
    title: 'Verify the result',
    description: 'Check that the desired result was achieved.',
    reason: 'Completion requires evidence.',
    metrics: { executionFailCount: 0 },
  } as Desire
  const execution = {
    startedAt: '2026-09-04T00:00:00.000Z',
    status: 'completed',
    stepsCompleted: 1,
    stepsTotal: 1,
    stepResults: [],
  } as DesireExecution

  await runDesireOutcomeReview(
    desire,
    execution,
    'profile-user-id',
    { cognitiveMode: 'agent' },
    call,
  )

  assert.equal(request?.cognitiveMode, 'agent')
  assert.equal(request?.userId, 'profile-user-id')
})
