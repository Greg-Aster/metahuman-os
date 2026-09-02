import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeInnerCuriosityForUser,
  parseInnerCuriosityArgs,
  runInnerCuriosity,
  type InnerCuriosityDependencies,
  type InnerCuriosityReceipt,
} from './core.js'

const NOW = '2026-08-28T12:00:00.000Z'

function dependencies(overrides: Partial<InnerCuriosityDependencies> = {}): InnerCuriosityDependencies {
  const receipts = new Map<string, InnerCuriosityReceipt>()
  return {
    loadConfig: () => ({
      maxOpenQuestions: 3,
      researchMode: 'local',
      innerQuestionMode: 'local',
      minTrustLevel: 'observe',
    }),
    sampleMemories: async () => ({
      memories: [{
        __memoryId: 'evt-source',
        id: 'evt-source',
        timestamp: '2026-08-28T10:00:00.000Z',
        type: 'observation',
        content: 'A grounded source memory.',
      }],
      diagnostics: {
        filesConsidered: 1,
        filesRead: 1,
        skippedMalformed: 0,
        skippedOversize: 0,
        skippedGenerated: 0,
        skippedEmpty: 0,
        truncatedContent: 0,
      },
    }),
    loadPersonaName: () => 'Test Persona',
    generateQuestion: async () => 'What pattern should I understand?',
    searchMemories: async () => [{
      id: 'evt-related',
      path: '/tmp/evt-related.json',
      type: 'episodic',
      text: 'A related indexed memory.',
      vector: [],
    }],
    generateAnswer: async () => 'The memories support one cautious connection.',
    loadReceipt: (_username, key) => receipts.get(key) || null,
    saveReceipt: receipt => { receipts.set(receipt.idempotencyKey, receipt) },
    persistDialogue: async () => {},
    triggerFollowOn: async () => {},
    auditGenerated: () => {},
    now: () => new Date(NOW),
    newExecutionId: () => 'execution-generated',
    ...overrides,
  }
}

const OPTIONS = {
  executionId: 'task-stable',
  executionTimestamp: NOW,
}

test('Inner Curiosity returns one typed generated outcome', async () => {
  const deps = dependencies()
  const result = await executeInnerCuriosityForUser('test-user', OPTIONS, deps)
  assert.deepEqual(result, {
    status: 'generated',
    username: 'test-user',
    executionId: 'task-stable',
    deduplicated: false,
    memoriesConsidered: 1,
    searchResults: 1,
  })
  const repeatedWithoutTimestamp = await executeInnerCuriosityForUser(
    'test-user',
    { executionId: OPTIONS.executionId },
    deps,
  )
  assert.equal(repeatedWithoutTimestamp.status, 'generated')
  if (repeatedWithoutTimestamp.status === 'generated') assert.equal(repeatedWithoutTimestamp.deduplicated, true)
})

test('disabled and empty-memory cycles are explicit successful skips', async () => {
  const disabled = await executeInnerCuriosityForUser('test-user', OPTIONS, dependencies({
    loadConfig: () => ({
      maxOpenQuestions: 3,
      researchMode: 'local',
      innerQuestionMode: 'off',
      minTrustLevel: 'observe',
    }),
  }))
  assert.equal(disabled.status, 'skipped')
  if (disabled.status === 'skipped') assert.equal(disabled.reason, 'disabled')

  const empty = await executeInnerCuriosityForUser('test-user', OPTIONS, dependencies({
    sampleMemories: async () => ({
      memories: [],
      diagnostics: {
        filesConsidered: 0,
        filesRead: 0,
        skippedMalformed: 0,
        skippedOversize: 0,
        skippedGenerated: 0,
        skippedEmpty: 0,
        truncatedContent: 0,
      },
    }),
  }))
  assert.equal(empty.status, 'skipped')
  if (empty.status === 'skipped') assert.equal(empty.reason, 'no-memories')
})

test('question, search, and answer failures remain real failures', async t => {
  await t.test('question failure', async () => {
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', OPTIONS, dependencies({
        generateQuestion: async () => { throw new Error('question backend unavailable') },
      })),
      /question backend unavailable/,
    )
  })
  await t.test('search failure', async () => {
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', OPTIONS, dependencies({
        searchMemories: async () => { throw new Error('index unavailable') },
      })),
      /index unavailable/,
    )
  })
  await t.test('answer failure', async () => {
    await assert.rejects(
      executeInnerCuriosityForUser('test-user', OPTIONS, dependencies({
        generateAnswer: async () => { throw new Error('answer backend unavailable') },
      })),
      /answer backend unavailable/,
    )
  })
})

test('a persistence failure resumes the prepared receipt without repeating model work', async () => {
  const receipts = new Map<string, InnerCuriosityReceipt>()
  let questionCalls = 0
  let answerCalls = 0
  let persistenceCalls = 0
  const deps = dependencies({
    generateQuestion: async () => {
      questionCalls += 1
      return 'What pattern should I understand?'
    },
    generateAnswer: async () => {
      answerCalls += 1
      return 'The memories support one cautious connection.'
    },
    loadReceipt: (_username, key) => receipts.get(key) || null,
    saveReceipt: receipt => { receipts.set(receipt.idempotencyKey, receipt) },
    persistDialogue: async () => {
      persistenceCalls += 1
      if (persistenceCalls === 1) throw new Error('buffer unavailable')
    },
  })

  await assert.rejects(
    executeInnerCuriosityForUser('test-user', OPTIONS, deps),
    /buffer unavailable/,
  )
  assert.equal([...receipts.values()][0].status, 'prepared')

  const resumed = await executeInnerCuriosityForUser('test-user', OPTIONS, deps)
  assert.equal(resumed.status, 'generated')
  if (resumed.status === 'generated') assert.equal(resumed.deduplicated, true)
  const repeated = await executeInnerCuriosityForUser('test-user', OPTIONS, deps)
  assert.equal(repeated.status, 'generated')
  if (repeated.status === 'generated') assert.equal(repeated.deduplicated, true)
  assert.equal(questionCalls, 1)
  assert.equal(answerCalls, 1)
  assert.equal(persistenceCalls, 2)
})

test('follow-on admission happens only after durable dialogue persistence and resumes from the prepared receipt', async () => {
  const order: string[] = []
  const receipts = new Map<string, InnerCuriosityReceipt>()
  let followOnCalls = 0
  const deps = dependencies({
    loadReceipt: (_username, key) => receipts.get(key) || null,
    saveReceipt: receipt => { receipts.set(receipt.idempotencyKey, receipt) },
    persistDialogue: async () => { order.push('persist') },
    triggerFollowOn: async () => {
      order.push('follow-on')
      followOnCalls += 1
      if (followOnCalls === 1) throw new Error('coordinator unavailable')
    },
  })

  await assert.rejects(
    executeInnerCuriosityForUser('test-user', OPTIONS, deps),
    /coordinator unavailable/,
  )
  assert.deepEqual(order, ['persist', 'follow-on'])
  assert.equal([...receipts.values()][0].status, 'prepared')

  const resumed = await executeInnerCuriosityForUser('test-user', OPTIONS, deps)
  assert.equal(resumed.status, 'generated')
  assert.deepEqual(order, ['persist', 'follow-on', 'persist', 'follow-on'])
})

test('cancellation, unsupported options, and unresolved identity fail explicitly', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  await assert.rejects(
    executeInnerCuriosityForUser('test-user', { ...OPTIONS, signal: controller.signal }, dependencies()),
    /cancelled by test/,
  )

  const inFlightController = new AbortController()
  let persistenceCalls = 0
  await assert.rejects(
    executeInnerCuriosityForUser('test-user', {
      ...OPTIONS,
      signal: inFlightController.signal,
    }, dependencies({
      generateQuestion: async () => {
        inFlightController.abort(new Error('cancelled after model response'))
        return 'What pattern should I understand?'
      },
      persistDialogue: async () => { persistenceCalls += 1 },
    })),
    /cancelled after model response/,
  )
  assert.equal(persistenceCalls, 0)

  assert.throws(() => parseInnerCuriosityArgs(['--single-user'], {}), /Unknown inner-curiosity option/)
  assert.deepEqual(parseInnerCuriosityArgs([], {
    MH_TRIGGER_USERNAME: 'test-user',
    MH_TASK_ID: 'task-1',
    MH_TASK_CREATED_AT: NOW,
  }), {
    username: 'test-user',
    executionId: 'task-1',
    executionTimestamp: NOW,
  })
  await assert.rejects(
    runInnerCuriosity({ username: 'definitely-missing-inner-curiosity-user' }),
    /No authenticated user found/,
  )
})
