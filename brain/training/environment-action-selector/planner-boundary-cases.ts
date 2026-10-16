import { addCase, action, task, noTask, intentOutput, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Synthetic role-boundary contrasts. Recorded failures and existing evaluation
// requests stay out of fitting. Source and wording siblings share a fold.
const capture = { kind: 'action', action: { type: 'captureImage' } }
function family(gesture: string, phrase: string, index: number, split: CaseSplit) {
  const gesturePlan = task(`Perform the requested ${gesture} demonstration.`, [action(gesture)])
  const variants = [
    { instruction: `Demonstrate ${gesture}; leave photography out of this request.`, output: gesturePlan },
    { instruction: `I will watch you do ${gesture}. Only perform the gesture.`, output: gesturePlan },
    { instruction: `No image acquisition is requested. Perform ${gesture} once.`, output: gesturePlan },
    { instruction: `Perform ${gesture}, with no camera capture or visual analysis.`, output: gesturePlan },
    { instruction: `Say "${phrase}", perform ${gesture}, and stand, leaving the camera unused.`,
      output: task(`Perform ${gesture}, then stand.`, [action(gesture), action('stand')]) },
    { instruction: `Say "${phrase}"; capture the surroundings; do ${gesture}; finish upright.`,
      output: task(`Photograph the surroundings, perform ${gesture}, then stand.`, [capture, action(gesture), action('stand')]) },
    { instruction: `Begin with ${gesture}, obtain an image, and then say "${phrase}".`,
      output: task(`Perform ${gesture} and capture a photograph.`, [action(gesture), capture]) },
    { instruction: `Explain this sentence without performing it: "Say ${phrase}, photograph the room, and perform ${gesture}."`, output: noTask() },
    { instruction: `Speak the words "${phrase}". No motion or photograph is requested.`,
      output: noTask() },
  ]
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', `planner-boundary-${gesture}`, variants.map(v => v.instruction),
      ['needsAction', 'needsEnvironment'], variants[0]!.output, { observation: bodyObservation() }, split)
    source.targets = Object.fromEntries(variants.map((v, i) => [i, v.output]))
    source.inputSource = inputSource; source.fold = index % 4
    const intentVariants = variants.map((v, i) => ({ instruction: v.instruction,
      output: { ...intentOutput(i >= 7 ? [] : ['environment'], [], i >= 4, i < 7),
        taskPlanner: i === 5 || i === 6 ? 'vision' : 'specialist' } }))
    const routing = addCase('intent', `planner-boundary-${gesture}`, intentVariants.map(v => v.instruction), [], intentVariants[0]!.output, {}, split)
    routing.targets = Object.fromEntries(intentVariants.map((v, i) => [i, v.output]))
    routing.inputSource = inputSource; routing.fold = index % 4
  }
}
for (const [index, [gesture, phrase]] of [['bow', 'Welcome to the workshop'], ['wave', 'Nice to see everyone'],
  ['nod', 'The demonstration starts now'], ['pushup', 'Ready for the activity'],
  ['stretch', 'A new session begins'], ['sit', 'Let us get started'],
  ['rest', 'Taking a break'], ['lay_down', 'Settling down now'],
  ['crouch', 'Here is the next pose'], ['point', 'Please look over there']].entries()) {
  family(gesture!, phrase!, index, index < 8 ? 'development' : 'evaluation')
}
