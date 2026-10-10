import assert from 'node:assert/strict'
import test from 'node:test'
import { environmentActionParserNode } from '@metahuman/core/nodes'
import { loadPriorEvaluationEvidence, sha256 } from './corpus.js'
import { ROUTE_FIELDS } from './development-cases.js'
import { DEVELOPMENT_CASES, EVALUATION_CASES, REGRESSION_CASES, buildDevelopmentRecords, validateDevelopmentRecords } from './generate-training-data.js'

const recordsPromise = buildDevelopmentRecords()
test('ordinary action requests train both response choices without weakening explicit speech or silence', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.specialist === 'intent')
  for (const message of ['Please bow.', 'Take a new picture.', 'Stand upright.', 'Could you give us a wave now?']) {
    const choices = records.filter(record => record.user === `Current user message: ${message}`)
    assert.equal(choices.length, 2, message)
    assert.deepEqual(new Set(choices.map(record => JSON.parse(record.output).needsResponse)), new Set([false, true]))
    assert.equal(new Set(choices.map(record => record.metadata.sourceCaseId)).size, 1)
    assert.equal(new Set(choices.map(record => record.metadata.developmentFold)).size, 1)
    const [quiet, reply] = choices.map(record => JSON.parse(record.output))
    assert.equal(quiet.needsAction, true)
    assert.equal(reply.needsAction, true)
    assert.deepEqual(quiet.taskContext, reply.taskContext)
    assert.deepEqual(quiet.conversationContext, [])
    assert.deepEqual(reply.conversationContext, ['persona.personality'])
    assert.equal(choices[0]!.system, choices[1]!.system)
    assert.deepEqual(choices[0]!.jsonSchema, choices[1]!.jsonSchema)
  }
  for (const [message, needsResponse] of [
    ['Do a bow without speaking.', false], ['Move into standing and say nothing.', false],
    ['Bow, then give me a spoken acknowledgement.', true], ['How are you today?', true],
  ] as const) {
    const choices = records.filter(record => record.user === `Current user message: ${message}`)
    assert.equal(choices.length, 1, message)
    assert.equal(JSON.parse(choices[0]!.output).needsResponse, needsResponse)
    assert.equal(choices[0]!.metadata.responseOptional, undefined)
  }
  const optional = records.filter(record => record.metadata.responseOptional)
  for (const user of new Set(optional.map(record => record.user))) {
    const choices = optional.filter(record => record.user === user)
    assert.equal(choices.length, 2, user)
    assert.deepEqual(new Set(choices.map(record => JSON.parse(record.output).needsResponse)), new Set([false, true]))
    assert.equal(new Set(choices.map(record => record.metadata.developmentFold)).size, 1)
  }
})

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
      assert.ok(ROUTE_FIELDS.every(key => key === 'taskContext' || key === 'conversationContext'
        ? Array.isArray(JSON.parse(record.output)[key]) : typeof JSON.parse(record.output)[key] === 'boolean'))
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


test('fresh intent evaluation is separate from development and the old regression set', async () => {
  const development = await recordsPromise
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  const regression = await buildDevelopmentRecords(REGRESSION_CASES)
  const intent = (records: typeof development) => records.filter(record => record.metadata.specialist === 'intent')
  assert.equal(intent(development).length, 1164)
  assert.equal(new Set(intent(development).map(record => record.user)).size, 1000)
  assert.equal(intent(evaluation).length, 200)
  assert.equal(intent(regression).length, 44)
  const seen = new Set([...development, ...regression].map(record => record.user))
  assert.ok(intent(evaluation).every(record => !seen.has(record.user)))
  const pairs = new Set(DEVELOPMENT_CASES.filter(item => item.suite.startsWith('composition-')).map(item => item.suite))
  assert.ok(EVALUATION_CASES.every(item => !pairs.has(item.suite)))
  for (const record of [...development, ...evaluation, ...regression]) {
    const output = JSON.parse(record.output)
    for (const [consumer, requirement] of Object.entries(record.metadata.contextRequirements ?? {})) {
      assert.ok(requirement.required.every(entry => output[consumer].includes(entry)))
      assert.ok((requirement.anyOf ?? []).every(group => group.some(entry => output[consumer].includes(entry))))
      assert.ok(output[consumer].every((entry: string) => [...requirement.required, ...requirement.optional, ...(requirement.anyOf ?? []).flat()].includes(entry)))
    }
  }
})


test('conditional task cases expose the status value that determines the requested branch', async () => {
  const rows = (await recordsPromise).filter(record => record.metadata.suite === 'expanded-status-condition')
  assert.equal(rows.length, 48)
  const pairs = new Map<string, Set<string>>()
  const folds = new Map<string, Set<number>>()
  for (const record of rows.filter(record => record.metadata.contextVariation === 'clean')) {
    const envelope = JSON.parse(record.user)
    assert.equal(typeof envelope.robotStatus.body.battery.voltage, 'number')
    assert.equal(envelope.robotStatus.body.battery.observedAt, '2030-01-15T12:00:00.000Z')
    const choices = pairs.get(envelope.currentInstruction) ?? new Set<string>()
    choices.add(JSON.parse(record.output).program.steps[0].action.command)
    pairs.set(envelope.currentInstruction, choices)
    const group = folds.get(envelope.currentInstruction) ?? new Set<number>()
    group.add(record.metadata.developmentFold)
    folds.set(envelope.currentInstruction, group)
  }
  assert.ok([...pairs.values()].every(choices => choices.size === 2))
  assert.ok([...folds.values()].every(group => group.size === 1))
})


test('task catalog-only variations keep commands and separately selected evidence', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.specialist === 'task' && record.metadata.contextVariation === 'reordered')
  assert.ok(records.length > 0)
  for (const record of records) {
    const envelope = JSON.parse(record.user)
    assert.equal(envelope.currentEnvironment.state.batteryPercent, undefined)
    if (JSON.parse(record.output).program?.steps.some((step: any) => step.action?.type === 'robotCommand')) {
      assert.ok(Object.keys(envelope.currentEnvironment.capabilities.robotCommandCatalog).length > 0)
    }
    if (record.metadata.suite === 'expanded-status-condition') assert.equal(typeof envelope.robotStatus.body.battery.voltage, 'number')
  }
})
