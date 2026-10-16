import { addCase, action, intentOutput, noTask, task, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Synthetic examples of the approved interface, not runtime event-response rules.
// All orderings, quoted contrasts, and source siblings in a family share a fold.
// The recorded boot failure remains a private regression replay, outside fitting.
const routes = ['needsAction', 'needsEnvironment']
let familyIndex = 0
function family(suite: string, variants: Array<{ instruction: string; output: Record<string, any> }>, split: CaseSplit) {
  const fold = familyIndex++ % 4
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', `speech-program-${suite}`, variants.map(item => item.instruction), routes,
      variants[0]!.output, { observation: bodyObservation() }, split)
    source.targets = Object.fromEntries(variants.map((item, index) => [index, item.output]))
    source.inputSource = inputSource
    source.fold = fold
  }
}
function ordered(gesture: string, text: string, split: CaseSplit) {
  const plan = (steps: unknown[]) => task(`Perform ${gesture} and stand.`, steps)
  family(`order-${gesture}`, [
    { instruction: `Say "${text}", then perform ${gesture}, then stand.`, output: plan([action(gesture), action('stand')]) },
    { instruction: `Perform ${gesture}, say "${text}", then stand.`, output: plan([action(gesture), action('stand')]) },
    { instruction: `Perform ${gesture}, stand, and finally say "${text}".`, output: plan([action(gesture), action('stand')]) },
    { instruction: `First say "${text}"; perform ${gesture}; say "Finished"; return to standing.`,
      output: plan([action(gesture), action('stand')]) },
    { instruction: `Perform ${gesture} and stand without speaking.`, output: plan([action(gesture), action('stand')]) },
    { instruction: `Discuss the instruction 'say "${text}", perform ${gesture}, then stand' without executing that sequence.`, output: noTask() },
  ], split)
}
for (const [gesture, text] of [['bow', 'Welcome back'], ['wave', 'Hello there'], ['nod', 'Ready to begin'],
  ['pushup', 'Here goes'], ['stretch', 'Time to loosen up'], ['sit', 'Taking a seat']]) ordered(gesture!, text!, 'development')
for (const [gesture, text] of [['crouch', 'Starting the demonstration'], ['point', 'Over that way']]) ordered(gesture!, text!, 'evaluation')

// Delegated intentions explicitly request speech, rather than raw measurements
// selecting a phrase or a physical reaction in application code.
for (const [index, [text, context]] of [
  ['Could someone give me a hand?', 'The event agent requests a brief spoken request for assistance.'],
  ['That was a surprise!', 'The event agent requests a brief vocal reaction to the reported movement.'],
  ['Hello, everyone!', 'The event agent requests a greeting.'],
  ['I am here.', 'The event agent requests a short spoken acknowledgment.'],
  ['A little help, please.', 'The event agent requests a spoken call for help.'],
  ['What a ride!', 'The event agent requests an excited vocal response.'],
].entries()) {
  family(`voice-only-${index}`, [
    { instruction: `${context} Use the words "${text}". No body movement is requested.`,
      output: noTask() },
    { instruction: `${context} Discuss that proposal instead of performing it.`, output: noTask() },
  ], index < 4 ? 'development' : 'evaluation')
}

// A capture is a visual objective even when its accompanying speech or motion
// is straightforward and no image has been supplied yet.
const visualRequests = [
  ['Say a welcome, photograph the surroundings, bow, and finish standing.',
    'Wave once, capture a fresh camera frame, and say that the sequence has finished.',
    'Take a picture after a nod, then say hello and sit.',
    'Greet the visitors, get a new photograph, stretch out, and take the upright stance.'],
  ['Announce that you are beginning, take a snapshot, crouch, and rise again.',
    'Finish a pointing gesture, photograph the room, and give a short farewell.',
    'Say hello after taking a photograph, then perform a stretch and stand.',
    'Photograph the scene between two spoken announcements and end with a bow.'],
]
for (const [index, instructions] of visualRequests.entries()) {
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('intent', 'speech-program-visual-route', instructions, [], {
      ...intentOutput(['environment'], [], true, true), taskPlanner: 'vision',
    }, {}, index === 0 ? 'development' : 'evaluation')
    source.inputSource = inputSource
    source.fold = index
  }
}
