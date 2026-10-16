import { addCase, action, intentOutput, noTask, observation, task, TIME } from './development-cases.js'

// Fresh development families for the verified interpretation failures. Evaluation,
// regression and observed requests remain outside these families.
const route = (name: string, texts: string[], taskContext: string[], conversationContext: string[], response: boolean, acts: boolean) =>
  addCase('intent', `refinement-${name}`, texts, [], intentOutput(taskContext, conversationContext, response, acts))
route('silent-body', [
  'Give a single nod; keep your answer channel silent.', 'A wave is all I want; omit any verbal acknowledgement.',
  'Carry out a seated pose with no reply at all.', 'Make the pushup gesture, and do not say anything before or afterward.',
], ['environment'], [], false, true)
const silentTool = route('silent-tools', [
  'Create a local CSV file listing the supplied inventory, but send no chat acknowledgement.',
  'Find the latest bus timetable on the web without a conversational reply.',
  'Search the disk for my exported drawings; do not announce the search in chat.',
  'Run the test suite in the project folder and save its report without speaking.',
], [], [], false, false)
silentTool.expected.needsToolUse = true
route('remembered-facts', [
  'Which nickname did I give my parrot?', 'What did I call the boat I told you about?',
  'Remind me of the name I chose for my new bakery.', 'What was the title of the story I said I was writing?',
], [], ['conversationHistory', 'memory', 'persona.personality'], true, false)
route('stored-only', [
  'Retrieve my saved notes about the pottery workshop.', 'Search remembered details of our aquarium visit.',
  'Find what is stored about my model railway project.', 'Recall the saved account of the orchard trip.',
], [], ['memory'], true, false)
route('capability-questions', [
  'Does the connected body advertise a kneeling command?', 'Which sensing operations can the current interface perform?',
  'Read the available body functions and tell me whether it supports nodding.', 'Can this connected robot select a tracker reference?',
], [], ['environment'], true, false)
route('silent-sensing', [
  'Locate the violet thermos for stationary tracking, with no spoken confirmation.',
  'Keep still and acquire the checked scarf in the image; remain silent.',
  'Find the copper watering can for tracking, but do not produce a chat response.',
  'Visually acquire the folded newspaper without walking or answering aloud.',
], ['environment', 'vision'], [], false, true)
route('sensing-request', [
  'Start tracking the striped cushion in view from this position and report its status.',
  'Keep the body still while acquiring the blue folder for tracking; tell me the result.',
  'Find the red measuring tape in the image for visual tracking and report back without moving.',
  'Acquire the white lunchbox in the current view and report when it is tracked, staying here.',
], ['environment', 'vision'], ['environment', 'robotStatus'], true, true)
route('picture-description', [
  'Describe the visible striped cushion, leaving its tracking selection unchanged.',
  'How many blue folders are in this picture? Answer without setting up a search.',
  'Read the markings on the measuring tape in the image; do not track it.',
  'What shape is the white lunchbox shown here? Only describe it.',
], [], ['environment', 'vision'], true, false)
route('tracking-status', [
  'Read the latest tracking state of the cushion; leave all controls as they are.',
  'Has the current folder acquisition returned yet? Just report the recorded state.',
  'Tell me whether the accepted measuring-tape query has a current track, without altering it.',
  'Which retained frame was used for the lunchbox selection? Report the current execution record.',
], [], ['environment', 'robotStatus', 'executionContext'], true, false)
route('tracking-discussion', [
  'Explain why selecting an object and tracking it are different operations.',
  'In the sentence "track a lunchbox", identify the verb.',
  'Discuss what it would mean to release a visual target; do not perform a release.',
  'Rewrite "acquire the cushion" in the past tense, without operating the camera.',
], [], [], true, false)
route('silent-release', [
  'Clear the visual reference silently, leaving camera streaming on.',
  'Deselect the tracked target with no conversational acknowledgement.',
  'Release the selected object and keep both the body and voice still.',
  'Remove the tracker selection; no reply is wanted.',
], ['environment'], [], false, true)
route('detector-config', [
  'Configure category detection for forks and report the result without walking.',
  'Set up a stationary stream search for handbags; tell me when the query is accepted.',
  'Change the detector categories to clocks and report the resulting state.',
  'Look for spoons in incoming video using category search and tell me the outcome.',
], ['environment'], ['environment', 'robotStatus'], true, true)

type Variant = { text: string; output: Record<string, any> }
let foldIndex = 0
function family(name: string, variants: Variant[], inputs: Record<string, unknown> = {}, evidence?: Record<string, unknown>, fold = foldIndex++ % 4) {
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', `refinement-${name}`, variants.map(v => v.text),
      ['needsAction', 'needsEnvironment', ...(inputs.robotStatus ? ['needsRobotStatus'] : [])], variants[0]!.output, inputs)
    source.targets = Object.fromEntries(variants.map((v, index) => [index, v.output]))
    source.inputSource = inputSource
    source.fold = fold
    source.taskEvidence = evidence
  }
}
for (const command of ['nod', 'sit', 'wave', 'pushup']) family(`quoted-${command}`, [
  { text: `Write a dictionary definition for the robot gesture ${command}; do not demonstrate it.`, output: noTask() },
  { text: `Change the instruction "perform ${command}" to reported speech.`, output: noTask() },
  { text: `I am describing a possible ${command}, not requesting a physical performance. Explain that distinction.`, output: noTask() },
  { text: `Actually perform one ${command} now.`, output: task(`Perform one ${command}.`, [action(command)]) },
])

// Numeric siblings and reversed phrasing share one fold; only the explicitly
// selected branch is fitted. These use new voltages and command combinations,
// carried by the existing Robot Status battery contract.
for (const [threshold, low, high] of [[6.4, 'nod', 'sit'], [7.9, 'wave', 'nod'], [8.6, 'sit', 'wave']] as const) {
  const fold = foldIndex++ % 4
  for (const voltage of [threshold - .2, threshold, threshold + .2].map(value => Number(value.toFixed(1)))) {
    const choose = (name: string) => task(`Perform ${name} for the supplied battery voltage.`, [action(name)])
    family(`exclusive-${threshold}-${voltage}`, [
      { text: `If battery voltage is less than ${threshold} volts, choose ${low}; otherwise choose ${high}. Execute only the selected gesture.`,
        output: choose(voltage < threshold ? low : high) },
      { text: `Perform ${high} when battery voltage is at least ${threshold} volts; perform ${low} otherwise. Do not combine the branches.`,
        output: choose(voltage >= threshold ? high : low) },
      { text: `Only perform ${low} when battery voltage is greater than ${threshold} volts; otherwise perform no gesture.`,
        output: voltage > threshold ? choose(low) : noTask() },
    ], { robotStatus: { updatedAt: TIME, body: { sessionId: 'training-body', battery: { voltage, observedAt: TIME } } } }, undefined, fold)
  }
}

const vision = (operation: string, fields: Record<string, unknown> = {}) => ({ kind: 'vision', operation, ...fields })
const visionObservation = observation()
visionObservation.state = { ...visionObservation.state, recognition: { enabled: true, visionOperations: ['search', 'select', 'release'], visionTarget: null } }
const visionInputs = { observation: visionObservation }
const tracking = (target: string, steps: unknown[]) => task(`Start stationary visual tracking of ${target}.`, steps, {
  completionCriteria: `Fresh recognition updates for the accepted selection query identify ${target} with a track ID.`,
  continuationPolicy: 'bounded', requiredCompletionBasis: 'environment_state',
})
for (const [index, target] of ['violet thermos beside the sink', 'checked scarf on the middle hook', 'copper watering can under the shelf', 'folded newspaper next to the lamp'].entries()) {
  const fold = foldIndex++ % 4
  const frameId = `refinement-source-${index + 20}`
  const box = { x: .08 + index * .14, y: .12 + index * .06, width: .19, height: .23 }
  const evidence = { kind: 'vision_acquisition', acquisition: { purpose: 'locate', outcome: 'found',
    frame: { id: frameId, timestamp: TIME, metadata: { robotId: 'training-robot', gatewayInstance: 'refinement-gateway', epoch: 9, counter: index + 20 } },
    candidates: [{ box, description: target, evidence: `The image visibly contains the ${target}.` }],
  } }
  family(`exact-selection-${index}`, [
    { text: `Use the returned candidate for the ${target} as the visual reference; remain stationary.`,
      output: tracking(target, [vision('select', { frameId, box, description: target })]) },
    { text: `Select the supplied region containing the ${target} for stationary tracking.`,
      output: tracking(target, [vision('select', { frameId, box, description: target })]) },
    { text: `Describe the candidate for the ${target} without selecting it.`, output: noTask() },
  ], visionInputs, evidence, fold)
  family(`qualified-acquisition-${index}`, [
    { text: `Acquire the ${target} for tracking without moving.`, output: tracking(target, [vision('acquire', { target })]) },
    { text: `Find the ${target} in a new image and keep tracking it from here.`, output: tracking(target, [vision('acquire', { target })]) },
  ], visionInputs, undefined, fold)
}
family('release-versus-discussion', [
  { text: 'Unselect the tracked reference, keeping the video stream on and body stationary.',
    output: task('Release the selected visual reference.', [vision('release')], { completionCriteria: 'The accepted release is acknowledged and recognition reports no selected target.', requiredCompletionBasis: 'environment_state' }) },
  { text: 'Tell me what unselecting a tracked reference would do, without doing it.', output: noTask() },
  { text: 'Read the current release status without sending another release.', output: noTask() },
  { text: 'Parse the grammar of "unselect the tracked reference" without operating tracking.', output: noTask() },
], visionInputs)
for (const [index, noun] of ['lanyard', 'pencil case', 'mittens', 'notebook'].entries()) {
  const candidates = ['left', 'right'].map((position, i) => ({ box: { x: .1 + i * .5, y: .3, width: .2, height: .25 },
    description: `${position} ${noun}`, evidence: `A ${noun} is visible; no ownership identifier is visible.` }))
  const evidence = { kind: 'vision_acquisition', acquisition: { purpose: 'locate', outcome: 'ambiguous',
    frame: { id: `refinement-ambiguous-${index}`, timestamp: TIME }, candidates } }
  const unresolved = { taskDecision: { objective: `Start stationary tracking of the user's ${noun}.`,
    completionCriteria: `The intended ${noun} is selected and fresh tracking evidence is available.`, outcome: 'request_user',
    reason: `Both candidates are ${noun}; no evidence establishes which belongs to the user.`, continuationPolicy: 'none', requiredCompletionBasis: 'environment_state' }, program: null }
  family(`ownership-${index}`, [
    { text: `Track my ${noun} from here; if the candidates do not identify mine, ask me to distinguish it.`, output: unresolved },
    { text: `Only select my ${noun} if ownership is established in the returned evidence. Otherwise ask which candidate I intend.`, output: unresolved },
    { text: `The right-hand ${noun} is the one I intend. Select that returned region without moving.`,
      output: tracking(`right ${noun}`, [vision('select', { frameId: `refinement-ambiguous-${index}`, box: candidates[1]!.box, description: `right ${noun}` })]) },
  ], visionInputs, evidence)
}
