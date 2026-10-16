import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVELOPMENT_CASES, EVALUATION_CASES, buildDevelopmentRecords, validateDevelopmentRecords } from './generate-training-data.js'

test('quoted commands remain conversation-only while unquoted commands retain body intent', async () => {
  const selected = [...DEVELOPMENT_CASES, ...EVALUATION_CASES].filter(c => c.suite.startsWith('quoted-imperative-'))
  const rows = await buildDevelopmentRecords(selected)
  assert.deepEqual(validateDevelopmentRecords(rows, selected), [])
  const development = rows.filter(r => r.metadata.sourceSplit === 'development')
  const fit = new Set(development.map(r => r.user))
  for (const row of rows) {
    const input = JSON.parse(row.user), output = JSON.parse(row.output), i = row.metadata.instructionIndex
    assert.ok(!input.currentInstruction.includes('Whoa, quick movement!'))
    assert.ok(!input.currentInstruction.includes('Take a bow, my friend.'))
    if (row.metadata.sourceSplit === 'evaluation') assert.ok(!fit.has(row.user))
    const peers = rows.filter(r => r.metadata.suite === row.metadata.suite)
    assert.equal(new Set(peers.map(r => r.metadata.developmentFold)).size, 1)
    assert.deepEqual([...new Set(peers.map(r => r.metadata.inputSource))].sort(), ['autonomy', 'user'])
    if (i === 2 || i === 7) { assert.equal(output.program, null); continue }
    const retiredDirect = ['quoted-imperative-development-4', 'quoted-imperative-development-6',
      'quoted-imperative-evaluation-2', 'quoted-imperative-evaluation-3'].includes(row.metadata.suite)
    if (retiredDirect && (i === 5 || i === 6)) {
      assert.deepEqual(output, { delegatePlanning: true }, 'Retired bare gait starts require planning under the endpoint contract')
      continue
    }
    const steps = output.program.steps
    assert.equal(steps.length, [1, 1, 0, 1, 2, 1, 1][i])
    for (const step of steps) {
      assert.equal(step.kind, 'action')
      if (step.kind === 'action') assert.ok(Object.hasOwn(input.currentEnvironment.capabilities.robotCommandCatalog, step.action.command))
    }
    if (i === 5) assert.equal(steps[0].kind, 'action')
    if (i === 0) {
      const direct = peers.find(r => r.metadata.instructionIndex === 5 && r.metadata.inputSource === row.metadata.inputSource && r.metadata.contextVariation === row.metadata.contextVariation)!
      // Compare meaning, not opaque identifiers, which vary with instruction index.
      const catalog = input.currentEnvironment.capabilities.robotCommandCatalog
      const directInput = JSON.parse(direct.user), directOutput = JSON.parse(direct.output)
      if (retiredDirect) assert.deepEqual(directOutput, { delegatePlanning: true })
      else assert.notEqual(catalog[steps[0].action.command], directInput.currentEnvironment.capabilities.robotCommandCatalog[directOutput.program.steps[0].action.command])
    }
  }
})
