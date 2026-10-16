import { addCase, action, noTask, task, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Synthetic contrastive requests teach the speech/action interface. These are
// fitting labels, never runtime response rules. The captured crab incident is
// excluded from this file and remains an independent private replay.
const development = [
  ['Run for the hills!', 'wave', 'walk', 'Begin walking forward.'],
  ['Let us dance another day.', 'nod', 'crab_right', 'Start wide-stance sideways walking to the right.'],
  ['I could use a hand.', 'bow', 'backward', 'Begin walking backward.'],
  ['That gave me a jolt!', 'shrug', 'crab', 'Start wide-stance sideways walking to the left.'],
  ['Stop, look and listen.', 'stretch', 'left', 'Start turning left with your walking gait.'],
  ['Time to stand up for ourselves.', 'sit', 'right', 'Start turning right with your walking gait.'],
  ['A wave of excitement!', 'point', 'crab_forward', 'Begin wide-stance forward walking.'],
  ['I am feeling rather crabby.', 'surprised', 'crab_backward', 'Begin wide-stance backward walking.'],
  ['Please sit tight.', 'dance', 'crawl', 'Begin crawling low above the floor.'],
  ['Walk this way, said the guide.', 'celebrate', 'run', 'Start the bounding run gait.'],
  ['Do not shrug it off.', 'shake', 'crab_turn_left', 'Begin wide-stance turning left.'],
  ['What a speedy ride!', 'pushup', 'crab_turn_right', 'Begin wide-stance turning right.'],
] as const
const evaluation = [
  ['We are making great strides.', 'shrug', 'crab', 'Move sideways left with a continuous wide stance.'],
  ['Take a bow, my friend.', 'nod', 'walk', 'Set off walking forward.'],
  ['Keep calm and carry on.', 'wave', 'crab_right', 'Move sideways right with a continuous wide stance.'],
  ['My thoughts are racing.', 'stretch', 'backward', 'Set off walking in reverse.'],
] as const
function addFamily(entry: readonly string[], index: number, split: CaseSplit) {
  const [words, gesture, gait, motionRequest] = entry as [string, string, string, string]
  const quoted = JSON.stringify(words)
  const literal = split === 'development' ? `Perform a ${gesture} gesture.` : `Try the ${gesture} gesture.`
  const variants = [
    { instruction: `Say ${quoted}.`, steps: null },
    { instruction: `Speak the words ${quoted} and then give a brief ${gesture} gesture.`, steps: [action(gesture)] },
    { instruction: `Perform a ${gesture} gesture, then say ${quoted}.`, steps: [action(gesture)] },
    { instruction: `Give the spoken response ${quoted}, do a ${gesture}, and finish standing.`, steps: [action(gesture), action('stand')] },
    { instruction: `Read aloud: ${JSON.stringify(literal)}`, steps: null },
    { instruction: motionRequest, steps: [action(gait)] },
    { instruction: `${motionRequest} Then say ${quoted}.`, steps: [action(gait)] },
    { instruction: `Explain the meaning of the phrase ${quoted}.`, steps: null },
  ]
  for (const inputSource of ['user', 'autonomy'] as const) {
    const outputs = variants.map(item => item.steps
      ? task(`Carry out: ${item.instruction}`, item.steps) : noTask())
    const source = addCase('task', `speech-action-boundary-${split}-${index}`,
      variants.map(item => item.instruction), ['needsAction', 'needsEnvironment'], outputs[0]!,
      { observation: bodyObservation() }, split)
    source.targets = Object.fromEntries(outputs.map((output, i) => [i, output]))
    source.inputSource = inputSource
    source.fold = index % 4
  }
}
development.forEach((entry, index) => addFamily(entry, index, 'development'))
evaluation.forEach((entry, index) => addFamily(entry, index, 'evaluation'))
