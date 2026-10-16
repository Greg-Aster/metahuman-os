import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDevelopmentRecords, DEVELOPMENT_CASES, EVALUATION_CASES } from './generate-training-data.js'

const development = buildDevelopmentRecords(DEVELOPMENT_CASES.filter(source => source.suite.startsWith('binding-')))
const clean = async () => (await development).filter(row => row.metadata.contextVariation === 'clean')

test('gesture/photo contrasts retain the same context but select distinct requested operations', async () => {
  const rows = (await clean()).filter(row => row.metadata.suite.startsWith('binding-demonstration-'))
  assert.ok(rows.length > 0)
  for (const id of new Set(rows.map(row => row.metadata.sourceCaseId))) {
    const family = rows.filter(row => row.metadata.sourceCaseId === id)
    const outputs = family.map(row => JSON.parse(row.plannerReferenceOutput ?? row.output))
    assert.ok(outputs.some(value => value.program === null))
    assert.ok(outputs.some(value => value.program?.steps.length === 1 && value.program.steps[0].action.type === 'captureImage'))
    assert.ok(outputs.some(value => value.program?.steps.length === 1 && value.program.steps[0].action.type === 'robotCommand'))
    assert.ok(outputs.some(value => value.program?.steps.length === 2))
    const context = family.map(row => {
      const value = JSON.parse(row.user)
      delete value.currentInstruction
      if (value.plannerDecision) delete value.plannerDecision.instruction
      return value
    })
    for (const value of context) assert.deepEqual(value, context[0])
  }
})

test('exclusive, inclusive-boundary and sequence labels follow the supplied voltage', async () => {
  const rows = (await clean()).filter(row => row.metadata.suite.startsWith('binding-condition-'))
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const envelope = JSON.parse(row.user)
    const instruction = envelope.currentInstruction as string
    const output = JSON.parse(row.output)
    const actions = output.program?.steps.map((step: any) => step.action.command) ?? []
    if (instruction.startsWith('Perform both')) {
      assert.equal(actions.length, 2)
      continue
    }
    const match = instruction.match(/(?:at most|above) ([\d.]+) volts/)
    assert.ok(match)
    const threshold = Number(match[1])
    const voltage = envelope.robotStatus.body.battery.voltage
    const [low, high] = row.metadata.suite.replace('binding-condition-', '').split('-')
    const expected = instruction.startsWith('Only') && voltage > threshold ? [] : [voltage <= threshold ? low : high]
    assert.deepEqual(actions, expected)
    const peers = rows.filter(other => JSON.parse(other.user).currentInstruction === instruction)
    assert.equal(new Set(peers.map(peer => peer.metadata.developmentFold)).size, 1)
    assert.equal(new Set(peers.map(peer => JSON.parse(peer.user).robotStatus.body.battery.voltage)).size, 3)
  }
})

test('visual targets distinguish finite repositioning, observed completion and movement without a camera', async () => {
  const rows = (await clean()).filter(row => row.metadata.suite.startsWith('binding-visual-'))
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const output = JSON.parse(row.plannerReferenceOutput ?? row.output)
    if ([0, 2].includes(row.metadata.instructionIndex)) {
      assert.deepEqual(output, { delegatePlanning: true }, 'Retired cycle-based gait requests retain planning delegation, not a fabricated metric endpoint')
      const instruction = JSON.parse(row.user).currentInstruction
      assert.match(instruction, /gait cycles/)
      if (row.metadata.instructionIndex === 2) assert.ok(instruction.includes(row.metadata.suite.slice('binding-visual-'.length).replaceAll('-', ' ')))
      continue
    }
    const steps = output.program.steps
    {
      assert.equal(output.taskDecision.requiredCompletionBasis, 'visual_observation')
      assert.equal(output.taskDecision.continuationPolicy, 'bounded')
      assert.equal(steps.at(-1).action.type, 'captureImage')
      const target = row.metadata.suite.slice('binding-visual-'.length).replaceAll('-', ' ')
      assert.ok(output.taskDecision.objective.includes(target))
      assert.ok(output.taskDecision.completionCriteria.includes(target))
      assert.doesNotMatch(output.taskDecision.objective, /label|carton|glare/)
    }
    for (const step of steps) if (step.action?.type === 'robotCommand') {
      assert.equal(step.action.continuous, false)
      assert.ok(step.action.units > 0)
    }
    if (row.metadata.instructionIndex === 3) {
      assert.equal(steps[0].kind, 'behavior')
      assert.equal(steps[0].motion.continuous, true)
      assert.deepEqual(steps[0].motion.locomotionGoal, { kind: 'visual', target: steps[0].target, completionCriteria: steps[0].completionCriteria })
      assert.ok(steps[0].completionCriteria.includes(steps[0].target))
    }
  }
})

test('binding families preserve attribution, fold isolation, contracts and held-out request separation', async () => {
  const rows = await development
  assert.ok(rows.length > 0)
  assert.deepEqual([...new Set(rows.map(row => row.metadata.developmentFold))].sort(), [0, 1, 2, 3])
  for (const row of rows) {
    const envelope = JSON.parse(row.user)
    const source = DEVELOPMENT_CASES.find(item => item.id === row.metadata.sourceCaseId)!
    const peers = rows.filter(other => other.metadata.suite === row.metadata.suite
      && other.metadata.instructionIndex === row.metadata.instructionIndex
      && other.metadata.contextVariation === row.metadata.contextVariation
      && JSON.stringify(JSON.parse(other.user).robotStatus) === JSON.stringify(envelope.robotStatus))
    assert.equal(peers.length, 2)
    assert.equal(new Set(peers.map(peer => peer.metadata.developmentFold)).size, 1)
    assert.equal(peers[0]!.output, peers[1]!.output)
    assert.equal(envelope.inputSource, source.inputSource)
    if (source.inputSource === 'autonomy') assert.equal(envelope.plannerDecision.instruction, envelope.currentInstruction)
  }
  const fit = new Set((await buildDevelopmentRecords()).filter(row => row.metadata.specialist === 'task').map(row => JSON.parse(row.user).currentInstruction.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES)
  for (const row of evaluation.filter(row => row.metadata.specialist === 'task')) {
    assert.ok(!fit.has(JSON.parse(row.user).currentInstruction.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()), row.metadata.recordId)
  }
  assert.ok(evaluation.some(row => row.metadata.suite.startsWith('binding-eval-')))
})
