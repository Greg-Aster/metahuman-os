import assert from 'node:assert/strict'
import test from 'node:test'

import { validateEnvironmentSelectorOutput } from '@metahuman/core'
import { environmentActionParserNode } from '../../../packages/core/src/nodes/environment/action-parser.node.js'

import { loadPriorEvaluationEvidence } from './corpus.js'
import { ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES } from './development-cases.js'
import {
  RECORDS_PER_SOURCE_CASE,
  buildDevelopmentRecords,
  validateDevelopmentRecords,
} from './generate-training-data.js'

function authorizesPhysicalWork(output: string): boolean {
  const validation = validateEnvironmentSelectorOutput(output)
  return Boolean(
    validation.value?.actions.some(action => action.type === 'robotCommand' || action.type === 'visualApproach')
    || validation.value?.movementRequest,
  )
}

test('all sanitized source outputs satisfy the shared strict Core contract', async () => {
  const { lock, receipt } = await loadPriorEvaluationEvidence()
  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.heldOutDigest, lock.digest)
  assert.equal(new Set(ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.map(value => value.id)).size, ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.length)
  assert.equal(ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.some(value => lock.caseIds.includes(value.id)), false)

  for (const sourceCase of ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES) {
    const output = JSON.stringify(sourceCase.expected)
    const validation = validateEnvironmentSelectorOutput(output, sourceCase.observation.sessionId)
    assert.equal(validation.valid, true, `${sourceCase.id}: ${validation.errors.join('; ')}`)
    const parsed = await environmentActionParserNode.execute({
      response: output,
      observation: sourceCase.observation,
      sessionId: sourceCase.observation.sessionId,
    }, {} as never, {} as never)
    const expectedWork = sourceCase.expected.actions.length > 0 || sourceCase.expected.movementRequest !== null
    assert.equal(Boolean(parsed.valid), expectedWork, `${sourceCase.id}: capability admission changed`)
  }
})

test('generator uses the runtime formatter and excludes profile, persona, and prior locked data', async () => {
  const { lock } = await loadPriorEvaluationEvidence()
  const records = await buildDevelopmentRecords()
  assert.equal(records.length, ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.length * RECORDS_PER_SOURCE_CASE)
  assert.deepEqual(validateDevelopmentRecords(records, ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES, lock.caseIds), [])
  assert.equal(records.some(record => lock.caseIds.includes(record.metadata.sourceCaseId)), false)
  assert.equal(records.some(record => /profiles\/|persona\/|greggles|Ainekio/i.test(`${record.system}\n${record.user}`)), false)
  assert.equal(records.every(record => {
    const parsed = JSON.parse(record.output) as Record<string, unknown>
    return JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify([
      'actions',
      'movementRequest',
      'response',
      'taskDecision',
    ])
  }), true)
})

test('corpus balances positive work with negative authority and covers required routes', () => {
  const cases = ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES
  const positive = cases.filter(value => authorizesPhysicalWork(JSON.stringify(value.expected)))
  const negative = cases.filter(value => !authorizesPhysicalWork(JSON.stringify(value.expected)))
  assert.ok(positive.length >= 18)
  assert.ok(negative.length >= 24)
  assert.ok(cases.some(value => value.expected.actions[0]?.type === 'robotCommand'))
  assert.ok(cases.some(value => value.expected.movementRequest !== null))
  assert.ok(cases.some(value => value.expected.actions[0]?.type === 'captureImage'))
  assert.ok(cases.some(value => value.expected.taskDecision.outcome === 'escalate'))
  assert.ok(cases.some(value => value.suite === 'negation'))
  assert.ok(cases.some(value => value.suite === 'quoted'))
  assert.ok(cases.some(value => value.suite === 'hypothetical'))
  assert.ok(cases.some(value => value.suite === 'future'))
  assert.ok(cases.some(value => value.suite === 'stale-history'))
  assert.ok(cases.some(value => value.suite === 'state-and-capability-query'))
  assert.ok(cases.some(value => value.suite === 'target-relative'))
})

test('critical action boundaries have independent source cases on every fold', () => {
  const cases = ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES
  const criticalSuites = [
    'persisted-failure',
    'persisted-visual-complete',
    'persisted-visual-incomplete',
    'fresh-vision',
    'vision-acquisition',
    'vision-unavailable',
    'authority-boundary-negative',
    'authority-boundary-positive',
    'target-relative',
    'target-relative-unavailable',
  ]
  for (const suite of criticalSuites) {
    assert.deepEqual(
      [...new Set(cases.filter(value => value.suite === suite).map(value => value.fold))].sort(),
      [0, 1, 2, 3],
      `${suite} is not represented on every fold`,
    )
  }
  for (let heldBackFold = 0; heldBackFold < 4; heldBackFold += 1) {
    const trainingSide = cases.filter(value => value.fold !== heldBackFold)
    assert.ok(trainingSide.filter(value => authorizesPhysicalWork(JSON.stringify(value.expected))).length >= 24)
    assert.ok(trainingSide.filter(value => !authorizesPhysicalWork(JSON.stringify(value.expected))).length >= 30)
  }
})
