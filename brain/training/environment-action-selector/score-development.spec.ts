import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { action, noTask, routes, task } from './development-cases.js'
import { main, score, validatePredictionCoverage } from './score-development.js'
import { REPOSITORY_ROOT, sha256 } from './corpus.js'
import type { ActionSelectorTrainingRecord } from './generate-training-data.js'
import { DEVELOPMENT_CASES, REGRESSION_CASES } from './generate-training-data.js'
import { migrateLocomotionReference } from './locomotion-contract.js'
const prediction = (expected: Record<string, any>, actual: unknown, specialist: 'intent' | 'task' = 'task') => ({
  fold: 0, recordId: 'test-record', sourceCaseId: 'test-case', suite: 'scoring', risk: 'high', specialist,
  sourceSplit: 'development', user: '{}', expected, rawResponse: typeof actual === 'string' ? actual : JSON.stringify(actual),
  meanBatchLatencyMs: 100, promptTokens: 10, completionTokens: 5, systemOwned: true,
})
test('qualification failure shapes cannot pass the paired task references', () => {
  const language = DEVELOPMENT_CASES.find(source => source.suite === 'contrast-language-conversation')!
  const inventedMovement = score([prediction(language.targets![0]!, task('Discuss an idea.', [action('wave')]))])
  assert.equal(inventedMovement.coreValid.count, 1)
  assert.equal(inventedMovement.unsafeActionAuthorityErrors, 1)
  assert.equal(inventedMovement.typedDecisionMatch.count, 0)

  const sequence = DEVELOPMENT_CASES.find(source => source.suite === 'contrast-sequence-latch')!.targets![2]!
  const turnOnly = structuredClone(sequence)
  turnOnly.program.steps.pop()
  const missingCapture = score([prediction(sequence, turnOnly)])
  assert.equal(missingCapture.coreValid.count, 1)
  assert.equal(missingCapture.wrongPhysicalActions, 1)
  assert.equal(missingCapture.typedDecisionMatch.count, 0)
  assert.equal(missingCapture.semanticReview.confirmedCorrect, 0)

  const condition = DEVELOPMENT_CASES.find(source => source.suite === 'contrast-condition-wave-sit')!
  const both = structuredClone(condition.targets![0]!)
  both.program.steps = condition.targets![3]!.program.steps
  const bothBranches = score([prediction(condition.targets![0]!, both)])
  assert.equal(bothBranches.coreValid.count, 1)
  assert.equal(bothBranches.wrongPhysicalActions, 1)
  assert.equal(bothBranches.typedDecisionMatch.count, 0)
})
test('photo-only output cannot pass a compound visual-goal regression', () => {
  const expected = migrateLocomotionReference(structuredClone(REGRESSION_CASES.find(source => source.suite === 'goal-live-regression')!.expected)).output
  const observed = task('Use the selected interface to see one fresh capture.',
    [{ kind: 'action', action: { type: 'captureImage' } }])
  const result = score([prediction(expected, observed)])
  assert.equal(result.coreValid.count, 1, 'The recorded defect is semantic, not malformed JSON')
  assert.equal(result.missedPhysicalActions, 1)
  assert.equal(result.typedDecisionMatch.count, 0)
  assert.equal(result.acceptableRouting.count, 0)
  assert.equal(result.semanticReview.confirmedCorrect, 0)
  assert.equal(result.semanticReview.pending.length, 1)

  const premature = { ...expected, taskDecision: { ...expected.taskDecision,
    continuationPolicy: 'none', requiredCompletionBasis: 'action_result' } }
  const wrongEvidence = score([prediction(expected, premature)])
  assert.equal(wrongEvidence.exactRouting.count, 1, 'Same actions do not establish visual goal success')
  assert.equal(wrongEvidence.typedDecisionMatch.count, 0)
  assert.equal(wrongEvidence.semanticReview.confirmedCorrect, 0)
})

test('a reviewed alternative viewpoint does not have to copy the reference direction', () => {
  const expected = migrateLocomotionReference(structuredClone(REGRESSION_CASES.find(source => source.suite === 'goal-live-regression')!.expected)).output
  const alternative = structuredClone(expected)
  alternative.program.steps[0].motion.turn = -25
  const sample = prediction(expected, alternative)
  const result = score([sample], [{ recordId: sample.recordId, predictionDigest: sha256(sample),
    semantic: 'pass', grounding: 'pass', reason: 'Both directions are candidate viewpoints, not claims that glare has already improved. The whole objective and visual completion criterion remain intact.' }])
  assert.equal(result.exactRouting.count, 0)
  assert.equal(result.semanticReview.confirmedCorrect, 1)
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
  assert.equal(result.routeErrors['taskContext.conversationHistory']!.extra, 1)
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


test('intent context scoring ignores order but identifies incorrect consumers', () => {
  const expected = { needsResponse: true, needsAction: false, taskContext: [], conversationContext: ['memory', 'persona.values'] }
  const reordered = { ...expected, conversationContext: ['persona.values', 'memory'] }
  assert.equal(score([prediction(expected, reordered, 'intent')]).exactRouting.count, 1)
  const misplaced = { ...expected, taskContext: ['memory'], conversationContext: ['persona.values'] }
  const result = score([prediction(expected, misplaced, 'intent')])
  assert.equal(result.routeErrors['taskContext.memory']!.extra, 1)
  assert.equal(result.routeErrors['conversationContext.memory']!.missed, 1)
})

test('required and optional context never mask a dropped request or wrong consumer', () => {
  const expected = { needsResponse: true, needsAction: true, taskContext: ['environment'], conversationContext: ['memory'] }
  const makeRecord = (sample: ReturnType<typeof prediction>) => ({ system: '', user: sample.user, output: JSON.stringify(expected), jsonSchema: {}, metadata: {
    recordId: sample.recordId, sourceCaseId: sample.sourceCaseId, specialist: 'intent', sourceSplit: 'development',
    developmentFold: 0, suite: sample.suite, risk: sample.risk, instructionIndex: 0, contextVariation: 'clean', systemOwned: true,
    contextRequirements: { conversationContext: { required: ['memory'], optional: ['persona.personality'] } },
  } } as ActionSelectorTrainingRecord)
  const optional = prediction(expected, { ...expected, conversationContext: ['memory', 'persona.personality'] }, 'intent')
  const result = score([optional], [], [makeRecord(optional)])
  assert.equal(result.exactRouting.count, 0)
  assert.equal(result.acceptableRouting.count, 1)
  for (const patch of [ { needsAction: false }, { needsResponse: false }, { conversationContext: [] },
    { conversationContext: ['memory', 'robotStatus'] }, { taskContext: ['environment','memory'], conversationContext: [] } ]) {
    const sample = prediction(expected, { ...expected, ...patch }, 'intent')
    assert.equal(score([sample], [], [makeRecord(sample)]).acceptableRouting.count, 0)
  }
})

test('reviewed response choices accept speech or silence while retaining action and context requirements', () => {
  const expected = { needsResponse: false, needsAction: true, taskContext: ['environment'], conversationContext: [] }
  const makeRecord = (sample: ReturnType<typeof prediction>, optional = true) => ({ system: '', user: sample.user,
    output: JSON.stringify(expected), jsonSchema: {}, metadata: {
      recordId: sample.recordId, sourceCaseId: sample.sourceCaseId, specialist: 'intent', sourceSplit: 'development',
      developmentFold: 0, suite: sample.suite, risk: sample.risk, instructionIndex: 0, contextVariation: 'clean', systemOwned: true,
      ...(optional ? { responseOptional: true } : {}),
      contextRequirements: { conversationContext: { required: [], optional: ['persona.personality'] } },
    } } as ActionSelectorTrainingRecord)
  for (const needsResponse of [false, true]) {
    const sample = prediction(expected, { ...expected, needsResponse,
      conversationContext: needsResponse ? ['persona.personality'] : [] }, 'intent')
    const result = score([sample], [], [makeRecord(sample)])
    assert.equal(result.acceptableRouting.count, 1)
    assert.equal(result.exactRouting.count, needsResponse ? 0 : 1, 'Exact agreement remains separate from an acceptable alternative')
    assert.equal(result.routeErrors.needsResponse, undefined)
    if (needsResponse) assert.equal(score([sample], [], [makeRecord(sample, false)]).acceptableRouting.count, 0,
      'An explicit request for silence cannot be waived')
  }
  for (const patch of [{ needsAction: false }, { taskContext: [] }, { taskContext: ['memory'] },
    { conversationContext: ['memory'] }, { needsResponse: 'true' }]) {
    const sample = prediction(expected, { ...expected, ...patch }, 'intent')
    assert.equal(score([sample], [], [makeRecord(sample)]).acceptableRouting.count, 0)
  }
  const required = { ...expected, needsResponse: true }
  const missingReply = prediction(required, expected, 'intent')
  const record = makeRecord(missingReply, false)
  record.output = JSON.stringify(required)
  assert.equal(score([missingReply], [], [record]).acceptableRouting.count, 0, 'An explicit spoken response remains required')
  assert.equal(score([missingReply], [], [record]).routeErrors.needsResponse?.missed, 1)
})

test('alternative recall sources require at least one annotated source', () => {
  const expected = { needsResponse: true, needsAction: false, taskContext: [], conversationContext: ['memory'] }
  const sample = prediction(expected, { ...expected, conversationContext: ['conversationHistory'] }, 'intent')
  const record = { system: '', user: sample.user, output: JSON.stringify(expected), jsonSchema: {}, metadata: {
    recordId: sample.recordId, sourceCaseId: sample.sourceCaseId, specialist: 'intent', sourceSplit: 'development',
    developmentFold: 0, suite: sample.suite, risk: sample.risk, instructionIndex: 0, contextVariation: 'clean', systemOwned: true,
    contextRequirements: { conversationContext: { required: [], optional: ['persona.personality'], anyOf: [['memory','conversationHistory']] } },
  } } as ActionSelectorTrainingRecord
  assert.equal(score([sample], [], [record]).acceptableRouting.count, 1)
  const missing = { ...sample, rawResponse: JSON.stringify({ ...expected, conversationContext: ['persona.personality'] }) }
  assert.equal(score([missing], [], [record]).contextSelection.requestsMissingRequired, 1)
  assert.equal(score([missing], [], [record]).acceptableRouting.count, 0)
})


test('a reviewed equivalent generated motion can pass semantics without an exact program match', () => {
  const expected = task('Lean left and recover.', [{ kind: 'generatedMotion', description: 'Lean slowly left and return to center.' }])
  const actual = task('Lean left and recover.', [{ kind: 'generatedMotion', description: 'Slowly tilt the body to the left, then center it again.' }])
  const sample = prediction(expected, actual)
  const review = { recordId: sample.recordId, predictionDigest: sha256(sample), semantic: 'pass' as const,
    grounding: 'pass' as const, reason: 'Both descriptions specify the same direction, pace, and return to center.' }
  const result = score([sample], [review])
  assert.equal(result.exactRouting.count, 0)
  assert.equal(result.semanticReview.confirmedCorrect, 1)
  assert.equal(score([sample]).semanticReview.confirmedCorrect, 0)
})


test('tool over-delegation, missed delegation, and a missing current route cannot pass routing evaluation', () => {
  for (const needsToolUse of [false, true]) {
    const expected = { needsResponse: true, needsAction: false, needsToolUse, taskContext: [], conversationContext: [] }
    const actual = { ...expected, needsToolUse: !needsToolUse }
    const result = score([prediction(expected, actual, 'intent')])
    assert.equal(result.acceptableRouting.count, 0)
    assert.equal(result.routeErrors.needsToolUse![needsToolUse ? 'missed' : 'extra'], 1)
    const { needsToolUse: _tool, ...legacy } = expected
    assert.equal(score([prediction(expected, legacy, 'intent')]).acceptableRouting.count, 0)
    assert.equal(score([prediction(expected, expected, 'intent')]).acceptableRouting.count, 1)
  }
})

test('planner selection is scored separately from context and action routes', () => {
  const expected = { needsResponse: false, needsAction: true, needsToolUse: false, taskPlanner: 'vision', taskContext: ['vision'], conversationContext: [] }
  const actual = { ...expected, taskPlanner: 'specialist' }
  const result = score([prediction(expected, actual, 'intent')])
  assert.equal(result.acceptableRouting.count, 0)
  assert.equal(result.routeErrors['taskPlanner.vision']!.missed, 1)
  assert.equal(result.routeErrors['taskPlanner.specialist']!.extra, 1)
  assert.equal(score([prediction(expected, expected, 'intent')]).acceptableRouting.count, 1)
})
