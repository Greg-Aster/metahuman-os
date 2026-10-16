import { addCase, intentOutput, noTask, observation, task, TIME, type CaseSplit } from './development-cases.js'

// Synthetic supervised examples for the existing vision contract. No runtime
// prompt, target-loss policy, motion limit, or automatic model routing is added.
function intent(suite: string, instructions: string[], taskContext: string[], conversationContext: string[],
  action = true, split: CaseSplit = 'development', response = true) {
  return addCase('intent', `vision-tracking-${suite}`, instructions, [],
    { ...intentOutput(taskContext, conversationContext, response, action), taskPlanner: action ? 'vision' : 'specialist' }, {}, split)
}
const sensing = ['environment', 'vision']
intent('stationary-acquisition', [
  'Find the striped mug in your camera view and start tracking it while staying still. Tell me when it is active.',
  'Keep your feet in place and visually track the green backpack. Report when tracking starts.',
  'Without walking anywhere, locate the yellow toy and keep it selected in the video. Tell me the result.',
  'Please track the water bottle with your camera, not by following it with your body, and report the result.',
], sensing, ['robotStatus', 'environment'])
intent('category-search', [
  'Search the camera stream for umbrellas and report detections; keep the body still.',
  'Configure visual detection for scissors without moving, and tell me when the search is running.',
  'Look for shoes in the incoming frames and report what the detector finds while remaining here.',
  'Set the video detector to look for drinking glasses and report its status; no walking.',
], ['environment'], ['environment', 'robotStatus'])
intent('selection', [
  'Use the candidate I picked in the returned frame as the tracking reference and confirm the selection.',
  'Track the rightmost of the two returned bottle candidates without moving, and report the result.',
  'Use the retained photo of my patterned bag to locate it in the camera view, then tell me what you find.',
  'Select the visible cup associated with the indicated track ID and confirm it without following it physically.',
], [...sensing, 'executionContext'], ['environment', 'robotStatus'])
intent('release', [
  'Release the current visual target and tell me when the tracker has cleared it; leave the body alone.',
  'Clear the selected object from tracking and confirm the result without changing my camera setting.',
  'Stop tracking that object, keep the camera running, and confirm that the selection was released.',
  'Remove the current tracking reference and report completion; no movement command.',
], ['environment'], ['environment', 'robotStatus'])
intent('description-only', [
  'Describe the striped mug in the current image, but do not start tracking it.',
  'Is there a green backpack in this image? Just answer; leave tracking unchanged.',
  'Tell me what color the visible toy is without selecting a visual target.',
  'Count the bottles in this picture without configuring a detector.',
], [], sensing, false)
intent('status-only', [
  'Is the selected target still visible? Report the current tracking status without changing it.',
  'Which query and track are currently selected? Just read the status.',
  'Did the tracker lose the object? Tell me what its latest update says; do not restart it.',
  'Has the visual search returned a match yet? Report its progress only.',
], [], ['environment', 'robotStatus', 'executionContext'], false)
intent('discussion-only', [
  'Explain what visual target acquisition means; do not perform it.',
  'Translate "track the bottle without moving" into Spanish.',
  'What is the difference between detecting a category and identifying my particular object?',
  'Read the words "release the visual target" aloud without changing anything.',
], [], [], false)
intent('explicit-reacquisition', [
  'The selected target was lost. Search for it again from here and report the result.',
  'Reacquire the bag using the saved reference, stay still, and tell me whether you found it.',
  'Look again for the previously selected toy without turning, and tell me what you find.',
  'Retry finding the lost cup in the current view, without moving, and report whether it matches.',
], [...sensing, 'executionContext'], ['environment', 'robotStatus'])
const silence = intent('silence', [
  'Search the camera frames for a stapler while staying still and say nothing.',
  'Release the visual selection silently, without moving.',
  'Locate the red toolbox in the camera view without speaking or moving.',
  'Configure the detector for bicycles; remain silent and stationary.',
], sensing, [], true, 'development', false)
silence.targets = {
  0: { ...intentOutput(['environment'], [], false, true), taskPlanner: 'vision' },
  1: { ...intentOutput(['environment'], [], false, true), taskPlanner: 'vision' },
  2: { ...intentOutput(sensing, [], false, true), taskPlanner: 'vision' },
  3: { ...intentOutput(['environment'], [], false, true), taskPlanner: 'vision' },
}
const heldoutStationary = intent('heldout-stationary', [
  'Keep your legs exactly where they are; acquire the orange case and track it in the video, then tell me.',
  'Start a stationary visual search for helmets and tell me when it is configured.',
  'Deselect the current visual reference, keep streaming, and confirm the result.',
], sensing, ['environment', 'robotStatus'], true, 'evaluation')
// Acquisition needs image evidence; configuring category search or releasing a
// selection needs the interface/status, just as in the development examples.
heldoutStationary.targets = {
  0: { ...intentOutput(sensing, ['environment', 'robotStatus'], true, true), taskPlanner: 'vision' },
  1: { ...intentOutput(['environment'], ['environment', 'robotStatus'], true, true), taskPlanner: 'vision' },
  2: { ...intentOutput(['environment'], ['environment', 'robotStatus'], true, true), taskPlanner: 'vision' },
}
intent('heldout-non-action', [
  'Explain "find and track my camera case" as a sentence, without carrying it out.',
  'Translate "select the orange object" into French; do not operate the tracker.',
], [], [], false, 'evaluation')
intent('heldout-status', [
  'Give me the latest tracking report without changing the target or moving.',
  'Is the previous acquisition still pending? Report only its recorded state.',
], [], ['environment', 'robotStatus', 'executionContext'], false, 'evaluation')

export const LIVE_TRACKING_REGRESSION = 'Without moving your body, find and visually track the empty chair in front of the desk. Tell me when tracking is active.'
intent('live-regression', [LIVE_TRACKING_REGRESSION], sensing, ['environment', 'robotStatus'], true, 'regression')

function visionObservation(operations = ['search', 'select', 'release']) {
  const value = observation()
  value.state = { ...value.state, recognition: { enabled: true, visionOperations: operations, visionTarget: null } }
  return value
}
const vision = (operation: string, fields: Record<string, unknown> = {}) => ({ kind: 'vision', operation, ...fields })
const tracking = (target: string, steps: unknown[]) => task(`Start stationary visual tracking of ${target}.`, steps, {
  completionCriteria: `Fresh recognition updates for the accepted selection query identify ${target} with a track ID.`,
  continuationPolicy: 'bounded', requiredCompletionBasis: 'environment_state',
})
function taskFamily(suite: string, instructions: string[], expected: Record<string, any>,
  split: CaseSplit = 'development', taskEvidence?: Record<string, unknown>, inputs: Record<string, unknown> = {}) {
  const source = addCase('task', `vision-tracking-${suite}`, instructions, ['needsAction', 'needsEnvironment'], expected,
    { observation: visionObservation(), ...inputs }, split)
  source.visualTask = true
  source.taskEvidence = taskEvidence
  return source
}
for (const [target, instructions] of [
  ['striped mug', ['Locate the striped mug and start tracking it without moving.', 'Stay where you are and acquire the striped mug for visual tracking.',
    'Find the striped mug in the current camera view, then track it from here.', 'Keep still and begin tracking the striped mug in the video.']],
  ['green backpack', ['Acquire the green backpack for tracking while staying still.', 'Keep your body stationary and find the green backpack to track.',
    'Locate the green backpack in the camera view and keep it selected.', 'Start visual tracking of the green backpack without walking.']],
  ['my keys', ['Find my keys in the camera view without moving, and track the matching object.', 'Stay still and locate my keys for visual tracking.',
    'Acquire candidates for my keys from the current scene before selecting a tracker reference.', 'Look for my keys in this view; do not physically search the room.']],
] as Array<[string, string[]]>) taskFamily(`acquire-${target.replaceAll(' ', '-')}`, instructions,
  tracking(target, [vision('acquire', { target })]))

for (const [labels, instructions] of [
  [['umbrella'], ['Configure the detector to search the stream for umbrellas, without moving.', 'Search incoming frames for any umbrella while staying still.']],
  [['scissors', 'stapler'], ['Search the video for scissors and staplers; do not move.', 'Configure category detection for scissors or a stapler from this position.']],
] as Array<[string[], string[]]>) taskFamily(`search-${labels[0]}`, instructions,
  task(`Configure stationary category search for ${labels.join(' and ')}.`, [vision('search', { labels })], {
    completionCriteria: 'The detector reports the requested labels under the accepted search query.', requiredCompletionBasis: 'environment_state',
  }))

function acquisition(id: string, outcome: 'found' | 'ambiguous' | 'not_found',
  candidates: Array<{ box: Record<string, number>; description: string; evidence: string }>) {
  return { kind: 'vision_acquisition', acquisition: { purpose: 'locate', outcome,
    frame: { id, timestamp: TIME, metadata: { robotId: 'training-robot', gatewayInstance: 'training-gateway', epoch: 4, counter: 12 } },
    candidates } }
}
const mug = { box: { x: .15, y: .25, width: .2, height: .3 }, description: 'striped mug', evidence: 'One mug has visible vertical stripes.' }
const bottle = { box: { x: .62, y: .18, width: .16, height: .45 }, description: 'rightmost bottle', evidence: 'This bottle is to the right of the other bottle.' }
for (const [id, candidate, instructions] of [
  ['mug-source-frame', mug, ['Select the returned striped mug candidate for tracking without moving.', 'Use the identified striped mug region as the tracker reference.']],
  ['bottle-source-frame', bottle, ['Track the rightmost bottle candidate from the returned image while staying still.', 'Select the rightmost returned bottle region as the visual reference.']],
] as Array<[string, typeof mug, string[]]>) taskFamily(`select-${id}`, instructions,
  tracking(candidate.description, [vision('select', { frameId: id, box: candidate.box, description: candidate.description })]),
  'development', acquisition(id, 'found', id === 'bottle-source-frame'
    ? [{ ...bottle, box: { ...bottle.box, x: .12 }, description: 'leftmost bottle', evidence: 'The other bottle is to its right.' }, candidate] : [candidate]))

const reference = acquisition('retained-bag-reference', 'found', [{ ...mug, description: 'my patterned bag', evidence: 'Patterned bag chosen by the user.' }])
taskFamily('reference-acquisition', [
  'Use retained-bag-reference as the reference image to locate my patterned bag in the current view, without moving.',
  'Compare the current camera image with retained-bag-reference and acquire my patterned bag while staying here.',
], tracking('my patterned bag', [vision('acquire', { target: 'my patterned bag', referenceFrameId: 'retained-bag-reference' })]), 'development', reference)

taskFamily('release-target', [
  'Release the current visual target without moving or switching the camera off.',
  'Clear the tracker reference and keep the camera running; leave the body alone.',
  'Deselect the tracked object without sending a movement command.',
  'Stop tracking the selected object, but continue the normal camera stream.',
], task('Release the selected visual target.', [vision('release')], {
  completionCriteria: 'The vision release is acknowledged and recognition reports no selected target.', requiredCompletionBasis: 'environment_state',
}))

taskFamily('stationary-observation', [
  'Stay still and inspect each new camera frame until a red ball is visible; then report it.',
  'Without moving, watch every new frame for a red ball and finish this observation when it appears.',
], task('Observe from the current position until a red ball is visible.', [{ kind: 'behavior', target: 'red ball',
  completionCriteria: 'A new camera image visibly contains a red ball.', motion: null, candidateLabels: ['ball'], identifyEveryFrames: 1, steering: null }], {
  completionCriteria: 'A new camera image visibly contains a red ball.', requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded',
}))

const unresolved = (target: string, reason: string) => ({ taskDecision: {
  objective: `Start stationary visual tracking of ${target}.`, completionCriteria: `The intended ${target} is selected and fresh tracking evidence is available.`,
  outcome: 'request_user', reason, continuationPolicy: 'none', requiredCompletionBasis: 'environment_state',
}, program: null })
taskFamily('ambiguous-identity', [
  'Track my keyring without moving; if the evidence cannot distinguish mine, ask which one I mean.',
  'Select my keyring from the candidates only if its identity is established; otherwise ask me to choose.',
], unresolved('keyring', 'The returned candidates show two keyrings without evidence establishing which belongs to the user.'), 'development',
acquisition('two-keyrings-frame', 'ambiguous', [
  { ...mug, description: 'left keyring', evidence: 'Several metal keys on a ring; no ownership mark is visible.' },
  { ...bottle, description: 'right keyring', evidence: 'Another ring of keys; no ownership mark is visible.' },
]))
taskFamily('not-found', [
  'Find the orange pouch in this view without moving; if it is not visible, ask me to put it in view.',
  'Acquire the orange pouch from here, or ask me to show it if this view contains no candidate.',
], unresolved('orange pouch', 'No orange pouch candidate was found in this source image; this does not establish absence elsewhere.'),
'development', acquisition('pouch-not-found-frame', 'not_found', []))
taskFamily('explicit-reacquisition', [
  'The selected striped mug was lost. Acquire it again from this position without moving.',
  'Reacquire the lost striped mug from the current camera view; stay still.',
], tracking('striped mug', [vision('acquire', { target: 'striped mug' })]))
taskFamily('discussion-and-status', [
  'Explain what visual tracking means; do not start it.',
  'Translate "select the striped mug" without carrying out that instruction.',
  'Report whether the target is visible without changing tracking or moving.',
  'Tell me what the last acquisition returned; do not select any candidate.',
], noTask())
taskFamily('unsupported-search', [
  'Configure category search for shoes if this interface advertises search; otherwise tell me it is unavailable.',
  'Enable text search for shoes only if the connected detector offers it; report if it does not.',
], { taskDecision: { objective: 'Configure category search for shoes.', completionCriteria: 'The detector reports an accepted search for shoes.',
  outcome: 'report', reason: 'This interface does not advertise detector search.', continuationPolicy: 'none', requiredCompletionBasis: 'environment_state' }, program: null },
'development', undefined, { observation: visionObservation([]) })

// New subjects and wording are withheld from fitting and checkpoint selection.
taskFamily('heldout-acquire', ['Remain at this position and establish visual tracking of the orange camera case.',
  'Find the orange camera case and start tracking it in the stream without repositioning.'],
tracking('orange camera case', [vision('acquire', { target: 'orange camera case' })]), 'evaluation')
taskFamily('heldout-search', ['Search video frames for helmets and gloves while the body stays put.'],
task('Configure category detection for helmets and gloves.', [vision('search', { labels: ['helmet', 'glove'] })], {
  completionCriteria: 'The accepted search query reports helmet and glove labels.', requiredCompletionBasis: 'environment_state',
}), 'evaluation')
const caseCandidate = { box: { x: .34, y: .51, width: .28, height: .19 }, description: 'orange camera case', evidence: 'A single orange rectangular case is visible.' }
taskFamily('heldout-select', ['Use the returned orange camera case candidate as the tracking reference; keep still.'],
tracking('orange camera case', [vision('select', { frameId: 'case-evaluation-frame', box: caseCandidate.box, description: caseCandidate.description })]),
'evaluation', acquisition('case-evaluation-frame', 'found', [caseCandidate]))
taskFamily('heldout-release', ['Remove the current visual selection while continuing the camera feed and leaving the body still.'],
task('Release the selected visual target.', [vision('release')], { completionCriteria: 'Recognition confirms the accepted release and no selected target.',
  requiredCompletionBasis: 'environment_state' }), 'evaluation')
taskFamily('heldout-ambiguous', ['Track my glasses while staying here; ask me which pair if the returned candidates do not establish mine.'],
unresolved('glasses', 'Two pairs of glasses are visible and neither has evidence of ownership.'), 'evaluation',
acquisition('glasses-evaluation-frame', 'ambiguous', [
  { ...mug, description: 'round glasses', evidence: 'Round frames with no visible owner identifier.' },
  { ...bottle, description: 'square glasses', evidence: 'Square frames with no visible owner identifier.' },
]))
taskFamily('heldout-description', ['Discuss how a robot could track an orange camera case; do not configure tracking.'], noTask(), 'evaluation')
taskFamily('live-regression', [LIVE_TRACKING_REGRESSION],
  tracking('empty chair in front of the desk', [vision('acquire', { target: 'empty chair in front of the desk' })]), 'regression')
