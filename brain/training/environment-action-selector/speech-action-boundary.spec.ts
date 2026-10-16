import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVELOPMENT_CASES, EVALUATION_CASES, buildDevelopmentRecords, validateDevelopmentRecords } from './generate-training-data.js'

test('speech/action contrasts preserve quoted words, body intent, provenance and split separation', async () => {
  const selected = [...DEVELOPMENT_CASES, ...EVALUATION_CASES].filter(c => c.suite.startsWith('speech-action-boundary-'))
  const rows = await buildDevelopmentRecords(selected)
  assert.deepEqual(validateDevelopmentRecords(rows, selected), [])
  const fit = rows.filter(r => r.metadata.sourceSplit === 'development')
  const fitInstructions = new Set(fit.map(r => JSON.parse(r.user).currentInstruction))
  for (const row of rows) {
    const input = JSON.parse(row.user), output = JSON.parse(row.output)
    const i = row.metadata.instructionIndex, steps = output.program?.steps
    assert.ok(!input.currentInstruction.includes('Whoa, quick movement!'), 'Live failure must remain held out')
    const peers = rows.filter(r => r.metadata.suite === row.metadata.suite)
    assert.equal(new Set(peers.map(r => r.metadata.developmentFold)).size, 1)
    assert.deepEqual([...new Set(peers.map(r => r.metadata.inputSource))].sort(), ['autonomy', 'user'])
    if (input.inputSource === 'autonomy') assert.equal(input.plannerDecision.instruction, input.currentInstruction)
    if (row.metadata.sourceSplit === 'evaluation') assert.ok(!fitInstructions.has(input.currentInstruction))
    if ([0, 4, 7].includes(i)) { assert.equal(output.program, null); continue }
    if ([5, 6].includes(i)) {
      assert.deepEqual(output, { delegatePlanning: true }, 'Retired bare gait starts require endpoint planning')
      continue
    }
    assert.equal(steps.length, [0, 1, 1, 2, 0, 1, 1][i])
    for (const step of steps) {
      assert.equal(step.kind, 'action')
      if (step.kind === 'action') assert.ok(Object.hasOwn(input.currentEnvironment.capabilities.robotCommandCatalog, step.action.command))
    }
    if (i === 5) assert.equal(steps[0].kind, 'action')
  }
})
