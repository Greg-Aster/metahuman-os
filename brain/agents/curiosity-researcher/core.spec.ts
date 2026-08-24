import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { safeWriteJSON } from '@metahuman/core'
import {
  parseCuriosityResearcherArgs,
  parsePendingCuriosityQuestion,
  processResearchQueue,
  runCycle,
  type CuriosityResearchDependencies,
  type CuriosityResearchRecord,
} from './core.js'

const NOW = '2026-08-24T22:00:00.000Z'

function temporaryQueue(): { root: string; pendingQuestions: string; research: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curiosity-researcher-'))
  const pendingQuestions = path.join(root, 'state', 'curiosity', 'questions', 'pending')
  const research = path.join(root, 'memory', 'curiosity', 'research')
  fs.mkdirSync(pendingQuestions, { recursive: true })
  return { root, pendingQuestions, research }
}

function writeQuestion(pendingQuestions: string, id: string): void {
  safeWriteJSON(path.join(pendingQuestions, `${id}.json`), {
    id,
    question: 'What patterns connect this question to prior memories?',
    askedAt: '2026-08-24T20:00:00.000Z',
    status: 'pending',
    seedMemories: ['evt-seed'],
    username: 'test-user',
  })
}

function dependencies(overrides: Partial<CuriosityResearchDependencies> = {}): CuriosityResearchDependencies {
  return {
    researchQuestion: async () => ({
      topics: ['memory patterns', 'curiosity'],
      sourceMemoryIds: ['evt-related'],
      sourceResearchIds: [],
      summary: 'The available memory supports one grounded connection.',
    }),
    captureLearning: () => ({ eventId: 'evt-research', filePath: '/tmp/evt-research.json' }),
    writeRecord: (filePath: string, record: CuriosityResearchRecord) => safeWriteJSON(filePath, record),
    auditCompletion: () => {},
    now: () => NOW,
    ...overrides,
  }
}

test('Curiosity Researcher CLI arguments are strict and accept scheduler context', () => {
  assert.deepEqual(parseCuriosityResearcherArgs([], 'test-user'), { username: 'test-user' })
  assert.deepEqual(parseCuriosityResearcherArgs(['--username=other-user'], 'test-user'), { username: 'other-user' })
  assert.throws(() => parseCuriosityResearcherArgs(['--single-user']), /Unknown curiosity-researcher option/)
  assert.throws(() => parseCuriosityResearcherArgs(['--username', '../escape']), /Invalid username format/)
})

test('pending question validation blocks filename and path traversal mismatches', () => {
  assert.throws(
    () => parsePendingCuriosityQuestion({
      id: '../escape',
      question: 'Unsafe question',
      askedAt: NOW,
      status: 'pending',
    }),
    /Curiosity question id/,
  )
  assert.throws(
    () => parsePendingCuriosityQuestion({
      id: 'cur-q-1',
      question: 'Mismatched question',
      askedAt: NOW,
      status: 'pending',
    }, 'other.json'),
    /filename does not match/,
  )
})

test('scheduled cycle reports user-resolution failures instead of exiting successfully', async () => {
  const result = await runCycle({ username: 'definitely-missing-curiosity-user' })
  assert.equal(result.success, false)
  assert.equal(result.usersProcessed, 0)
  assert.equal(result.researchCompleted, 0)
  assert.match(result.errors.join('\n'), /No explicit or active authenticated user found/)
})

test('research queue commits one typed finding and is idempotent', async t => {
  const queue = temporaryQueue()
  t.after(() => fs.rmSync(queue.root, { recursive: true, force: true }))
  const questionId = 'cur-q-1787600000000-abc123'
  writeQuestion(queue.pendingQuestions, questionId)

  let researchCalls = 0
  let captureCalls = 0
  let priorResearchCount = 0
  const deps = dependencies({
    researchQuestion: async (_question, _username, priorResearch) => {
      researchCalls++
      priorResearchCount = priorResearch.length
      return {
        topics: ['memory patterns'],
        sourceMemoryIds: ['evt-related'],
        sourceResearchIds: priorResearch.map(record => record.id),
        summary: 'A durable grounded finding.',
      }
    },
    captureLearning: () => {
      captureCalls++
      return { eventId: 'evt-research', filePath: '/tmp/evt-research.json' }
    },
  })

  assert.equal(await processResearchQueue(queue, 'test-user', deps), 1)
  const record = JSON.parse(fs.readFileSync(path.join(queue.research, `${questionId}.json`), 'utf8'))
  assert.equal(record.status, 'completed')
  assert.equal(record.questionId, questionId)
  assert.equal(record.memoryEventId, 'evt-research')
  assert.deepEqual(record.sourceMemoryIds, ['evt-related'])

  const secondQuestionId = 'cur-q-1787600000002-ghi789'
  writeQuestion(queue.pendingQuestions, secondQuestionId)
  assert.equal(await processResearchQueue(queue, 'test-user', deps), 1)
  assert.equal(priorResearchCount, 1)
  const secondRecord = JSON.parse(fs.readFileSync(path.join(queue.research, `${secondQuestionId}.json`), 'utf8'))
  assert.deepEqual(secondRecord.sourceResearchIds, [`curiosity-research:${questionId}`])

  assert.equal(await processResearchQueue(queue, 'test-user', deps), 0)
  assert.equal(researchCalls, 2)
  assert.equal(captureCalls, 2)
})

test('a failed memory capture leaves prepared research retryable without another LLM call', async t => {
  const queue = temporaryQueue()
  t.after(() => fs.rmSync(queue.root, { recursive: true, force: true }))
  const questionId = 'cur-q-1787600000001-def456'
  writeQuestion(queue.pendingQuestions, questionId)

  await assert.rejects(
    processResearchQueue(queue, 'test-user', dependencies({
      captureLearning: () => {
        throw new Error('capture unavailable')
      },
    })),
    /capture unavailable/,
  )
  const recordPath = path.join(queue.research, `${questionId}.json`)
  assert.equal(JSON.parse(fs.readFileSync(recordPath, 'utf8')).status, 'prepared')

  let researchCalls = 0
  assert.equal(await processResearchQueue(queue, 'test-user', dependencies({
    researchQuestion: async () => {
      researchCalls++
      throw new Error('research should not repeat')
    },
  })), 1)
  assert.equal(researchCalls, 0)
  assert.equal(JSON.parse(fs.readFileSync(recordPath, 'utf8')).status, 'completed')
})
