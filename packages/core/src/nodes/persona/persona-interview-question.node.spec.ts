import assert from 'node:assert/strict'
import test from 'node:test'

import type { Session } from '../../persona/session-manager.js'
import type { RouterCallOptions } from '../../model-router.js'
import {
  executePersonaInterviewQuestion,
  parsePersonaInterviewQuestion,
} from './persona-interview-question.node.js'

const session: Session = {
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
}

test('persona interview generation is a graph-owned typed model operation', async () => {
  let request: RouterCallOptions | undefined
  const output = await executePersonaInterviewQuestion(
    {
      session,
      config: { categories: ['values', 'goals'], maxQuestionsPerSession: 10 },
      profile: { methodology: {}, interviewingTechniques: {}, privacyAndEthics: {} },
      gaps: ['values'],
    },
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
  assert.equal((output.question as { category: string }).category, 'values')
  assert.equal(output.reasoning, 'Values have not been explored.')
})

test('persona interview parsing rejects unknown categories and malformed output', () => {
  assert.throws(
    () => parsePersonaInterviewQuestion(
      '{"question":"Why?","category":"unknown","reasoning":"Needed."}',
      ['values'],
      1,
      new Date('2026-09-03T00:00:00.000Z'),
    ),
    /missing required typed fields/,
  )
  assert.throws(
    () => parsePersonaInterviewQuestion('not json', ['values'], 1, new Date()),
    /did not contain a JSON object/,
  )
})
