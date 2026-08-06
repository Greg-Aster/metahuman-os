import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  summarize,
  type BenchmarkCaseResult,
} from './benchmark.js'
import {
  computeHeldOutDigest,
  loadLockedCorpus,
  sha256,
  validateCorpus,
  type EnvironmentClassifierCorpus,
  type HeldOutLock,
} from './corpus.js'
import {
  DEVELOPMENT_FOLD_COUNT,
  assignDevelopmentFolds,
  buildTrainingDataset,
  buildTrainingManifest,
  controlledRouteSurfaceCount,
  expectedTrainingRecordCount,
  validateTrainingDataset,
  type ClassifierTrainingRecord,
} from './generate-training-data.js'
import { loadContextRouterPrompt } from './prompt.js'

const laneUrl = new URL('./', import.meta.url)

async function loadFixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, laneUrl), 'utf8')) as T
}

test('the gold corpus has 64 valid cases and a locked 16-case held-out split', async () => {
  const corpus = await loadFixture<EnvironmentClassifierCorpus>('corpus.json')
  const lock = await loadFixture<HeldOutLock>('held-out.lock.json')

  assert.deepEqual(validateCorpus(corpus, lock), [])
  assert.equal(corpus.cases.length, 64)
  assert.equal(corpus.cases.filter(testCase => testCase.split === 'development').length, 48)
  assert.equal(corpus.cases.filter(testCase => testCase.split === 'held_out').length, 16)
  assert.equal(computeHeldOutDigest(corpus), lock.digest)
})

test('held-out ids are disjoint from development ids', async () => {
  const corpus = await loadFixture<EnvironmentClassifierCorpus>('corpus.json')
  const developmentIds = new Set(
    corpus.cases.filter(testCase => testCase.split === 'development').map(testCase => testCase.id),
  )
  for (const testCase of corpus.cases.filter(testCase => testCase.split === 'held_out')) {
    assert.equal(developmentIds.has(testCase.id), false, testCase.id)
  }
})

test('every requested routing family is represented', async () => {
  const corpus = await loadFixture<EnvironmentClassifierCorpus>('corpus.json')
  const suites = new Set(corpus.cases.map(testCase => testCase.suite))
  assert.deepEqual([...suites].sort(), [
    'ambiguity',
    'bounded_task',
    'conversation',
    'delegated_intention',
    'fresh_vision',
    'memory',
    'one_shot_movement',
    'persisted_contract',
    'state_query',
    'unsafe_action_authority',
    'vision_acquisition',
  ])
  assert.equal(corpus.cases.some(testCase => testCase.risk === 'classifier_disagreement'), true)
  assert.equal(corpus.cases.some(testCase => testCase.risk === 'capability_unavailable'), true)
})

test('an unsafe action false positive fails the baseline gate', () => {
  const result: BenchmarkCaseResult = {
    provider: 'ollama',
    model: 'test-model',
    caseId: 'case-001',
    suite: 'unsafe_action_authority',
    split: 'held_out',
    risk: 'action_authority',
    jsonValid: true,
    contractValid: true,
    exactRoute: false,
    unsafeActionError: true,
    unnecessaryVisionAdmission: false,
    missedAction: false,
    mismatchedRouteFields: ['needsAction'],
    validationErrors: [],
    expectedRoute: {
      needsMemory: false,
      needsEnvironment: false,
      needsVision: false,
      needsAction: false,
      actionType: 'none',
      motionClass: null,
      continuationPolicy: null,
      requiredCompletionBasis: null,
    },
    rawResponse: '{}',
    wallLatencyMs: 10,
    providerDurationMs: 9,
    promptTokens: 100,
    completionTokens: 20,
  }

  const summary = summarize('test-model', [result])
  assert.equal(summary.unsafeActionErrors, 1)
  assert.equal(summary.baselineGatePassed, false)
})

test('unnecessary vision admission fails the deployment gate', () => {
  const result: BenchmarkCaseResult = {
    provider: 'vllm',
    model: 'test-model',
    caseId: 'case-002',
    suite: 'conversation',
    split: 'held_out',
    risk: 'vision_over_admission',
    jsonValid: true,
    contractValid: true,
    exactRoute: false,
    unsafeActionError: false,
    unnecessaryVisionAdmission: true,
    missedAction: false,
    mismatchedRouteFields: ['needsVision'],
    validationErrors: [],
    expectedRoute: {
      needsMemory: false,
      needsEnvironment: false,
      needsVision: false,
      needsAction: false,
      actionType: 'none',
      motionClass: null,
      continuationPolicy: null,
      requiredCompletionBasis: null,
    },
    rawResponse: '{}',
    wallLatencyMs: 10,
  }

  const summary = summarize('test-model', [result])
  assert.equal(summary.unnecessaryVisionAdmissions, 1)
  assert.equal(summary.baselineGatePassed, false)
})

test('training data expands only the 48 development cases into controlled variants', async () => {
  const { corpus, lock } = await loadLockedCorpus()
  const prompt = await loadContextRouterPrompt()
  const records = buildTrainingDataset(corpus, prompt)
  const developmentCases = corpus.cases.filter(testCase => testCase.split === 'development')
  const expectedCount = expectedTrainingRecordCount(corpus)

  assert.deepEqual(validateTrainingDataset(records, corpus, lock), [])
  assert.equal(records.length, expectedCount)
  assert.equal(records.every(record => record.metadata.sourceSplit === 'development'), true)
  assert.equal(records.some(record => lock.caseIds.includes(record.metadata.sourceCaseId)), false)
  const heldOutInstructions = new Set(corpus.cases
    .filter(testCase => testCase.split === 'held_out')
    .map(testCase => testCase.input.envelope.currentInstruction.trim().toLocaleLowerCase()))
  assert.equal(records.some(record => {
    const input = JSON.parse(record.compactInput) as { currentInstruction: string }
    return heldOutInstructions.has(input.currentInstruction.trim().toLocaleLowerCase())
  }), false)
  assert.equal(records.every(record => Object.keys(JSON.parse(record.output)).length === 14), true)
  assert.equal(records.every(record => record.compactInput.startsWith('{')), true)
  assert.equal(controlledRouteSurfaceCount(corpus), 13)
  assert.equal(records.some(record => record.metadata.stressors.includes('route_counterfactual')), true)

  const folds = assignDevelopmentFolds(corpus)
  assert.equal(new Set(folds.values()).size, DEVELOPMENT_FOLD_COUNT)
  for (const suite of new Set(developmentCases.map(testCase => testCase.suite))) {
    const suiteFolds = new Set(
      developmentCases.filter(testCase => testCase.suite === suite).map(testCase => folds.get(testCase.id)),
    )
    assert.equal(suiteFolds.size, DEVELOPMENT_FOLD_COUNT, suite)
  }

  const robotMovementPositives = records.filter(record => {
    const output = JSON.parse(record.output) as { needsAction: boolean; actionType: string }
    return output.needsAction && output.actionType === 'robot_movement'
  })
  assert.equal(robotMovementPositives.length >= 100, true)
})

test('checked-in training artifacts match the current development split and prompt', async () => {
  const { corpus, lock } = await loadLockedCorpus()
  const prompt = await loadContextRouterPrompt()
  const expectedRecords = buildTrainingDataset(corpus, prompt)
  const recordsText = await readFile(new URL('development-training.jsonl', laneUrl), 'utf8')
  const records = recordsText.trim().split('\n').map(line => JSON.parse(line)) as ClassifierTrainingRecord[]
  const manifest = await loadFixture<ReturnType<typeof buildTrainingManifest>>(
    'development-training.manifest.json',
  )

  assert.deepEqual(records, expectedRecords)
  assert.deepEqual(manifest, buildTrainingManifest({ records, corpus, lock, prompt }))
  assert.equal(manifest.provenance.datasetDigest, sha256(records))
  assert.equal(manifest.heldOutUsed, false)
})
