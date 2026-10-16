import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { environmentActionParserNode } from '@metahuman/core/nodes'
import { loadPriorEvaluationEvidence, sha256 } from './corpus.js'
import { ROUTE_FIELDS } from './development-cases.js'
import { DEVELOPMENT_CASES, EVALUATION_CASES, REGRESSION_CASES, buildDevelopmentRecords, loadGraphProperties, validateDevelopmentRecords } from './generate-training-data.js'

const recordsPromise = buildDevelopmentRecords()
function plannerReference(row: Awaited<ReturnType<typeof buildDevelopmentRecords>>[number]) {
  if (row.plannerReferenceOutput) assert.deepEqual(JSON.parse(row.output), { delegatePlanning: true })
  return JSON.parse(row.plannerReferenceOutput ?? row.output)
}

test('vision continuation selects returned coordinates for the unchanged objective with source and stage siblings in one fold', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('vision-continuation-'))
  const taskRows = rows.filter(row => row.metadata.specialist === 'task')
  assert.equal(taskRows.length, 336)
  for (const row of taskRows) {
    const input = JSON.parse(row.user)
    const output = plannerReference(row)
    assert.equal(input.inputSource, row.metadata.inputSource)
    if (input.inputSource === 'autonomy') assert.equal(input.plannerDecision.instruction, input.currentInstruction)
    if (row.metadata.suite.includes('-locate-only-')) {
      assert.equal(output.program, null)
      continue
    }
    const step = output.program.steps[0]
    assert.equal(output.program.steps.length, 1)
    assert.equal(step.kind, 'vision')
    assert.notEqual(output.taskDecision.outcome, 'complete')
    const acquired = row.metadata.suite.includes('-acquired-')
    assert.equal(step.operation, acquired ? 'select' : 'acquire')
    const peers = taskRows.filter(other => JSON.parse(other.user).currentInstruction === input.currentInstruction)
    assert.equal(new Set(peers.map(peer => peer.metadata.developmentFold)).size, 1)
    assert.deepEqual([...new Set(peers.map(peer => peer.metadata.inputSource))].sort(), ['autonomy', 'user'])
    assert.equal(new Set(peers.map(peer => plannerReference(peer).program.steps[0].operation)).size, 2)
    if (acquired) {
      assert.equal(step.frameId, input.taskResultEvidence.acquisition.frame.id)
      assert.deepEqual(step.box, input.taskResultEvidence.acquisition.candidates[0].box)
      assert.equal(step.description, input.taskResultEvidence.acquisition.candidates[0].description)
    } else assert.equal(input.taskResultEvidence, undefined)
  }
  const heldout = await buildDevelopmentRecords(EVALUATION_CASES.filter(source => source.suite.startsWith('vision-continuation-')))
  const fitInputs = new Set(rows.map(row => row.user))
  assert.ok(heldout.length > 0)
  for (const row of heldout) assert.ok(!fitInputs.has(row.user))
})
test('reused settings retain development-only selection while validating the current corpus', async () => {
  const { main } = await import('./train.js')
  const outputRoot = resolve('out/environment-action-selector/training')
  await mkdir(outputRoot, { recursive: true })
  const root = await mkdtemp(resolve(outputRoot, 'settings-test-'))
  try {
    const config = { ...JSON.parse(await readFile(resolve('brain/training/environment-action-selector/training-qwen3.5-0.8b.json'), 'utf8')),
      specialist: 'task', num_train_epochs: 1, save_total_limit: 1 }
    const report = { owner: 'environment-action-selector', specialist: 'task', split: 'development-cross-validation',
      priorHeldOutUsed: false, checkpointPolicy: 'epoch-1' }
    const reportPath = resolve(root, 'selection.json')
    const provenance = { owner: config.owner, mode: 'final-development-training', specialist: 'task', baseModel: config.base_model,
      epochs: 1, archivedDatasetDigest: 'earlier-development-dataset', priorHeldOutUsed: false,
      selectionEvidence: { path: reportPath, digest: sha256(report) } }
    await Promise.all([
      writeFile(resolve(root, 'training-config.json'), JSON.stringify(config)),
      writeFile(resolve(root, 'run-provenance.json'), JSON.stringify(provenance)),
      writeFile(reportPath, JSON.stringify(report)),
    ])
    const args = ['--specialist', 'task', '--reuse-settings-from', root, '--output', resolve(root, 'new-fit'), '--dry-run']
    await main(args)
    await assert.rejects(access(resolve(root, 'new-fit')), { code: 'ENOENT' })
    await assert.rejects(main([...args, '--fold', '0']), /cannot be combined/)
    await assert.rejects(main([...args, '--specialist', 'intent']), /matching development-selected/)
    const heldOutReport = { ...report, split: 'evaluation' }
    await writeFile(reportPath, JSON.stringify(heldOutReport))
    await writeFile(resolve(root, 'run-provenance.json'), JSON.stringify({ ...provenance,
      selectionEvidence: { path: reportPath, digest: sha256(heldOutReport) } }))
    await assert.rejects(main(args), /does not match its development report/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('contrast families pair discussion with execution under the same selected context', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('contrast-language-')
    && row.metadata.contextVariation === 'clean')
  assert.ok(rows.length > 0)
  for (const id of new Set(rows.map(row => row.metadata.sourceCaseId))) {
    const family = rows.filter(row => row.metadata.sourceCaseId === id)
    assert.ok(family.some(row => JSON.parse(row.output).program === null))
    assert.ok(family.some(row => JSON.parse(row.output).program?.steps.length > 0))
    const contexts = family.map(row => {
      const envelope = JSON.parse(row.user)
      delete envelope.currentInstruction
      if (envelope.plannerDecision) delete envelope.plannerDecision.instruction
      return envelope
    })
    for (const context of contexts) assert.deepEqual(context, contexts[0])
  }
})

test('retired cycle sequence contrasts preserve requests for planning and capture-only visual targets', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('contrast-sequence-')
    && row.metadata.contextVariation === 'clean')
  assert.ok(rows.length > 0)
  for (const id of new Set(rows.map(row => row.metadata.sourceCaseId))) {
    const family = rows.filter(row => row.metadata.sourceCaseId === id)
    const outputs = family.map(row => plannerReference(row))
    for (const index of [0, 2, 3]) assert.deepEqual(outputs[index], { delegatePlanning: true })
    for (const index of [2, 3]) {
      const instruction = JSON.parse(family[index]!.user).currentInstruction
      assert.match(instruction, /latch|indicator|handle/)
      assert.match(instruction, /photograph|new view/)
      assert.match(instruction, /one cycle/)
    }
    const capture = outputs[1]!
    assert.equal(capture.program.steps.length, 1)
    assert.equal(capture.program.steps[0].action.type, 'captureImage')
    assert.equal(capture.taskDecision.continuationPolicy, 'bounded')
    assert.equal(capture.taskDecision.requiredCompletionBasis, 'visual_observation')
    assert.notEqual(capture.taskDecision.completionCriteria, 'The selected program receives correlated completion results.')
    assert.match(capture.taskDecision.objective, /latch|indicator|handle/)
  }
})

test('conditional contrasts include both sides and equality without leaking branches across folds', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('contrast-condition-')
    && row.metadata.contextVariation === 'clean')
  assert.ok(rows.length > 0)
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const instruction = JSON.parse(row.user).currentInstruction
    groups.set(instruction, [...(groups.get(instruction) ?? []), row])
  }
  for (const [instruction, group] of groups) {
    const thresholdMatch = instruction.match(/(?:below|less than) (\d+\.\d+)/)
    if (!thresholdMatch) continue
    const threshold = Number(thresholdMatch[1])
    const voltages = group.map(row => JSON.parse(row.user).robotStatus.body.battery.voltage)
    assert.ok(voltages.some(value => value < threshold))
    assert.ok(voltages.some(value => value === threshold))
    assert.ok(voltages.some(value => value > threshold))
    assert.equal(new Set(group.map(row => row.metadata.developmentFold)).size, 1)
    assert.ok(group.every(row => (JSON.parse(row.output).program?.steps.length ?? 0) <= 1), 'Exclusive branches are not a sequence')
    assert.ok(new Set(group.map(row => row.output)).size > 1, 'Changing relevant evidence changes the selected branch')
  }
  assert.ok(rows.some(row => JSON.parse(row.output).program === null))
  assert.ok(rows.some(row => JSON.parse(row.output).program?.steps.length === 2), 'An unconditional sequence stays a sequence')
})

test('fresh contrast evaluation requests stay outside the fit and source variants share a fold', async () => {
  const development = (await recordsPromise).filter(row => row.metadata.suite.startsWith('contrast-'))
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES.filter(source => source.suite.startsWith('contrast-eval-')))
  assert.ok(evaluation.length > 0)
  const fitting = new Set((await recordsPromise).filter(row => row.metadata.specialist === 'task').map(row => JSON.parse(row.user).currentInstruction))
  for (const row of evaluation) assert.ok(!fitting.has(JSON.parse(row.user).currentInstruction))
  for (const row of development) {
    const peer = development.find(other => other.metadata.inputSource !== row.metadata.inputSource
      && other.metadata.suite === row.metadata.suite && other.metadata.instructionIndex === row.metadata.instructionIndex
      && other.metadata.contextVariation === row.metadata.contextVariation
      && JSON.parse(other.user).currentInstruction === JSON.parse(row.user).currentInstruction
      && JSON.stringify(JSON.parse(other.user).robotStatus) === JSON.stringify(JSON.parse(row.user).robotStatus))
    assert.ok(peer)
    assert.equal(peer.metadata.developmentFold, row.metadata.developmentFold)
    assert.equal(peer.output, row.output)
  }
})

test('goal training preserves source attribution using the existing user and autonomy contracts', async () => {
  const rows = (await recordsPromise).filter(record => record.metadata.suite.startsWith('goal-'))
  assert.ok(rows.length > 0)
  assert.deepEqual([...new Set(rows.map(row => row.metadata.developmentFold))].sort(), [0, 1, 2, 3])
  const autonomy = await loadGraphProperties('autonomy')
  const user = await loadGraphProperties()
  for (const row of rows) {
    const envelope = JSON.parse(row.user)
    const internal = row.metadata.inputSource === 'autonomy'
    assert.equal(envelope.inputSource, internal ? 'autonomy' : 'user')
    const prompt = (internal ? autonomy : user)['3'].systemPrompt.trim()
    assert.ok(row.system.startsWith(prompt))
    if (internal) {
      assert.equal(envelope.plannerDecision.instruction, envelope.currentInstruction)
      assert.equal(envelope.plannerDecision.decidedAt, '2030-01-15T12:00:00.000Z')
    } else assert.equal(envelope.plannerDecision, undefined)
    const counterpart = rows.find(other => other.metadata.inputSource !== row.metadata.inputSource
      && other.metadata.contextVariation === row.metadata.contextVariation
      && JSON.parse(other.user).currentInstruction === envelope.currentInstruction)
    assert.ok(counterpart, 'Each intention has a user and autonomous-source example')
    assert.equal(counterpart.metadata.developmentFold, row.metadata.developmentFold,
      'Source variants of the same intention must not leak across folds')
    assert.equal(counterpart.output, row.output)
  }
})

test('goal examples distinguish compound commands, visual success and reported state', async () => {
  const rows = (await recordsPromise).filter(record => record.metadata.suite.startsWith('goal-')
    && record.metadata.contextVariation === 'clean')
  assert.ok(rows.length > 0)
  const outputs = rows.map(row => plannerReference(row))
  for (const basis of ['action_result', 'visual_observation', 'environment_state']) {
    assert.ok(outputs.some(output => output.taskDecision?.requiredCompletionBasis === basis), basis)
  }
  assert.ok(outputs.some(output => output.program?.steps.length > 1
    && output.program.steps.some((step: any) => step.action?.type === 'captureImage')
    && output.program.steps.some((step: any) => step.action?.type === 'robotCommand')))
  assert.ok(outputs.some(output => output.program?.steps.length === 1
    && output.program.steps[0].action?.type === 'captureImage'
    && output.taskDecision.requiredCompletionBasis === 'visual_observation'))
  assert.ok(outputs.some(output => output.program === null && output.taskDecision === null))
  for (const output of outputs) if (output.taskDecision) {
    assert.notEqual(output.taskDecision.completionCriteria, 'The selected program receives correlated completion results.')
  }
})

test('compound goal regression inputs stay out of fitting and are scored separately', async () => {
  const regression = await buildDevelopmentRecords(REGRESSION_CASES.filter(source => source.suite === 'goal-live-regression'))
  assert.ok(regression.length > 0)
  const fitted = new Set((await recordsPromise).filter(row => row.metadata.specialist === 'task')
    .map(row => JSON.parse(row.user).currentInstruction))
  for (const row of regression) {
    assert.equal(row.metadata.sourceSplit, 'regression')
    assert.ok(!fitted.has(JSON.parse(row.user).currentInstruction))
    assert.equal(plannerReference(row).taskDecision.requiredCompletionBasis, 'visual_observation')
  }
})

test('ordinary action requests prefer a response while preserving task evidence and explicit silence', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.specialist === 'intent')
  for (const message of ['Please bow.', 'Take a new picture.', 'Stand upright.', 'Could you give us a wave now?']) {
    const choices = records.filter(record => record.user === `Current user message: ${message}`)
    assert.equal(choices.length, 1, message)
    const reply = JSON.parse(choices[0]!.output)
    const source = DEVELOPMENT_CASES.find(item => item.id === choices[0]!.metadata.sourceCaseId)!
    assert.equal(reply.needsResponse, true)
    assert.equal(reply.needsAction, true)
    assert.equal(reply.needsToolUse, false)
    assert.deepEqual(reply.taskContext, source.expected.taskContext)
    assert.deepEqual(reply.conversationContext, ['persona.personality'])
    assert.ok(!reply.taskContext.some((entry: string) => entry.startsWith('persona.')))
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
  assert.equal(optional.length, 164)
  assert.ok(optional.every(record => JSON.parse(record.output).needsResponse === true))
  assert.equal(new Set(optional.map(record => record.user)).size, optional.length)
})

test('tool routing separates computer work from local language, memory, status, and body actions', async () => {
  const records = (await recordsPromise).filter(record => record.metadata.specialist === 'intent')
  for (const [message, tool, action] of [
    ['Make a PDF checklist and save it in the project folder.', true, false],
    ['Make up a short bedtime story.', false, false],
    ['Make a bowing gesture.', false, true],
    ["Look up my cat's name in your memories.", false, false],
    ['Find the calibration spreadsheet on this computer.', true, false],
    ['Wave to me and find the telescope manual online.', true, true],
    ['Can you look up something?', false, false],
  ] as const) {
    const record = records.find(record => record.user === `Current user message: ${message}`)!
    const output = JSON.parse(record.output)
    assert.equal(output.needsToolUse, tool, message)
    assert.equal(output.needsAction, action, message)
    assert.equal(output.needsResponse, true, message)
  }
  assert.ok(records.every(record => typeof JSON.parse(record.output).needsToolUse === 'boolean'))
  const corpusTools = records.filter(record => JSON.parse(record.output).needsToolUse)
  assert.equal(corpusTools.length, 88)
  const memory = records.find(record => record.user.startsWith('Current user message: Retrieve our saved workshop'))!
  assert.deepEqual(JSON.parse(memory.output).taskContext, ['memory'])
  assert.deepEqual(JSON.parse(memory.output).conversationContext, ['persona.personality'])
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
      observation: { state: envelope.currentEnvironment.state, capabilities: { actions: envelope.currentEnvironment.capabilities.actions,
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
      assert.ok(record.user.startsWith(record.metadata.inputSource === 'autonomy'
        ? 'Internal planner intention: ' : 'Current user message: '))
      assert.ok(!record.user.includes('currentEnvironment'))
      assert.ok(ROUTE_FIELDS.every(key => key === 'taskContext' || key === 'conversationContext'
        ? Array.isArray(JSON.parse(record.output)[key]) : key === 'taskPlanner'
          ? ['specialist', 'vision'].includes(JSON.parse(record.output)[key])
          : typeof JSON.parse(record.output)[key] === 'boolean'))
    } else {
      assert.ok(!('response' in JSON.parse(record.output)))
      assert.equal(JSON.parse(record.user).inputSource, record.metadata.inputSource ?? 'user')
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
  const intent = (records: typeof development) => records.filter(record => record.metadata.specialist === 'intent'
    && !record.metadata.suite.startsWith('speech-program-') && !record.metadata.suite.startsWith('planner-boundary-'))
  assert.equal(intent(development).length, 1280)
  assert.equal(new Set(intent(development).map(record => record.user)).size, 1280)
  assert.equal(intent(evaluation).length, 253)
  assert.equal(intent(regression).length, 46)
  const liveVisionFailure = intent(regression).find(record => record.user === 'Current user message: What can you see in front of you right now?')!
  assert.ok(liveVisionFailure)
  assert.ok(JSON.parse(liveVisionFailure.output).conversationContext.includes('vision'))
  assert.ok(!intent(development).some(record => record.user === liveVisionFailure.user))
  const seen = new Set([...development, ...regression].map(record => record.user))
  assert.ok(intent(evaluation).every(record => !seen.has(record.user)))
  const silence = intent(evaluation).filter(record => record.metadata.suite === 'tools-heldout-explicit-silence')
  assert.equal(silence.length, 4)
  assert.ok(silence.every(record => JSON.parse(record.output).needsResponse === false && !record.metadata.responseOptional))
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
    if (Array.isArray(envelope.currentEnvironment.state.recognition?.visionOperations)) {
      assert.ok(envelope.selectedRoutes.needsEnvironment)
      assert.ok(Array.isArray(envelope.currentEnvironment.state.recognition.visionOperations))
    } else assert.equal(envelope.currentEnvironment.state.batteryPercent, undefined)
    if (JSON.parse(record.output).program?.steps.some((step: any) => step.action?.type === 'robotCommand')) {
      assert.ok(Object.keys(envelope.currentEnvironment.capabilities.robotCommandCatalog).length > 0)
    }
    if (record.metadata.suite === 'expanded-status-condition') assert.equal(typeof envelope.robotStatus.body.battery.voltage, 'number')
  }
})

test('refinement families preserve exact returned regions and acquisition evidence', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('refinement-')
    && row.metadata.specialist === 'task')
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const input = JSON.parse(row.user), output = plannerReference(row)
    const evidence = input.taskResultEvidence?.acquisition
    for (const step of output.program?.steps ?? []) {
      if (step.kind !== 'vision') continue
      assert.notEqual(output.taskDecision.outcome, 'complete')
      assert.equal(output.taskDecision.requiredCompletionBasis, 'environment_state')
      if (step.operation === 'select') {
        assert.equal(step.frameId, evidence.frame.id)
        assert.ok(evidence.candidates.some((candidate: any) => JSON.stringify(candidate.box) === JSON.stringify(step.box)
          && candidate.description === step.description))
      }
      if (step.operation === 'acquire') assert.ok(input.currentInstruction.includes(step.target))
    }
    if (output.taskDecision?.outcome === 'request_user') {
      assert.equal(evidence.outcome, 'ambiguous')
      assert.equal(output.program, null)
    }
  }
  for (let index = 0; index < 4; index++) {
    const siblings = rows.filter(row => [`refinement-exact-selection-${index}`, `refinement-qualified-acquisition-${index}`].includes(row.metadata.suite))
    assert.equal(new Set(siblings.map(row => row.metadata.developmentFold)).size, 1)
  }
})

test('refinement comparisons distinguish strict thresholds and retain source attribution', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.suite.startsWith('refinement-exclusive-'))
  const groupFolds = new Map<string, Set<number>>()
  for (const row of rows) {
    const input = JSON.parse(row.user), output = JSON.parse(row.output)
    const voltage = input.robotStatus.body.battery.voltage
    assert.equal(typeof voltage, 'number')
    const request = input.currentInstruction
    const threshold = Number(request.match(/(?:less than|at least|greater than) ([\d.]+) volts/)[1])
    const commands = input.currentEnvironment.capabilities.robotCommandCatalog
    const steps = output.program?.steps ?? []
    assert.ok(steps.length <= 1, 'An exclusive branch is not a sequence')
    const description = steps.length ? commands[steps[0].action.command] : null
    const logicalCommand = request.startsWith('Only') ? request.match(/perform (\w+) when/)[1]
      : voltage < threshold ? (request.match(/choose (\w+);/)?.[1] ?? request.match(/perform (\w+) otherwise/)[1])
        : (request.match(/otherwise choose (\w+)/)?.[1] ?? request.match(/Perform (\w+) when/)[1])
    if (request.startsWith('Only') && voltage <= threshold) assert.equal(steps.length, 0)
    else {
      assert.equal(steps.length, 1)
      const meanings: Record<string, RegExp> = { nod: /nod/i, sit: /seat/i, wave: /wave/i }
      assert.match(description, meanings[logicalCommand]!)
    }
    const folds = groupFolds.get(String(threshold)) ?? new Set<number>()
    folds.add(row.metadata.developmentFold); groupFolds.set(String(threshold), folds)
    if (row.metadata.inputSource === 'autonomy') assert.equal(input.plannerDecision.instruction, request)
  }
  assert.equal(groupFolds.size, 3)
  for (const folds of groupFolds.values()) assert.equal(folds.size, 1)
})

test('posture training covers real body meanings, prior activity, and long observations without fitting the reported failures', async () => {
  const records = await recordsPromise
  const posture = records.filter(record => record.metadata.suite.startsWith('body-posture-') && record.metadata.specialist === 'task')
  for (const command of ['rest', 'lay_down']) {
    const clean = posture.find(record => record.metadata.contextVariation === 'clean'
      && JSON.parse(record.output).program.steps[0].action.command === command)!
    assert.ok(JSON.parse(clean.user).currentEnvironment.capabilities.robotCommandCatalog[command])
  }
  const long = posture.filter(record => record.metadata.suite === 'body-posture-observation-history')
  assert.equal(long.length, 48)
  assert.ok(long.some(record => JSON.parse(record.user).observationHistory.length === 8))
  for (const message of ['Please lie down.', 'Please rest.', 'I would like you to do the rest position.']) {
    assert.ok(!records.some(record => record.metadata.specialist === 'task' && JSON.parse(record.user).currentInstruction === message))
  }
  const folds = new Map<string, number>()
  for (const record of posture) {
    if (record.metadata.contextVariation !== 'clean') continue
    const command = JSON.parse(record.output).program.steps[0].action.command
    if (folds.has(command)) assert.equal(record.metadata.developmentFold, folds.get(command))
    else folds.set(command, record.metadata.developmentFold)
  }
})

test('vision training separates stationary sensing, explanation, status, and explicit silence', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.specialist === 'intent' && row.metadata.suite.startsWith('vision-tracking-'))
  assert.equal(rows.length, 36)
  for (const row of rows) {
    const output = JSON.parse(row.output)
    const explanatory = ['vision-tracking-description-only', 'vision-tracking-status-only', 'vision-tracking-discussion-only'].includes(row.metadata.suite)
    assert.equal(output.needsAction, !explanatory)
    assert.equal(output.needsToolUse, false, 'Local sensing does not request computer-tool delegation')
    assert.equal(output.needsResponse, row.metadata.suite !== 'vision-tracking-silence')
    if (!explanatory) assert.ok(output.taskContext.includes('environment'))
    if (row.metadata.suite === 'vision-tracking-description-only') assert.ok(output.conversationContext.includes('vision'))
    if (row.metadata.suite === 'vision-tracking-status-only') assert.ok(output.conversationContext.includes('executionContext'))
  }
})

test('held-out vision routes use the same evidence requirements as development operations', async () => {
  const rows = await buildDevelopmentRecords(EVALUATION_CASES.filter(source => source.specialist === 'intent'
    && source.suite === 'vision-tracking-heldout-stationary'))
  assert.equal(rows.length, 3)
  const development = (await recordsPromise).filter(row => row.metadata.specialist === 'intent')
  for (const [index, suite] of ['stationary-acquisition', 'category-search', 'release'].entries()) {
    const expected = JSON.parse(development.find(row => row.metadata.suite === `vision-tracking-${suite}`)!.output)
    const heldout = JSON.parse(rows.find(row => row.metadata.instructionIndex === index)!.output)
    assert.deepEqual(heldout.taskContext, expected.taskContext)
    assert.equal(heldout.needsAction, true)
    assert.equal(heldout.needsResponse, true)
    assert.equal(heldout.needsToolUse, false)
    assert.deepEqual(heldout.conversationContext, ['environment', 'robotStatus'])
  }
})

test('vision program targets preserve retained source evidence and advertised operations in every catalog variation', async () => {
  const rows = (await recordsPromise).filter(row => row.metadata.specialist === 'task' && row.metadata.suite.startsWith('vision-tracking-'))
  const operations = new Set<string>()
  for (const row of rows) {
    const envelope = JSON.parse(row.user)
    const output = plannerReference(row)
    const advertised = envelope.currentEnvironment.state.recognition.visionOperations
    for (const step of output.program?.steps ?? []) {
      assert.ok(['vision', 'behavior'].includes(step.kind), 'Stationary requests must not acquire a body-motion command')
      assert.notEqual(output.taskDecision.outcome, 'complete', 'Configuration or candidate acquisition is not objective completion')
      if (step.kind === 'behavior') {
        assert.equal(step.motion, null)
        assert.equal(step.steering, null)
        assert.equal(step.identifyEveryFrames, 1, 'These requests explicitly select every new frame')
        continue
      }
      operations.add(step.operation)
      assert.ok(JSON.stringify(row.jsonSchema).includes(`"const":"${step.operation}"`))
      if (step.operation !== 'acquire') assert.ok(advertised.includes(step.operation))
      const acquisition = envelope.taskResultEvidence?.acquisition
      if (step.operation === 'select') {
        assert.equal(step.frameId, acquisition.frame.id)
        assert.ok(acquisition.candidates.some((candidate: any) => candidate.description === step.description
          && JSON.stringify(candidate.box) === JSON.stringify(step.box)))
        assert.ok(step.box.x + step.box.width <= 1 && step.box.y + step.box.height <= 1)
      }
      if (step.referenceFrameId) assert.equal(step.referenceFrameId, acquisition.frame.id)
      if (step.operation === 'acquire') assert.equal(output.program.steps.length, 1,
        'Unknown boxes cannot be selected before acquisition returns')
    }
    if (['vision-tracking-ambiguous-identity', 'vision-tracking-not-found'].includes(row.metadata.suite)) {
      assert.equal(output.program, null)
      assert.equal(output.taskDecision.outcome, 'request_user')
      assert.notEqual(envelope.taskResultEvidence.acquisition.outcome, 'found')
    }
    if (row.metadata.suite === 'vision-tracking-unsupported-search') {
      assert.deepEqual(advertised, [])
      assert.equal(output.program, null)
      assert.ok(!JSON.stringify(row.jsonSchema).includes('"const":"search"'))
    }
  }
  assert.deepEqual([...operations].sort(), ['acquire', 'release', 'search', 'select'])
})

test('vision evaluation stays outside fitting and the observed chair failure remains a regression', async () => {
  const { LIVE_TRACKING_REGRESSION } = await import('./vision-cases.js')
  const development = await recordsPromise
  const evaluation = await buildDevelopmentRecords(EVALUATION_CASES.filter(source => source.suite.startsWith('vision-tracking-')))
  const regression = await buildDevelopmentRecords(REGRESSION_CASES.filter(source => source.suite === 'vision-tracking-live-regression'))
  const message = (row: typeof development[number]) => row.metadata.specialist === 'task'
    ? JSON.parse(row.user).currentInstruction : row.user.slice('Current user message: '.length)
  const fit = new Set(development.map(message))
  for (const row of [...evaluation, ...regression]) assert.ok(!fit.has(message(row)), row.metadata.recordId)
  assert.equal(regression.length, 4)
  assert.ok(regression.every(row => message(row) === LIVE_TRACKING_REGRESSION))
  for (const specialist of ['intent', 'task']) {
    const rows = development.filter(row => row.metadata.specialist === specialist && row.metadata.suite.startsWith('vision-tracking-'))
    assert.deepEqual([...new Set(rows.map(row => row.metadata.developmentFold))].sort(), [0, 1, 2, 3])
    for (const id of new Set(rows.map(row => row.metadata.sourceCaseId))) {
      assert.equal(new Set(rows.filter(row => row.metadata.sourceCaseId === id).map(row => row.metadata.developmentFold)).size, 1)
    }
  }
})
