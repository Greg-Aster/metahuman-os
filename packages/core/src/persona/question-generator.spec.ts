import assert from 'node:assert/strict'
import test from 'node:test'

import type { Session } from './session-manager.js'
import { selectPersonaInterviewCategory } from './session-manager.js'
import {
  evaluatePersonaInterviewCompletion,
  normalizePersonaInterviewConfig,
  parsePersonaInterviewConfig,
} from './question-generator.js'

const rawConfig = {
  version: '1.0.0',
  description: 'Persona interview',
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
  interviewer: { corePhilosophy: 'Be curious.', tone: 'Warm and clear' },
  privacyGuidelines: ['Do not request private identifiers.'],
  interviewingTechniques: { openEndedQuestions: true, avoidJudgment: true },
  sessionDefaults: {
    minAnswerLength: 20,
    maxAnswerLength: 2_000,
    targetCategoryCompletionPercentage: 80,
  },
}

const session: Session = {
  sessionId: 'session-a',
  userId: 'account-a',
  username: 'profile-a',
  status: 'active',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  questions: [],
  answers: [],
  categoryCoverage: {
    values: 50,
    goals: 0,
    style: 0,
    biography: 50,
    current_focus: 0,
  },
}

test('normalizes one bounded canonical persona interview policy', () => {
  const config = parsePersonaInterviewConfig({
    ...rawConfig,
    baselineQuestions: [{ id: 'legacy' }],
    sessionDefaults: { ...rawConfig.sessionDefaults, autoSaveInterval: 30_000 },
  })
  assert.equal('baselineQuestions' in config, false)
  assert.equal('autoSaveInterval' in config.sessionDefaults, false)
  assert.equal(config.sessionDefaults.maxAnswerLength, 2_000)
})

test('migrates the former split policy into the canonical profile configuration', () => {
  const systemDefault = parsePersonaInterviewConfig({ ...rawConfig, version: '1.1.0' })
  const legacy = {
    ...rawConfig,
    version: '1.0.0',
    baselineQuestions: [{ id: 'legacy' }],
  }
  delete (legacy as Partial<typeof legacy>).interviewer
  const migrated = normalizePersonaInterviewConfig(legacy, systemDefault)
  assert.equal(migrated.version, '1.1.0')
  assert.deepEqual(migrated.interviewer, systemDefault.interviewer)
  assert.equal('baselineQuestions' in migrated, false)
})

test('rejects invalid limits and deterministically selects the least-covered category', () => {
  assert.throws(
    () => parsePersonaInterviewConfig({
      ...rawConfig,
      sessionDefaults: { ...rawConfig.sessionDefaults, minAnswerLength: 0 },
    }),
    /minAnswerLength/,
  )
  const config = parsePersonaInterviewConfig(rawConfig)
  assert.equal(selectPersonaInterviewCategory(session, config), 'goals')
})

test('does not complete while a generated question is still unanswered', () => {
  const config = parsePersonaInterviewConfig({
    ...rawConfig,
    maxQuestionsPerSession: 1,
    requireMinimumAnswers: 1,
    categories: ['values'],
    sessionDefaults: {
      ...rawConfig.sessionDefaults,
      targetCategoryCompletionPercentage: 50,
    },
  })
  const pending: Session = {
    ...session,
    questions: [{ id: 'q1', prompt: 'What matters?', category: 'values' }],
    answers: [],
    categoryCoverage: { ...session.categoryCoverage, values: 0 },
  }
  assert.equal(evaluatePersonaInterviewCompletion(pending, config).isComplete, false)

  const answered: Session = {
    ...pending,
    answers: [{ questionId: 'q1', content: 'Autonomy matters.', capturedAt: '2026-09-04T00:01:00.000Z' }],
    categoryCoverage: { ...pending.categoryCoverage, values: 50 },
  }
  const completed = evaluatePersonaInterviewCompletion(answered, config)
  assert.equal(completed.isComplete, true)
  assert.equal(completed.message, 'Maximum questions reached.')
})
