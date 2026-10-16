import { addCase, action, noTask, observation, task, TIME, type CaseSplit } from './development-cases.js'

// Synthetic endpoint requests. The recorded eight-case runtime qualification is
// not included here; no physical movement or calibration is performed by data generation.
function measuredBody(available = true) {
  const body = observation()
  body.capabilities.locomotion = { commands: [], goalKinds: ['distance', 'relativeTurn', 'approach', 'follow', 'visual'], lateral: true }
  body.state = { ...body.state, body: { robotId: 'training-body', authenticated: true, motionAvailable: true },
    activeMovementUpdates: { version: 1, available: true, controls: ['speed', 'stride', 'rate', 'forward', 'lateral', 'turn'] },
    locomotionMeasurement: {
      camera: { available: true, source: 'retained-camera-frame', robotId: 'training-body', referenceId: 'locomotion-camera-A',
        observedAt: TIME, frameId: 'locomotion-camera-frame-A' },
      position: { available, source: 'calibrated-ground-plane', robotId: 'training-body', referenceId: 'locomotion-ground-A',
        observedAt: TIME, xMetres: 0, yMetres: 0, headingDegrees: 0, uncertaintyMetres: available ? .01 : null },
      yaw: { available, source: 'body-imu', robotId: 'training-body', referenceId: 'locomotion-boot-A',
        observedAt: TIME, degrees: 0, uncertaintyDegrees: available ? 1 : null },
    } }
  return body
}
type Variant = { instruction: string; output: Record<string, any> }
let nextFold = 0
function family(suite: string, variants: Variant[], inputs: Record<string, unknown> = {}, split: CaseSplit = 'development', visual = false, evidence?: Record<string, unknown>) {
  const fold = nextFold++ % 4
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', `locomotion-${suite}`, variants.map(v => v.instruction),
      ['needsAction', 'needsEnvironment', ...(inputs.activeExecutions ? ['needsExecutionContext'] : [])], variants[0]!.output,
      { observation: measuredBody(), ...inputs }, split)
    source.targets = Object.fromEntries(variants.map((v, i) => [i, v.output]))
    source.inputSource = inputSource
    source.fold = fold
    if (visual) source.visualTask = true
    source.taskEvidence = evidence
  }
}
const motion = (direction: string, goal: Record<string, unknown>, gait: string, speed: number) => ({
  type: 'move', direction, locomotionGoal: goal, gait, speed, continuous: true,
  ...(gait === 'crab' && (direction === 'left' || direction === 'right') ? { lateral: direction === 'left' ? speed : -speed, forward: 0, turn: 0 } : {}),
})
const endpoint = (objective: string, criteria: string, move: Record<string, unknown>) => task(objective,
  [{ kind: 'action', action: move }], { completionCriteria: criteria, requiredCompletionBasis: 'environment_state', continuationPolicy: 'none' })
function distance(direction: string, metres: number, tolerance: number, gait: string, speed: number, split: CaseSplit) {
  const objective = `Travel ${metres} metres ${direction} using ${gait} at ${speed} percent speed.`
  const output = endpoint(objective, `Attributed position estimates show ${metres} metres ${direction} from the recorded start pose, within ${tolerance} metres. Gait termination alone is not arrival.`,
    motion(direction, { kind: 'distance', direction, metres, tolerance }, gait, speed))
  family(`distance-${gait}-${direction}-${metres}`, [
    { instruction: `Travel ${metres} metres ${direction} using ${gait} at ${speed} percent gait speed, with ${tolerance} metre endpoint tolerance.`, output },
    { instruction: `Use ${gait} to reach a displacement of ${metres} metres ${direction} from this pose. Set speed to ${speed} percent and tolerance to ${tolerance} metres.`, output },
    { instruction: `Explain a ${metres}-metre ${direction} ${gait} goal, but do not execute any movement.`, output: noTask() },
  ], {}, split)
}
for (const direction of ['forward', 'back', 'left', 'right']) {
  distance(direction, .32, .04, direction === 'left' || direction === 'right' ? 'crab' : 'walk', 35, 'development')
  distance(direction, .74, .06, direction === 'left' || direction === 'right' ? 'crab' : 'crawl', 28, 'development')
}
function rotation(degrees: number, tolerance: number, speed: number, split: CaseSplit) {
  const direction = degrees > 0 ? 'left' : 'right'
  const output = endpoint(`Turn ${Math.abs(degrees)} degrees ${direction} from the current orientation.`,
    `Attributed yaw estimates show accumulated relative rotation of ${degrees} degrees within ${tolerance} degrees, using the recorded start orientation and sensor reference.`,
    motion(direction, { kind: 'relativeTurn', degrees, tolerance }, 'walk', speed))
  family(`turn-${degrees}`, [
    { instruction: `Rotate ${direction} through ${Math.abs(degrees)} degrees from this heading, tolerance ${tolerance} degrees, at ${speed} percent speed.`, output },
    { instruction: `Use a relative turn of ${degrees} degrees with angular tolerance ${tolerance} and gait speed ${speed} percent.`, output },
    { instruction: `Quote the words "rotate ${direction} ${Math.abs(degrees)} degrees" without carrying them out.`, output: noTask() },
  ], {}, split)
}
for (const degrees of [25, -25, 70, -70, 140, -140]) rotation(degrees, 4, 32, 'development')

const unavailable = (objective: string, criteria: string, reason: string) => ({ taskDecision: {
  objective, completionCriteria: criteria, outcome: 'report', reason, continuationPolicy: 'none', requiredCompletionBasis: 'environment_state',
}, program: null })
family('missing-measurement', [
  { instruction: 'Travel forward 0.9 metres only if calibrated displacement is available; otherwise report the missing measurement.',
    output: unavailable('Travel forward 0.9 metres.', 'Attributed position estimates establish the selected displacement.', 'The supplied position measurement is unavailable.') },
  { instruction: 'If yaw measurement is unavailable, report it; otherwise turn right 60 degrees within 4 degrees at 30 percent speed.',
    output: unavailable('Turn right 60 degrees.', 'Attributed yaw estimates establish the requested relative turn.', 'The supplied yaw measurement is unavailable.') },
  { instruction: 'Can gait cycle count prove how many metres were travelled? Explain, without starting a gait.', output: noTask() },
], { observation: measuredBody(false) })
family('unspecified-endpoint', [
  { instruction: 'Begin walking, but first ask me for an endpoint if I have not provided one.', output: {
    taskDecision: { objective: 'Determine the requested walking endpoint.', completionCriteria: 'The requested endpoint or continuing relationship is specified.',
      outcome: 'request_user', reason: 'No locomotion endpoint was supplied.', continuationPolicy: 'none', requiredCompletionBasis: 'user_input' }, program: null } },
  { instruction: 'Use the larger planner to work out a locomotion goal for my request to move around.', output: { delegatePlanning: true } },
  { instruction: 'Ask the larger planner to arrange a measured retreat followed by a bow.', output: { delegatePlanning: true } },
])
family('finite-and-cancel', [
  { instruction: 'Cancel the current measured travel execution.', output: { ...noTask(), executionDisposition: 'cancel', targetExecutionId: 'locomotion-execution-17' } },
  { instruction: 'Stop the locomotion goal that is currently running.', output: { ...noTask(), executionDisposition: 'cancel', targetExecutionId: 'locomotion-execution-17' } },
  { instruction: 'Independently of the travel goal, perform one nod.', output: { ...task('Perform one nod.', [action('nod')]), executionDisposition: 'new', targetExecutionId: '' } },
  { instruction: 'Explain the difference between cancelling the goal and reaching its endpoint; do not change the running task.', output: { ...noTask(), executionDisposition: 'new', targetExecutionId: '' } },
], { activeExecutions: [{ executionId: 'locomotion-execution-17', canSteer: true }] })

for (const [index, description] of ['blue crate by the storage rack', 'yellow trolley beside the pillar', 'red bin at the doorway', 'green toolbox under the bench'].entries()) {
  const target = { frameId: `locomotion-frame-${20 + index}`, frameTimestamp: TIME,
    box: { x: .16 + index * .12, y: .24, width: .18, height: .31 }, groundContact: { x: .24 + index * .12, y: .53 } }
  const evidence = { kind: 'vision_acquisition', acquisition: { purpose: 'locate', outcome: 'found',
    frame: { id: target.frameId, timestamp: TIME }, candidates: [{ box: target.box, description, evidence: 'Selected by the user in the retained frame.' }],
    selectedGroundContact: { point: target.groundContact, frameId: target.frameId, selectedBy: 'user', selectedAt: TIME, source: 'explicit-user-mark' } } }
  const approachGoal = { kind: 'approach', target, proximity: { kind: 'metric', metres: .8, tolerance: .07 } }
  const followGoal = { kind: 'follow', target, proximity: { kind: 'imageRelative', boxHeight: .4, tolerance: .03 }, endingCondition: 'Continue until explicit cancellation.' }
  const visualGoal = { kind: 'visual', target: description, completionCriteria: `The ${description} is fully visible in a new image.` }
  const behavior = (goal: Record<string, unknown>, criteria: string) => task(`Maintain the requested visual relationship to the ${description}.`, [{
    kind: 'behavior', target: description, completionCriteria: criteria, motion: motion('forward', goal, 'walk', 24),
    candidateLabels: [], identifyEveryFrames: 3, steering: null,
  }], { completionCriteria: criteria, requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded' })
  family(`visual-relationship-${index}`, [
    { instruction: `Approach the selected ${description} to a measured separation of 0.8 metres within 0.07 metres, using walk at 24 percent speed.`,
      output: endpoint(`Approach the selected ${description} to 0.8 metres.`, 'Attributed range estimates for the retained target establish 0.8 metres within 0.07 metres.', motion('forward', approachGoal, 'walk', 24)) },
    { instruction: `Follow the selected ${description} at 24 percent speed, keeping its image-box height at 0.4 within 0.03; continue until I cancel. Evaluate every third frame.`,
      output: behavior(followGoal, 'The selected ending condition is reached; accepted tracking updates and image-relative proximity remain separately recorded.') },
    { instruction: `Move forward at 24 percent walk speed until the ${description} is fully visible in a new image, checking every third frame.`,
      output: behavior(visualGoal, visualGoal.completionCriteria) },
    { instruction: `Describe how one could follow the ${description}; do not select physical or sensing actions.`, output: noTask() },
  ], {}, 'development', true, evidence)
}

// New combinations remain outside fitting and any recipe/checkpoint selection.
distance('forward', .61, .035, 'crawl', 38, 'evaluation')
distance('right', .43, .025, 'crab', 27, 'evaluation')
rotation(110, 6, 29, 'evaluation')
rotation(-55, 3, 41, 'evaluation')
