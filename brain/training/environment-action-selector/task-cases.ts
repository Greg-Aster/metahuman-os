import { action, addCase, noTask, observation, task, TIME, type CaseSplit } from './development-cases.js'

const movement = ['needsAction', 'needsEnvironment']
function add(suite: string, instructions: string[], expected: Record<string, any>,
  selected = movement, inputs: Record<string, unknown> = {}, split: CaseSplit = 'development') {
  addCase('task', suite, instructions, selected, expected, inputs, split)
}
const commands: Array<[string, string[]]> = [
  ['wave', ['Please wave.', 'Wave at me.', 'Give me a wave.', 'Can you wave for me?']],
  ['bow', ['Please bow.', 'Bow for me.', 'Give me a bow.', 'Lower your front end in a bow.']],
  ['pushup', ['Do one pushup.', 'Perform a push-up.', 'Lower and raise your body once.', 'Show me a single push up.']],
  ['sit', ['Sit down.', 'Take your seated pose.', 'Please sit.', 'Lower yourself into a sitting position.']],
  ['stand', ['Stand up.', 'Rise to your standing pose.', 'Please stand.', 'Get into the standard upright stance.']],
  ['nod', ['Nod once.', 'Give one nod.', 'Please nod.', 'Dip and raise your front end in a nod.']],
  ['turn_left', ['Turn left ninety degrees.', 'Make a quarter turn left.', 'Rotate left by 90 degrees.', 'Please turn ninety degrees to the left.']],
  ['turn_right', ['Turn right ninety degrees.', 'Make a quarter turn right.', 'Rotate right by 90 degrees.', 'Please turn ninety degrees to the right.']],
]
for (const [command, instructions] of commands) add('advertised-motion', instructions, task(instructions[0]!, [action(command)]))
for (const [first, second] of [['wave', 'bow'], ['sit', 'stand'], ['nod', 'wave'], ['bow', 'pushup']]) {
  add('ordered-program', [`${first}, then ${second}.`, `First ${first}; after that ${second}.`,
    `Please ${first} followed by ${second}.`, `Do a ${first} and finish with a ${second}.`],
  task(`Perform ${first}, then ${second}.`, [action(first!), action(second!)]))
}
for (const [command, instructions] of commands.slice(0, 4)) {
  add('movement-and-speech', instructions.map(text => `${text} Also tell me what you selected.`), task(instructions[0]!, [action(command)]), [...movement, 'needsResponse', 'needsPersona'])
}
add('repetition', ['Wave twice.', 'Do two waves.', 'Give two waves in succession.', 'Perform a wave, followed by another wave.'], task('Wave twice.', [action('wave'), action('wave')]))
add('repetition', ['Do three pushups.', 'Perform three push-ups.', 'Give me three consecutive pushups.', 'Lower and raise your body three times.'], task('Perform three pushups.', [action('pushup'), action('pushup'), action('pushup')]))
for (const instructions of [
  ['Hello.', 'Good morning.', 'Hi there.', 'Good evening.'],
  ['How are you today?', 'How has your day been?', 'How are things with you?', 'How have you been?'],
  ['Thank you.', 'That was helpful.', 'Thanks a lot.', 'Much appreciated.'],
  ['What do you value?', 'Tell me about yourself.', 'What are your goals?', 'Describe your personality.'],
  ['Can this robot perform a bow?', 'Which gestures are available?', 'Describe your movement capabilities.', 'What commands does this robot support?'],
  ['Do not wave.', 'No bowing, please.', 'I do not want a pushup.', 'Please refrain from nodding.'],
  ['Explain what a bow is.', 'Describe a pushup in words.', 'Tell me how a wave works.', 'What does sitting mean?'],
  ['Translate "please wave" into Spanish.', 'Count the words in "please bow".', 'Spell the word pushup.', 'Repeat the phrase "stand up" as text.'],
  ['If I asked for a bow, what command would that use?', 'What would happen if I requested a wave?', 'Explain how you would respond to a request to sit.', 'Hypothetically, how could a robot nod?'],
  ['What is my cat called?', 'What did I tell you yesterday?', 'Summarize our conversation.', 'What do you remember about my project?'],
]) add('no-physical-request', instructions, noTask(), ['needsResponse', 'needsPersona', 'needsEnvironment'])
add('fresh-image', ['Take a photo now.', 'Capture one camera frame.', 'Get a fresh image.', 'Please take a new picture.'],
  task('Capture one fresh image.', [{ kind: 'action', action: { type: 'captureImage' } }]))
add('novel-motion', ['Slowly lean left, then return to center.', 'Lean to your left slowly and center yourself again.', 'Make a slow left lean and come back to center.', 'Shift into a slow leftward lean, then return.'],
  task('Slowly lean left, then return to center.', [{ kind: 'generatedMotion', description: 'Slowly lean left, then return to center.' }]))
add('novel-motion', ['Lift your rear right leg for two seconds.', 'Raise the right rear leg and hold it for two seconds.', 'Hold your back right leg up for two seconds.', 'Please lift the rear right leg for a two-second hold.'],
  task('Lift the rear right leg for two seconds.', [{ kind: 'generatedMotion', description: 'Lift the rear right leg for two seconds.' }]))
add('novel-motion', ['Lean forward while lifting your front left leg.', 'Lift the front left leg while leaning forward.', 'Combine a forward lean with a raised front left leg.', 'Raise your front left leg and lean forward at the same time.'],
  task('Lean forward while lifting the front left leg.', [{ kind: 'generatedMotion', description: 'Lean forward while lifting the front left leg.' }]))
add('history-reference', ['Do that gesture again.', 'Repeat the gesture we just discussed.', 'Perform that bow now.', 'Go ahead with the gesture you described.'],
  task('Perform the referenced bow.', [action('bow')]), [...movement, 'needsConversationHistory'],
  { conversationHistory: [{ role: 'user', content: 'Tell me about your bow gesture.', timestamp: TIME }, { role: 'assistant', content: 'A bow lowers the front end and recovers.', timestamp: TIME }] })
add('stale-history', ['Wave now.', 'Please give me a wave.', 'Wave at me now.', 'Perform a wave for me.'], task('Wave now.', [action('wave')]), [...movement, 'needsConversationHistory'],
  { conversationHistory: [{ role: 'user', content: 'Bow once.', timestamp: '2030-01-14T12:00:00.000Z' }, { role: 'assistant', content: 'The bow command completed.', timestamp: '2030-01-14T12:00:02.000Z' }] })
add('memory-reference', ['Do the greeting I saved.', 'Perform my remembered greeting gesture.', 'Use the greeting stored in memory.', 'Do my saved greeting routine.'], task('Perform the saved greeting.', [action('bow'), action('wave')]), [...movement, 'needsMemory'],
  { memories: [{ id: 'memory-1', type: 'conversation', timestamp: TIME, content: 'The user saved a greeting routine: bow, then wave.' }] })
for (const [disposition, instructions] of [
  ['cancel', ['Cancel the current activity.', 'Stop the ongoing task.', 'End the running execution.', 'Cancel what you are doing.']],
  ['steer', ['Make the ongoing movement slower.', 'Slow that activity down.', 'Reduce the speed of the current motion.', 'Continue the same task, but at a lower speed.']],
] as const) add('execution-handoff', [...instructions], { ...noTask(), executionDisposition: disposition, targetExecutionId: 'execution-41' }, [...movement, 'needsExecutionContext'],
  { activeExecutions: [{ executionId: 'execution-41', canSteer: true }] })
add('independent-execution', ['Separately, wave once.', 'Start a new task to wave.', 'As a separate activity, perform a wave.', 'Create an independent wave activity.'],
  { ...task('Perform an independent wave.', [action('wave')]), executionDisposition: 'new', targetExecutionId: '' }, [...movement, 'needsExecutionContext'],
  { activeExecutions: [{ executionId: 'execution-41', canSteer: true }] })
const unavailable = observation()
unavailable.capabilities = { actions: [], robotCommands: [], movement: false, visual: false }
add('unavailable-capability', ['Please wave.', 'Bow for me.', 'Do one pushup.', 'Sit down.'], {
  taskDecision: { objective: 'Perform the requested movement.', completionCriteria: 'The requested movement has completed.',
    outcome: 'request_user', reason: 'The supplied interface exposes no movement capability.', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' }, program: null,
}, movement, { observation: unavailable })
add('request-is-not-receipt', ['I would like you to bow.', 'I am asking for a bow now.', 'Please perform a bow for me.', 'My request is for you to bow once.'], task('Perform a bow.', [action('bow')]))

// These targets follow an explicit request for the available planner. They do
// not prescribe a complexity threshold or teach an automatic fallback policy.
add('requested-planning', [
  'Ask the larger planner to plan a bow followed by a wave.',
  'Have the larger model work out bowing and then waving.',
  'Delegate the bow-then-wave plan to the larger model.',
  'Use the larger planner for my request to bow and then wave.',
], { delegatePlanning: true })
add('requested-planning', [
  'Have the larger planner design a routine using the listed movements.',
  'Ask the larger model to compose a routine from the available gestures.',
  'Delegate planning a movement routine with these capabilities to the larger model.',
  'Use the larger planner to arrange the available movements into a routine.',
], { delegatePlanning: true })
add('requested-planning', [
  'Ask the larger planner how to revise execution-41 to move more slowly.',
  'Have the larger model plan the speed change for execution-41.',
  'Delegate planning a slower version of execution-41 to the larger model.',
  'Use the larger planner to work out reducing the pace of execution-41.',
], { delegatePlanning: true }, [...movement, 'needsExecutionContext'],
{ activeExecutions: [{ executionId: 'execution-41', canSteer: true }] })
add('requested-planning', [
  'Ask the larger model to plan a camera capture followed by a seated pose.',
  'Have the larger planner work out taking a picture and then sitting.',
  'Delegate the plan for a fresh photo followed by sitting to the larger model.',
  'Use the larger planner for capturing a frame and then sitting down.',
], { delegatePlanning: true })
add('planning-discussion', [
  'What is the larger planner?', 'Explain what planning delegation means.',
  'What happens when a task is delegated to the larger model?', 'Describe the purpose of the larger planner.',
], noTask(), ['needsResponse'])
add('direct-planning-request', [
  'Do not delegate this request; wave once.', 'Plan a single wave yourself.',
  'Select a wave directly without asking the larger planner.', 'Handle this with the current planner: wave once.',
], task('Wave once.', [action('wave')]))
add('quoted-planning-request', [
  'Translate "ask the larger planner to bow" into French.',
  'Proofread the sentence "delegate the wave to the larger model".',
  'Count the words in "use the larger planner to sit".',
  'Repeat "ask the larger model to plan a nod" as text.',
], noTask(), ['needsResponse'])
add('direct-planning-request', [
  'Please handle bowing then sitting yourself.', 'Without delegating, bow and then sit.',
  'Use the current planner to select a bow followed by a sit.', 'Plan bowing then sitting directly; no larger planner is requested.',
], task('Bow then sit.', [action('bow'), action('sit')]))

// Previously examined evaluation requests: regression only, excluded from training and checkpoint selection.
const regression: Array<[string, string[], Record<string, any>]> = [
  ['bow', ['Could I see your bow?', 'Show a bow for the audience.'], task('Bow.', [action('bow')])],
  ['wave', ['A little wave, please.', 'Wave to the visitor.'], task('Wave.', [action('wave')])],
  ['pushup', ['One press-up, please.', 'Show a single pushup for us.'], task('One pushup.', [action('pushup')])],
  ['sit', ['Assume the seated stance.', 'Get into a sitting pose.'], task('Sit.', [action('sit')])],
  ['stand', ['Return to an upright stance.', 'Rise onto all four legs.'], task('Stand.', [action('stand')])],
  ['nod', ['Give a nod of acknowledgment.', 'A single nod, please.'], task('Nod.', [action('nod')])],
  ['order', ['Nod, bow, then sit.', 'Start by nodding, follow with a bow, and sit last.'], task('Nod, bow, sit.', [action('nod'), action('bow'), action('sit')])],
  ['order', ['Stand before you wave.', 'First rise to standing, then give a wave.'], task('Stand, then wave.', [action('stand'), action('wave')])],
  ['order', ['Bow after two waves.', 'Wave twice and finish with a bow.'], task('Two waves, then bow.', [action('wave'), action('wave'), action('bow')])],
  ['order', ['Turn left ninety degrees and bow.', 'Make a left quarter-turn before bowing.'], task('Turn left, then bow.', [action('turn_left'), action('bow')])],
  ['negative', ['I am describing a wave, not requesting one.', 'No need to move; explain bowing.'], noTask()],
  ['quote', ['Proofread this sentence: "Robot, do a pushup."', 'Translate "robot, sit" to French.'], noTask()],
  ['conversation', ['What has been on your mind?', 'Have you had a pleasant day?'], noTask()],
  ['question', ['What distinguishes a bow from a nod?', 'How many gestures are listed?'], noTask()],
  ['capture', ['Acquire a fresh shot from the camera.', 'Save one new camera frame.'], task('Capture an image.', [{ kind: 'action', action: { type: 'captureImage' } }])],
  ['nuance', ['Lean backward slowly, keeping your front right leg lifted.', 'With your front right leg raised, lean back slowly.'], task('Lean backward with the front right leg raised.', [{ kind: 'generatedMotion', description: 'Lean backward slowly, keeping the front right leg lifted.' }])],
]
for (const [suite, instructions, expected] of regression) add(suite, instructions, expected, movement, {}, 'regression')
for (const disposition of ['cancel', 'steer']) add('execution', disposition === 'cancel'
  ? ['Terminate execution-72.', 'Cancel the activity with ID execution-72.']
  : ['Adjust execution-72 to go faster.', 'Increase the pace of execution-72.'],
{ ...noTask(), executionDisposition: disposition, targetExecutionId: 'execution-72' }, [...movement, 'needsExecutionContext'],
{ activeExecutions: [{ executionId: 'execution-16', canSteer: true }, { executionId: 'execution-72', canSteer: true }] }, 'regression')
add('requested-planning', [
  'Pass the planning of two nods followed by standing to the larger model.',
  'Let the larger planner figure out two nods and a stand.',
], { delegatePlanning: true }, movement, {}, 'regression')
add('requested-planning', [
  'Refer the plan for a photo, wave, and bow to the larger model.',
  'I want the larger planner to arrange taking a picture, waving, and bowing in that order.',
], { delegatePlanning: true }, movement, {}, 'regression')
add('planning-discussion', [
  'Define the phrase "delegate planning".', 'Tell me what the larger model contributes to planning.',
], noTask(), ['needsResponse'], {}, 'regression')
add('direct-planning-request', [
  'Keep this plan with the current model: nod, then sit.',
  'No delegation for this one; give a nod and sit down afterwards.',
], task('Nod then sit.', [action('nod'), action('sit')]), movement, {}, 'regression')
