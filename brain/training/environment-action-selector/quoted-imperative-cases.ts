import { addCase, action, noTask, task, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Compositional development coverage: the words to speak can themselves be a
// complete body command, distinct from the body activity actually requested.
// Recorded failures and previously inspected evaluation requests stay excluded.
const development = [
  ['Would you lower into the built-in rest position now?', 'rest', 'nod'],
  ['May I watch you lift a front leg and wave it?', 'wave', 'shrug'],
  ['Could you dip the front of your body into a bow for me?', 'bow', 'stretch'],
  ['Hold the normal stance on all four legs.', 'stand', 'sit'],
  ['Begin the wide-legged sideways gait to the left.', 'crab', 'wave'],
  ['Would you demonstrate the seated body position?', 'sit', 'point'],
  ['Start the ordinary forward walking gait.', 'walk', 'nod'],
  ['Lower yourself into the flat lying pose.', 'lay_down', 'celebrate'],
  ['Shake your rear pair of legs.', 'shake', 'bow'],
  ['Can you demonstrate the shallow nodding gesture?', 'nod', 'shrug'],
  ['Stop the body movement you are doing.', 'stop', 'stretch'],
  ['Extend your legs in the built-in stretching routine.', 'stretch', 'wave'],
] as const
const evaluation = [
  ['Settle into a squat with the body above the floor.', 'crouch', 'point'],
  ['Lift and open the front arms in the seated shrug.', 'shrug', 'bow'],
  ['Begin walking rearward using the normal gait.', 'backward', 'nod'],
  ['Start the wide-legged sideways gait to the right.', 'crab_right', 'stretch'],
] as const
function family(entry: readonly string[], index: number, split: CaseSplit) {
  const [words, quotedCommand, actualCommand] = entry as [string, string, string]
  const quoted = JSON.stringify(words)
  const variants = [
    { instruction: `Say ${quoted}, then perform ${actualCommand}.`, steps: [action(actualCommand)] },
    { instruction: `Perform ${actualCommand}, then say ${quoted}.`, steps: [action(actualCommand)] },
    { instruction: `Repeat these words aloud: ${quoted}`, steps: null },
    { instruction: `The spoken line is ${quoted} The body gesture is ${actualCommand}. Speak first, then perform the gesture.`, steps: [action(actualCommand)] },
    { instruction: `First say ${quoted}; after that, perform ${actualCommand}; finish standing.`, steps: [action(actualCommand), action('stand')] },
    { instruction: words, steps: [action(quotedCommand)] },
    { instruction: `${words} Then say "Done with that movement".`, steps: [action(quotedCommand)] },
    { instruction: `Explain the body instruction ${quoted}`, steps: null },
  ]
  for (const inputSource of ['user', 'autonomy'] as const) {
    const outputs = variants.map(item => item.steps ? task(`Carry out: ${item.instruction}`, item.steps) : noTask())
    const source = addCase('task', `quoted-imperative-${split}-${index}`,
      variants.map(item => item.instruction), ['needsAction', 'needsEnvironment'], outputs[0]!,
      { observation: bodyObservation() }, split)
    source.targets = Object.fromEntries(outputs.map((output, i) => [i, output]))
    source.inputSource = inputSource
    source.fold = index % 4
  }
}
development.forEach((entry, index) => family(entry, index, 'development'))
evaluation.forEach((entry, index) => family(entry, index, 'evaluation'))
