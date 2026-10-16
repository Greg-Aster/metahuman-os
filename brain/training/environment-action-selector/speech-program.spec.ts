import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVELOPMENT_CASES, EVALUATION_CASES, REGRESSION_CASES, buildDevelopmentRecords, validateDevelopmentRecords } from './generate-training-data.js'

const selected = (cases: typeof DEVELOPMENT_CASES) => cases.filter(item => item.suite.startsWith('speech-program-'))
test('ordered speech examples use the live contract, keep sibling folds together, and separate holdout instructions', async () => {
  const development = await buildDevelopmentRecords(selected(DEVELOPMENT_CASES))
  const evaluation = await buildDevelopmentRecords(selected(EVALUATION_CASES))
  assert.deepEqual(validateDevelopmentRecords(development, selected(DEVELOPMENT_CASES)), [])
  assert.deepEqual(validateDevelopmentRecords(evaluation, selected(EVALUATION_CASES)), [])
  const trainingRequests = new Set(development.map(row => row.metadata.specialist === 'task'
    ? JSON.parse(row.user).currentInstruction : row.user))
  for (const row of evaluation) assert.ok(!trainingRequests.has(row.metadata.specialist === 'task'
    ? JSON.parse(row.user).currentInstruction : row.user))
  const taskRows = development.filter(row => row.metadata.specialist === 'task')
  assert.ok(taskRows.some(row => JSON.parse(row.output).program?.steps.length === 2))
  assert.ok(taskRows.some(row => JSON.parse(row.output).program === null))
  for (const row of taskRows) {
    const input = JSON.parse(row.user), output = JSON.parse(row.output)
    const peers = taskRows.filter(peer => peer.metadata.suite === row.metadata.suite)
    assert.equal(new Set(peers.map(peer => peer.metadata.developmentFold)).size, 1)
    assert.deepEqual([...new Set(peers.map(peer => peer.metadata.inputSource))].sort(), ['autonomy', 'user'])
    if (input.inputSource === 'autonomy') assert.equal(input.plannerDecision.instruction, input.currentInstruction)
    for (const step of output.program?.steps ?? []) {
      assert.notEqual(step.kind, 'speech')
      if (step.kind === 'action') assert.equal(step.action.type, 'robotCommand')
    }
    if (row.metadata.suite.includes('voice-only')) assert.equal(output.program, null)
  }
})

test('camera capture and selected visual task evidence have vision planner training labels', async () => {
  const rows = await buildDevelopmentRecords([...DEVELOPMENT_CASES, ...EVALUATION_CASES, ...REGRESSION_CASES]
    .filter(item => item.specialist === 'intent'))
  let captures = 0, visual = 0
  for (const row of rows) {
    const output = JSON.parse(row.output), suite = row.metadata.suite
    if (['fresh-image', 'request-photo', 'speech-program-visual-route'].includes(suite) || suite.startsWith('composition-4-')) {
      assert.equal(output.taskPlanner, 'vision', row.metadata.recordId)
      captures++
    }
    if (output.taskContext.includes('vision')) {
      assert.equal(output.taskPlanner, 'vision', row.metadata.recordId)
      visual++
    }
  }
  assert.ok(captures > 0 && visual > 0)
})


test('small Task training delegates visual objectives and preserves nonvisual program targets', async () => {
  const cases = [...DEVELOPMENT_CASES, ...EVALUATION_CASES, ...REGRESSION_CASES]
  const rows = await buildDevelopmentRecords(cases.filter(source => source.specialist === 'task'))
  const byId = new Map(cases.map(source => [source.id, source]))
  let delegated = 0, nonvisual = 0
  for (const row of rows) {
    const output = JSON.parse(row.output)
    const source = byId.get(row.metadata.sourceCaseId)!
    const reference = source.targets?.[row.metadata.instructionIndex] ?? source.expected
    assert.ok(row.system.includes('Handle nonvisual task planning here.'))
    if (row.plannerReferenceOutput) {
      delegated++
      assert.deepEqual(output, { delegatePlanning: true })
      assert.ok(reference.taskDecision || reference.program)
      assert.equal(JSON.parse(row.user).plannerReferenceOutput, undefined)
      assert.ok(!row.user.includes('delegatePlanning'))
    } else if (row.metadata.contextVariation === 'clean') {
      nonvisual++
      if (output.delegatePlanning && !reference.delegatePlanning) {
        const catalog = JSON.parse(row.user).currentEnvironment.capabilities.robotCommandCatalog
        assert.ok(reference.program.steps.some((step: any) =>
          step.action?.type === 'robotCommand' && !Object.hasOwn(catalog, step.action.command)
          || step.action?.type === 'move' && !step.action.locomotionGoal), 'Only retired gait labels gain nonvisual delegation')
        assert.deepEqual(output, { delegatePlanning: true })
      } else assert.deepEqual(output, reference)
    }
    for (const step of output.program?.steps ?? []) {
      assert.notEqual(step.kind, 'vision')
      assert.notEqual(step.action?.type, 'captureImage')
    }
    assert.notEqual(output.taskDecision?.requiredCompletionBasis, 'visual_observation')
    if (source.suite.startsWith('vision-continuation-')) assert.deepEqual(output, { delegatePlanning: true })
  }
  assert.ok(delegated > 500 && nonvisual > 500)
})


test('planner boundaries distinguish excluded sensing, requested mixed sensing and quoted discussion', async () => {
  const selected = [...DEVELOPMENT_CASES, ...EVALUATION_CASES].filter(source => source.suite.startsWith('planner-boundary-'))
  const rows = await buildDevelopmentRecords(selected)
  assert.deepEqual(validateDevelopmentRecords(rows, selected), [])
  const fit = new Set(rows.filter(row => row.metadata.sourceSplit === 'development').map(row => row.user))
  for (const row of rows) {
    const i = row.metadata.instructionIndex, output = JSON.parse(row.output)
    const visual = i === 5 || i === 6
    if (row.metadata.specialist === 'intent') {
      assert.equal(output.taskPlanner, visual ? 'vision' : 'specialist')
      assert.equal(output.needsAction, i < 7)
      if (i >= 4) assert.equal(output.needsResponse, true)
    } else if (visual) assert.deepEqual(output, { delegatePlanning: true })
    else if (i === 7 || i === 8) assert.deepEqual(output, { taskDecision: null, program: null })
    else {
      assert.equal(output.delegatePlanning, undefined)
      assert.equal(output.program.steps.length, i === 4 ? 2 : 1)
    }
    if (row.metadata.sourceSplit === 'evaluation') assert.ok(!fit.has(row.user))
    const peers = rows.filter(peer => peer.metadata.suite === row.metadata.suite)
    assert.equal(new Set(peers.map(peer => peer.metadata.developmentFold)).size, 1)
  }
})
