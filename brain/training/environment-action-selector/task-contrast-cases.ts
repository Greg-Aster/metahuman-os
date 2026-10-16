import type { EnvironmentObservation } from '@metahuman/core'
import { addCase, noTask, task, TIME, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Supervised data only. Related requests see the same capability/evidence
// envelope, including the same imperfect upstream action hint. Their labels
// depend on the request and supplied facts, not a runtime keyword rule.
interface Variant { instruction: string; output: Record<string, any> }
const body = bodyObservation() as EnvironmentObservation
body.state = { posture: null, cameraReady: true }
const history = [
  { summary: 'A carton on a shelf has a reflective label; its lettering is not legible in this saved image.',
    uncertainties: ['No later view of the carton is supplied.'], frameIds: ['contrast-carton-frame'],
    frames: [{ id: 'contrast-carton-frame', timestamp: '2030-01-14T09:00:00.000Z' }],
    interpretedAt: '2030-01-14T09:00:03.000Z', observationId: 'contrast-carton' },
  { summary: 'A stool partially obscures a bag below a desk. The rear wall is outside this saved image.',
    uncertainties: ['The bag contents are not visible.'], frameIds: ['contrast-bag-frame'],
    frames: [{ id: 'contrast-bag-frame', timestamp: '2030-01-14T10:00:00.000Z' }],
    interpretedAt: '2030-01-14T10:00:03.000Z', observationId: 'contrast-bag' },
]
const capture = () => ({ kind: 'action', action: { type: 'captureImage' } })
const command = (name: string, units?: number) => ({ kind: 'action', action: {
  type: 'robotCommand', command: name, ...(units !== undefined ? { units, continuous: false } : {}),
} })
function plan(objective: string, completionCriteria: string, steps: unknown[], visual = false) {
  return task(objective, steps, { completionCriteria,
    reason: 'This program follows the activities selected by the current instruction.',
    continuationPolicy: visual ? 'bounded' : 'none', requiredCompletionBasis: visual ? 'visual_observation' : 'action_result' })
}
let familyIndex = 0
function addFamily(suite: string, variants: Variant[], split: CaseSplit = 'development',
  inputs: Record<string, unknown> = {}, fold = familyIndex++ % 4) {
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', suite, variants.map(variant => variant.instruction),
      ['needsAction', 'needsEnvironment', ...(inputs.robotStatus ? ['needsRobotStatus'] : [])],
      variants[0]!.output, { observation: body, observationHistory: history, ...inputs }, split)
    source.targets = Object.fromEntries(variants.map((variant, index) => [index, variant.output]))
    source.inputSource = inputSource
    source.fold = fold
  }
  return fold
}

const bow = () => plan('Perform one bow.', 'The requested bow has a correlated completion receipt.', [command('bow')])
const wave = () => plan('Perform one wave.', 'The requested wave has a correlated completion receipt.', [command('wave')])
const nodWave = () => plan('Perform a nod followed by a wave.',
  'The nod and following wave each have correlated completion receipts.', [command('nod'), command('wave')])
addFamily('contrast-language-description', [
  { instruction: 'Describe a bow in words.', output: noTask() },
  { instruction: 'Perform one bow.', output: bow() },
  { instruction: 'Explain what bowing means without moving.', output: noTask() },
  { instruction: 'Bow once and explain the gesture.', output: bow() },
])
addFamily('contrast-language-catalog', [
  { instruction: 'Tell me which movements are listed in your catalog.', output: noTask() },
  { instruction: 'Do a nod followed by a wave.', output: nodWave() },
  { instruction: 'Name the listed gestures without demonstrating them.', output: noTask() },
  { instruction: 'Demonstrate nodding and then waving.', output: nodWave() },
])
addFamily('contrast-language-conversation', [
  { instruction: 'Tell me something you have been considering.', output: noTask() },
  { instruction: 'Give a wave while telling me something you have been considering.', output: wave() },
  { instruction: 'Describe an idea you have been thinking about.', output: noTask() },
  { instruction: 'Wave once and then describe an idea you have been thinking about.', output: wave() },
])
addFamily('contrast-language-quotation', [
  { instruction: 'Read the phrase "perform one bow" aloud.', output: noTask() },
  { instruction: 'Carry out this request: "perform one bow".', output: bow() },
  { instruction: 'Explain the instruction "nod, then wave".', output: noTask() },
  { instruction: 'Execute the instruction "nod, then wave".', output: nodWave() },
])

// The same visual target appears in capture-only and compound requests. The
// movement-only sibling has no implicit camera or visual-success requirement.
for (const [name, direction, target, finding] of [
  ['latch', 'left', 'the latch on the red case', 'whether the latch is fastened'],
  ['indicator', 'right', 'the indicator on the charger', 'which indicator light is illuminated'],
  ['handle', 'left', 'the handle on the kettle', 'whether the handle is raised or folded'],
] as const) {
  const criteria = `A new image of ${target} establishes ${finding}.`
  addFamily(`contrast-sequence-${name}`, [
    { instruction: `Turn ${direction} for one cycle.`,
      output: plan(`Turn ${direction} for one cycle.`, 'The requested turn has a correlated completion receipt.', [command(direction, 1)]) },
    { instruction: `Take a new photograph of ${target} and establish ${finding}.`,
      output: plan(`Obtain a new photograph of ${target} and establish ${finding}.`, criteria, [capture()], true) },
    { instruction: `Turn ${direction} for one cycle, then photograph ${target} to establish ${finding}.`,
      output: plan(`Turn ${direction} for one cycle and obtain a new photograph of ${target} establishing ${finding}.`,
        criteria, [command(direction, 1), capture()], true) },
    { instruction: `After one cycle turning ${direction}, get a new view of ${target} that establishes ${finding}.`,
      output: plan(`Turn ${direction} for one cycle and obtain a new photograph of ${target} establishing ${finding}.`,
        criteria, [command(direction, 1), capture()], true) },
  ])
}

function conditions(suite: string, threshold: number, low: string, high: string, split: CaseSplit) {
  const fold = familyIndex++ % 4
  for (const voltage of [threshold - .2, threshold, threshold + .2].map(value => Number(value.toFixed(1)))) {
    const selected = voltage < threshold ? low : high
    const choice = plan(`Perform ${selected} according to the requested voltage condition.`,
      `The requested ${selected} has a correlated completion receipt.`, [command(selected)])
    const inputs = { robotStatus: { updatedAt: TIME,
      body: { sessionId: body.sessionId, battery: { voltage, observedAt: TIME } } } }
    addFamily(suite, [
      { instruction: `If the reported voltage is below ${threshold}, ${low}; otherwise ${high}.`, output: choice },
      { instruction: `Choose ${low} for a reported voltage less than ${threshold}, or ${high} for a voltage at or above ${threshold}.`, output: choice },
      { instruction: `Only if the reported voltage is below ${threshold}, ${low}.`,
        output: voltage < threshold ? choice : noTask() },
      { instruction: `Perform ${low} followed by ${high}.`,
        output: plan(`Perform ${low} followed by ${high}.`,
          `Both ${low} and the following ${high} have correlated completion receipts.`, [command(low), command(high)]) },
    ], split, inputs, fold)
  }
}
conditions('contrast-condition-wave-sit', 7.2, 'wave', 'sit', 'development')
conditions('contrast-condition-nod-stand', 7.6, 'nod', 'stand', 'development')

// Fresh qualification: not the wording, subjects or conditional combinations
// already inspected in task-goals-20261011. No fit or epoch selection uses these.
addFamily('contrast-eval-language', [
  { instruction: 'What does your nodding motion look like?', output: noTask() },
  { instruction: 'Show your nodding motion once.', output: plan('Perform one nod.',
    'The nod has a correlated completion receipt.', [command('nod')]) },
  { instruction: 'Give a verbal inventory of your gestures.', output: noTask() },
  { instruction: 'Perform a wave and then sit down.', output: plan('Wave and then sit.',
    'The wave and subsequent sit have correlated completion receipts.', [command('wave'), command('sit')]) },
  { instruction: 'What possibilities have you been mulling over?', output: noTask() },
  { instruction: 'Tell me how the phrase "sit after waving" should be interpreted.', output: noTask() },
], 'evaluation')
addFamily('contrast-eval-sequence', [
  { instruction: 'Rotate left for two cycles and get a photograph that shows whether the toolbox lid is open.',
    output: plan('Turn left for two cycles and determine from a new photograph whether the toolbox lid is open.',
      'A new image after the turn clearly establishes whether the toolbox lid is open.', [command('left', 2), capture()], true) },
  { instruction: 'Photograph the toolbox to establish whether its lid is open, without repositioning.',
    output: plan('Determine whether the toolbox lid is open from a new photograph without moving.',
      'A new image clearly establishes whether the toolbox lid is open.', [capture()], true) },
  { instruction: 'Turn left for two cycles without taking a picture.',
    output: plan('Turn left for two cycles without taking a picture.',
      'The requested two-cycle turn has a correlated completion receipt.', [command('left', 2)]) },
], 'evaluation')
conditions('contrast-eval-condition', 7.9, 'sit', 'nod', 'evaluation')
