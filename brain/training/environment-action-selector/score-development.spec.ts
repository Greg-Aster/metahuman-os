import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { action, noTask, routes, task } from './development-cases.js'
import { main, score, validatePredictionCoverage } from './score-development.js'
import { REPOSITORY_ROOT, sha256 } from './corpus.js'
import type { ActionSelectorTrainingRecord } from './generate-training-data.js'
const prediction = (expected: Record<string, any>, actual: unknown, specialist: 'intent' | 'task' = 'task') => ({
  fold: 0, recordId: 'test-record', sourceCaseId: 'test-case', suite: 'scoring', risk: 'high', specialist,
  sourceSplit: 'development', user: '{}', expected, rawResponse: typeof actual === 'string' ? actual : JSON.stringify(actual),
  meanBatchLatencyMs: 100, promptTokens: 10, completionTokens: 5, systemOwned: true,
})
test('scoring catches a wrong later program step and false completion without a receipt', () => {
  const expected = task('Wave and bow.', [action('wave'), action('bow')])
  const wrong = task('Wave and bow.', [action('wave'), action('sit')])
  const first = score([prediction(expected, wrong)])
  assert.equal(first.exactRouting.count, 0)
  assert.equal(first.wrongPhysicalActions, 1)
  const extraField = score([prediction(expected, { ...expected, invented: true })])
  assert.equal(extraField.coreValid.count, 0)
  assert.equal(extraField.wrongPhysicalActions, 0)
  const falseComplete = { ...expected, program: null, taskDecision: { ...expected.taskDecision, outcome: 'complete', requiredCompletionBasis: 'user_input' } }
  const second = score([prediction(expected, falseComplete)])
  assert.equal(second.falseCompletions, 1)
  assert.equal(second.missedPhysicalActions, 1)
})
test('malformed or unstructured output cannot count as an exact no-task match', () => {
  for (const output of ['not json', '[]', '{}', '{"program":{"steps":"invalid"},"taskDecision":null}']) {
    const result = score([prediction(noTask(), output)])
    assert.equal(result.coreValid.count, 0)
    assert.equal(result.typedDecisionMatch.count, 0)
  }
})
test('intent scoring distinguishes missing action context from unnecessary history', () => {
  const expected = routes(['needsAction', 'needsEnvironment'])
  const result = score([prediction(expected, routes(['needsConversationHistory']), 'intent')])
  assert.equal(result.routeErrors.needsAction!.missed, 1)
  assert.equal(result.routeErrors.needsConversationHistory!.extra, 1)
  assert.equal(result.typedDecisionMatch.count, 0)
})

test('frozen inputs require all IDs once and unchanged provenance and gold', () => {
  const predictions = ['first', 'second'].map(id => ({ ...prediction(noTask(), noTask()), recordId: id }))
  const records = predictions.map(value => ({ system: 'unchanged', user: value.user, output: JSON.stringify(value.expected), jsonSchema: {},
    metadata: { recordId: value.recordId, sourceCaseId: value.sourceCaseId, specialist: value.specialist,
      sourceSplit: 'development', developmentFold: value.fold, suite: value.suite, risk: value.risk,
      instructionIndex: 0, contextVariation: 'clean', systemOwned: true } })) as ActionSelectorTrainingRecord[]
  assert.equal(validatePredictionCoverage(predictions, records).expected, 2)
  assert.throws(() => validatePredictionCoverage(predictions.slice(0, 1), records), /missing.*second/)
  assert.throws(() => validatePredictionCoverage([...predictions, predictions[0]!], records), /duplicates.*first/)
  assert.throws(() => validatePredictionCoverage([...predictions, { ...predictions[0]!, recordId: 'unknown' }], records), /unexpected.*unknown/)
  for (const patch of [{ expected: task('Invented action', [action('bow')]) }, { user: 'Different input' }, { fold: 1 }, { sourceCaseId: 'invented' }]) {
    assert.throws(() => validatePredictionCoverage([{ ...predictions[0]!, ...patch }, predictions[1]!], records), /provenance or reference/)
  }
})

test('correct action bytes do not claim that a contradictory objective is correct', () => {
  const expected = task('Bow once.', [action('bow')])
  const actual = structuredClone(expected)
  actual.taskDecision.objective = 'Wave indefinitely instead of bowing.'
  actual.taskDecision.completionCriteria = 'The response has been spoken; no physical result is needed.'
  const sample = prediction(expected, actual)
  const result = score([sample])
  assert.equal(result.exactRouting.count, 1)
  assert.equal(result.typedDecisionMatch.count, 1)
  assert.equal(result.semanticReview.confirmedCorrect, 0)
  assert.equal(result.semanticReview.unreviewed, 1)
  assert.deepEqual(result.semanticReview.pending[0]!.actual, actual)
  const review = { recordId: sample.recordId, predictionDigest: sha256(sample), semantic: 'fail' as const,
    grounding: 'fail' as const, reason: 'Objective contradicts the request; completion substitutes speech for physical evidence.' }
  assert.equal(score([sample], [review]).semanticReview.unreviewed, 0)
  assert.equal(score([sample], [review]).semanticReview.confirmedCorrect, 0)
  assert.throws(() => score([{ ...sample, rawResponse: JSON.stringify(expected) }], [review]), /stale semantic review/)
})

test('semantic equivalence can be reviewed without requiring identical objective wording', () => {
  const expected = task('Bow once.', [action('bow')])
  const actual = structuredClone(expected)
  actual.taskDecision.objective = 'Perform one bow.'
  const sample = prediction(expected, actual)
  const review = { recordId: sample.recordId, predictionDigest: sha256(sample), semantic: 'pass' as const,
    grounding: 'pass' as const, reason: 'The objective and completion criterion preserve the requested action and evidence.' }
  assert.equal(score([sample], [review]).semanticReview.confirmedCorrect, 1)
})


test('planning delegation is a valid distinct choice, not an exact no-task match', () => {
  const result = score([prediction({ delegatePlanning: true }, { delegatePlanning: true })])
  assert.equal(result.coreValid.count, 1)
  assert.equal(result.typedDecisionMatch.count, 1)
  const unexpected = score([prediction(noTask(), { delegatePlanning: true })])
  assert.equal(unexpected.coreValid.count, 1)
  assert.equal(unexpected.exactRouting.count, 0)
  assert.equal(unexpected.typedDecisionMatch.count, 0)
})

test('CLI cannot write a perfect report from a partial prediction set', async () => {
  const directory = resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(resolve(directory, 'coverage-test-'))
  try {
    const samples = ['first', 'second'].map(id => ({ ...prediction(noTask(), noTask()), recordId: id }))
    const records = samples.map(value => ({ system: 'Fixture', user: value.user, output: JSON.stringify(value.expected), jsonSchema: {},
      metadata: { ...value, developmentFold: 0, instructionIndex: 0, contextVariation: 'clean' } }))
    const predictions = resolve(root, 'predictions.jsonl'), expected = resolve(root, 'inputs.jsonl'), report = resolve(root, 'report.json')
    await writeFile(expected, records.map(value => JSON.stringify(value)).join('\n'))
    await writeFile(predictions, JSON.stringify(samples[0]))
    const args = ['--root', root, '--predictions', predictions, '--records', expected, '--output', report]
    await assert.rejects(main(args), /Incomplete prediction coverage/)
    await assert.rejects(access(report), /ENOENT/)
    await writeFile(predictions, samples.map(value => JSON.stringify(value)).join('\n'))
    await main(args)
    const result = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(result.coverage.expected, 2)
    assert.equal(result.aggregate.typedDecisionMatch.count, 2)
    assert.equal(result.aggregate.semanticReview.confirmedCorrect, 0)
    assert.equal(result.aggregate.semanticReview.unreviewed, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
