import assert from 'node:assert/strict'
import test from 'node:test'

import type { PersonaInterviewConfig } from '../../persona/question-generator.js'
import type { Session } from '../../persona/session-manager.js'
import type { RouterCallOptions } from '../../model-router.js'
import {
  executePersonaInterviewQuestion,
  parsePersonaInterviewQuestion,
} from './persona-interview-question.node.js'

const config: PersonaInterviewConfig = {
  version: '1.0.0',
  description: 'Test interview policy',
  maxQuestionsPerSession: 15,
  requireMinimumAnswers: 7,
  categories: ['values', 'goals', 'style', 'biography', 'current_focus'],
  categoryDescriptions: {
    values: 'Core principles',
    goals: 'Aspirations',
    style: 'Communication preferences',
    biography: 'Formative experiences',
    current_focus: 'Current priorities',
  },
  interviewer: {
    corePhilosophy: 'Use curiosity and psychological safety.',
    tone: 'Warm and clear',
  },
  privacyGuidelines: ['Do not request private identifiers.'],
  interviewingTechniques: { openEndedQuestions: true, avoidJudgment: true },
  sessionDefaults: {
    minAnswerLength: 3,
    maxAnswerLength: 2_000,
    targetCategoryCompletionPercentage: 80,
  },
}

const session = (overrides: Partial<Session> = {}): Session => ({
  sessionId: 'session-a',
  userId: 'account-a',
  username: 'profile-a',
  status: 'active',
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  questions: [],
  answers: [],
  categoryCoverage: {
    values: 0,
    goals: 0,
    style: 0,
    biography: 0,
    current_focus: 0,
  },
  ...overrides,
})

test('persona interview generation enforces the graph-selected category', async () => {
  let request: RouterCallOptions | undefined
  const output = await executePersonaInterviewQuestion(
    { session: session(), config, targetCategory: 'values' },
    { username: 'profile-a', userId: 'account-a', cognitiveMode: 'agent' },
    {},
    {
      callModel: async input => {
        request = input
        return {
          content: '{"question":"What principle guides difficult choices?","category":"values","reasoning":"Values have not been explored."}',
          provider: 'test',
          model: 'test',
          modelId: 'test',
          role: 'psychotherapist',
        }
      },
      now: () => new Date('2026-09-03T01:02:03.000Z'),
    },
  )

  assert.equal(request?.userId, 'account-a')
  const systemMessage = request?.messages[0].content
  assert.equal(typeof systemMessage, 'string')
  assert.match(systemMessage as string, /Required category: values/)
  assert.equal((output.question as { id: string }).id, 'q1')
  assert.equal((output.question as { category: string }).category, 'values')
  assert.equal(output.reasoning, 'Values have not been explored.')
})

test('persona interview parsing rejects a changed target, duplicate, and malformed output', () => {
  const now = new Date('2026-09-03T00:00:00.000Z')
  assert.throws(
    () => parsePersonaInterviewQuestion(
      '{"question":"Why?","category":"goals","reasoning":"Needed."}',
      config.categories,
      'values',
      [],
      1,
      now,
    ),
    /requested category/,
  )
  assert.throws(
    () => parsePersonaInterviewQuestion(
      '{"question":"What principle guides difficult choices!","category":"values","reasoning":"Needed."}',
      config.categories,
      'values',
      ['What principle guides difficult choices?'],
      2,
      now,
    ),
    /duplicates an earlier question/,
  )
  assert.throws(
    () => parsePersonaInterviewQuestion('not json', config.categories, 'values', [], 1, now),
    /did not contain a JSON object/,
  )
})

test('persona interview generation rejects invalid history before calling the model', async () => {
  let called = false
  await assert.rejects(
    executePersonaInterviewQuestion(
      {
        session: session({
          questions: [{ id: 'q1', prompt: 'What matters?', category: 'values' }],
          answers: [{ questionId: 'q1', content: 'x', capturedAt: '2026-09-03T00:00:00.000Z' }],
        }),
        config,
        targetCategory: 'goals',
      },
      { username: 'profile-a', userId: 'account-a' },
      {},
      {
        callModel: async input => {
          called = true
          return {
            content: '{}',
            provider: 'test',
            model: 'test',
            modelId: 'test',
            role: input.role,
          }
        },
        now: () => new Date(),
      },
    ),
    /invalid answer history/,
  )
  assert.equal(called, false)
})

test('persona interview generation rejects a non-canonical target before calling the model', async () => {
  let called = false
  await assert.rejects(
    executePersonaInterviewQuestion(
      { session: session(), config, targetCategory: 'goals' },
      { username: 'profile-a', userId: 'account-a' },
      {},
      {
        callModel: async input => {
          called = true
          return {
            content: '{}',
            provider: 'test',
            model: 'test',
            modelId: 'test',
            role: input.role,
          }
        },
        now: () => new Date(),
      },
    ),
    /canonical coverage policy/,
  )
  assert.equal(called, false)
})
