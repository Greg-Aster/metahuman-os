import assert from 'node:assert/strict'
import test from 'node:test'
import type { EnvironmentObservation } from '../../environment-interface/index.js'
import { environmentActionParserNode } from './action-parser.node.js'
import { buildEnvironmentSelectorJsonSchema, validateEnvironmentSelectorOutput } from './helpers.js'

const observation: EnvironmentObservation = {
  environmentId: 'fixture', adapter: 'fixture', sessionId: 'robot-1', timestamp: new Date().toISOString(),
  capabilities: { actions: ['robotCommand', 'robotMotionPlan', 'captureImage', 'move'],
    robotCommands: ['stand', 'wave', '#1'], visual: true, movement: true },
}
const taskDecision = { objective: 'Perform the requested expression.', completionCriteria: 'All requested motions completed.',
  outcome: 'act', reason: 'Execute the requested expression.', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' }
const action = (command: string) => ({ kind: 'action', action: { type: 'robotCommand', command } })
const parse = (choice: unknown, current = observation) => environmentActionParserNode.execute({
  response: JSON.stringify(choice), observation: current, sessionId: current.sessionId,
}, {}, {})

test('one model-owned outcome defines completion independently of conversational responses', async () => {
  const choice = { response: 'We can begin.', program: null,
    taskDecision: { ...taskDecision, outcome: 'continue', requiredCompletionBasis: 'user_input' } }
  assert.equal(validateEnvironmentSelectorOutput(JSON.stringify(choice)).value?.taskDecision?.objectiveComplete, false)
  assert.equal(validateEnvironmentSelectorOutput(JSON.stringify({ ...choice,
    taskDecision: { ...choice.taskDecision, outcome: 'complete' } })).value?.taskDecision?.objectiveComplete, true)
  assert.equal(validateEnvironmentSelectorOutput(JSON.stringify({ ...choice,
    taskDecision: { ...choice.taskDecision, objectiveComplete: false } })).valid, false)
  assert.equal(JSON.stringify(buildEnvironmentSelectorJsonSchema()).includes('objectiveComplete'), false)
})

test('ordered advertised actions preserve commands and require a whole-task decision', async () => {
  const result = await parse({ response: '', program: { steps: [action('stand'), action('wave'), action('#1')] }, taskDecision })
  assert.equal(result.valid, true)
  assert.deepEqual(result.program.steps.map((step: any) => step.action.command), ['stand', 'wave', '#1'])
  assert.equal(result.actionAdmission.admitted, true)
  assert.equal(result.taskDecision.objectiveComplete, false)
  await assert.rejects(parse({ response: '', program: { steps: [action('stand')] }, taskDecision: null }), /requires its objective decision/)
  await assert.rejects(parse({ response: '', program: { steps: [action('stand')] },
    taskDecision: { ...taskDecision, outcome: 'complete' } }), /before its results/)
})

test('conversation has no physical program; obsolete and empty outputs are rejected', async () => {
  const result = await parse({ response: 'Hello.', program: null, taskDecision: null })
  assert.equal(result.program, null)
  assert.equal(result.response, 'Hello.')
  assert.equal(result.error, '')
  await assert.rejects(parse({ response: '', program: null, taskDecision: null }), /requires response/)
  await assert.rejects(parse({ response: 'Hello.', actions: [], movementRequest: null, taskDecision: null }), /program|not supported/)
  await assert.rejects(environmentActionParserNode.execute({ response: 'status=complete' }, {}, {}), /strict JSON/)
})

test('generated motion and preset actions share one program without dropping gesture detail', async () => {
  const description = 'Extend the left front leg in two deliberate pulses, then return it.'
  const result = await parse({ response: '', program: { steps: [action('stand'), { kind: 'generatedMotion', description }, action('wave')] },
    taskDecision: { ...taskDecision, motionClass: 'body_local', actionPurpose: 'expression' } })
  assert.equal(result.valid, true)
  assert.deepEqual(result.program.steps[1], { kind: 'generatedMotion', description })
  assert.equal(result.taskDecision.actionPurpose, 'expression')
  const unavailable = await parse({ response: '', program: { steps: [{ kind: 'generatedMotion', description }] }, taskDecision },
    { ...observation, capabilities: { ...observation.capabilities, actions: ['robotCommand'] } })
  assert.equal(unavailable.program, null)
  assert.match(unavailable.error, /does not advertise robotMotionPlan/)
})

test('existing capability admission rejects an unavailable command without dispatch or invented speech', async () => {
  const result = await parse({ response: 'I will perform it.', program: { steps: [action('missing')] }, taskDecision })
  assert.equal(result.program, null)
  assert.equal(result.response, '')
  assert.equal(result.actionAdmission.reason, 'robot_command_unavailable')
  await assert.rejects(parse({ response: '', program: { steps: [action('stand')] },
    taskDecision: { ...taskDecision, objective: '' } }), /objective/)
})

test('capture preserves evidence semantics and rejects malformed action fields', async () => {
  const choice = { response: '', program: { steps: [{ kind: 'action', action: { type: 'captureImage' } }] },
    taskDecision: { ...taskDecision, requiredCompletionBasis: 'visual_observation', actionPurpose: 'information_gain' } }
  const result = await parse(choice)
  assert.equal(result.program.steps[0].action.type, 'captureImage')
  assert.equal(result.taskDecision.requiredCompletionBasis, 'visual_observation')
  await assert.rejects(parse({ ...choice, program: { steps: [{ kind: 'action', action: { type: 'captureImage', command: 'stand' } }] } }), /invalid.*action|typed.*action/i)
})

test('generic ongoing behavior keeps phase criteria separate from the entire objective', async () => {
  const behavior = { kind: 'behavior', target: 'the object described by the owner', completionCriteria: 'Identify that object.',
    motion: { type: 'move', direction: 'forward', continuous: true, durationMs: 0, speed: 60, forward: 75, turn: 25 },
    candidateLabels: [], identifyEveryFrames: 10, steering: null }
  const result = await parse({ response: '', program: { steps: [behavior, action('wave')] },
    taskDecision: { ...taskDecision, objective: 'Find the described object and wave to it.' } })
  assert.equal(result.valid, true)
  assert.equal(result.program.steps[0].completionCriteria, behavior.completionCriteria)
  assert.equal(result.program.steps[0].motion.turn, 25)
  assert.equal(result.program.steps[1].action.command, 'wave')
  await assert.rejects(parse({ response: '', program: { steps: [behavior] },
    taskDecision: { ...taskDecision, escalation: { target: 'general' } } }), /escalation/)
})

test('V2 named gait composition survives the provider schema and parser', async () => {
  const schema = buildEnvironmentSelectorJsonSchema({ actions: ['robotCommand'], robotCommands: ['crawl', 'crab_right', 'run'] })
  const encoded = JSON.stringify(schema)
  assert.ok(encoded.includes('"forward":{"type":"number","minimum":-100,"maximum":100}'))
  assert.ok(encoded.includes('"turn":{"type":"number","minimum":-100,"maximum":100}'))
  for (const fields of [{ speed: 150, forward: 80, turn: -25 }, { stride: 85, rate: 1.5 }, { speed: 0 }]) {
    const gait = { type: 'robotCommand', command: 'run', continuous: true, ...fields }
    const result = await parse({ response: '', program: { steps: [{ kind: 'action', action: gait }] }, taskDecision },
      { ...observation, capabilities: { actions: ['robotCommand'], robotCommands: ['run'] } })
    assert.equal(result.valid, true)
    for (const [key, value] of Object.entries(gait)) assert.equal(result.program.steps[0].action[key], value)
  }
})

test('switching robot catalogs retains V1 gestures and exposes V2 commands without V1 joint generation', async () => {
  for (const [commands, actions] of [
    [['#1', '#2', 'walk_slow', 'crab'], ['robotCommand', 'robotMotionPlan']],
    [['turn_left_15', 'turn_right_15', 'crawl', 'crab_right', 'crab_forward', 'crab_backward', 'crab_turn_left', 'crab_turn_right', 'upright'], ['robotCommand']],
    [['#1', '#2', 'walk_slow', 'crab'], ['robotCommand', 'robotMotionPlan']],
  ] as const) {
    const current: EnvironmentObservation = { ...observation, capabilities: { actions: [...actions], robotCommands: [...commands] } }
    const result = await parse({ response: '', program: { steps: commands.map(action) }, taskDecision }, current)
    assert.equal(result.valid, true)
    assert.deepEqual(result.program.steps.map((item: any) => item.action.command), commands)
    const unavailable = await parse({ response: '', program: { steps: [action(commands.some(command => command === '#1') ? 'crawl' : '#1')] }, taskDecision }, current)
    assert.equal(unavailable.actionAdmission.reason, 'robot_command_unavailable')
    const schema = JSON.stringify(buildEnvironmentSelectorJsonSchema({ actions, robotCommands: commands }))
    assert.equal(schema.includes('generatedMotion'), actions.length === 2)
  }
})
