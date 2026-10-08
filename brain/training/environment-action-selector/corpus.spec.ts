import assert from 'node:assert/strict'
import test from 'node:test'
import { environmentActionParserNode } from '@metahuman/core/nodes'
import { loadPriorEvaluationEvidence, sha256 } from './corpus.js'
import { ROUTE_FIELDS } from './development-cases.js'
import { DEVELOPMENT_CASES, EVALUATION_CASES, buildDevelopmentRecords, validateDevelopmentRecords } from './generate-training-data.js'

const recordsPromise = buildDevelopmentRecords()
test('both specialists use valid runtime outputs; advertised commands pass capability admission', async () => {
  const { lock } = await loadPriorEvaluationEvidence()
  const records = await recordsPromise
  assert.deepEqual(validateDevelopmentRecords(records, DEVELOPMENT_CASES, lock.caseIds), [])
  for (const record of records.filter(item => item.metadata.specialist === 'task')) {
    const envelope = JSON.parse(record.user)
    const source = DEVELOPMENT_CASES.find(item => item.id === record.metadata.sourceCaseId)!
    const output = JSON.parse(record.output)
    if (!output.program) continue
    const catalog = envelope.currentEnvironment.capabilities.robotCommandCatalog
    const parsed = await environmentActionParserNode.execute({ response: record.output,
      observation: { capabilities: { actions: envelope.currentEnvironment.capabilities.actions,
        robotCommands: Object.keys(catalog ?? {}), robotCommandDescriptions: catalog } },
      activeExecutions: source.inputs?.activeExecutions ?? [],
    }, {} as never, { includeResponse: false } as never)
    assert.equal(parsed.valid, true, `${record.metadata.recordId}: ${JSON.stringify(parsed.validationErrors)}`)
  }
})
test('intent sees only the incoming message and task receives the selected runtime envelope', async () => {
  const records = await recordsPromise
  for (const record of records) {
    assert.doesNotMatch(`${record.system}\n${record.user}`, /profiles\/|persona\/|greggles|Ainekio/)
    if (record.metadata.specialist === 'intent') {
      assert.ok(record.user.startsWith('Current user message: '))
      assert.ok(!record.user.includes('currentEnvironment'))
      assert.ok(ROUTE_FIELDS.every(key => typeof JSON.parse(record.output)[key] === 'boolean'))
    } else {
      assert.ok(!('response' in JSON.parse(record.output)))
      assert.equal(JSON.parse(record.user).inputSource, 'user')
    }
  }
})
test('evaluation and cross-validation keep all variants of each source on one side', async () => {
  const records = await recordsPromise
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  assert.deepEqual(validateDevelopmentRecords(evaluation, EVALUATION_CASES), [])
  const trainingIds = new Set(records.map(record => record.metadata.sourceCaseId))
  assert.ok(evaluation.every(record => !trainingIds.has(record.metadata.sourceCaseId)))
  const trainingMessages = new Set(records.map(record => sha256([record.system, record.user])))
  assert.ok(evaluation.every(record => !trainingMessages.has(sha256([record.system, record.user]))))
  for (const specialist of ['intent', 'task']) for (let fold = 0; fold < 4; fold++) {
    const training = records.filter(record => record.metadata.specialist === specialist && record.metadata.developmentFold !== fold)
    const validation = records.filter(record => record.metadata.specialist === specialist && record.metadata.developmentFold === fold)
    assert.ok(training.length > validation.length && validation.length > 0)
    assert.ok(validation.every(record => !training.some(other => other.metadata.sourceCaseId === record.metadata.sourceCaseId)))
  }
})
test('opaque catalogs preserve meanings and every ordered program step', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.contextVariation === 'opaque-identifiers')
  assert.ok(records.length)
  for (const record of records) {
    const catalog = JSON.parse(record.user).currentEnvironment.capabilities.robotCommandCatalog ?? {}
    for (const step of JSON.parse(record.output).program?.steps ?? []) if (step.action?.type === 'robotCommand') {
      assert.match(step.action.command, /^k\d+$/)
      assert.equal(typeof catalog[step.action.command], 'string')
    }
  }
})
