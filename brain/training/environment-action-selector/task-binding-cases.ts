import type { EnvironmentObservation } from '@metahuman/core'
import { addCase, noTask, task, TIME, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'

// Supervised request/evidence pairs, not runtime directions. Previously inspected
// qualification wording remains outside fitting. Every source/branch sibling
// stays in one fold, including both user and internally authored intentions.
interface Variant { instruction: string; output: Record<string, any> }
const body = bodyObservation() as EnvironmentObservation
body.capabilities.actions.push('move')
const observationHistory = [{
  observationId: 'binding-old-carton', interpretedAt: '2030-01-14T11:10:03.000Z',
  summary: 'A carton label is partly hidden by reflected light. The saved view does not establish its lettering.',
  uncertainties: ['The image predates the current request.'],
  frameIds: ['binding-old-frame'], frames: [{ id: 'binding-old-frame', timestamp: '2030-01-14T11:10:00.000Z' }],
}]
const capture = () => ({ kind: 'action', action: { type: 'captureImage' } })
const command = (name: string, units?: number) => ({ kind: 'action', action: {
  type: 'robotCommand', command: name, ...(units === undefined ? {} : { units, continuous: false }),
} })
function plan(objective: string, completionCriteria: string, steps: unknown[], visual = false) {
  return task(objective, steps, { completionCriteria,
    continuationPolicy: visual ? 'bounded' : 'none', requiredCompletionBasis: visual ? 'visual_observation' : 'action_result' })
}
let familyIndex = 0
function family(suite: string, variants: Variant[], split: CaseSplit,
  inputs: Record<string, unknown> = {}, fold = familyIndex++ % 4) {
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', suite, variants.map(value => value.instruction),
      ['needsAction', 'needsEnvironment', ...(inputs.robotStatus ? ['needsRobotStatus'] : [])], variants[0]!.output,
      { observation: body, observationHistory, ...inputs }, split)
    source.targets = Object.fromEntries(variants.map((value, index) => [index, value.output]))
    source.inputSource = inputSource
    source.fold = fold
  }
}

function demonstration(name: string, split: CaseSplit) {
  const gesture = plan(`Perform the ${name} gesture once.`,
    `The requested ${name} gesture has a correlated completion receipt.`, [command(name)])
  family(`binding-${split === 'evaluation' ? 'eval-' : ''}demonstration-${name}`, [
    { instruction: `I'd like to watch you perform a ${name}.`, output: gesture },
    { instruction: `Show us the ${name} gesture with your body.`, output: gesture },
    { instruction: `Take a photograph of the drawing of a ${name} on the display card.`,
      output: plan(`Photograph the drawing of a ${name} on the display card.`,
        'The requested capture has completed and its image has been returned.', [capture()]) },
    { instruction: `Describe the ${name} gesture to me in words.`, output: noTask() },
    { instruction: `Read out the words "show us the ${name} gesture".`, output: noTask() },
    { instruction: `Perform the ${name} gesture once and then take a photograph.`,
      output: plan(`Perform the ${name} gesture and then capture a photograph.`,
        `The ${name} gesture and subsequent capture have completed with correlated results and the image has been returned.`,
        [command(name), capture()]) },
  ], split)
}
for (const name of ['bow', 'wave', 'nod', 'pushup']) demonstration(name, 'development')

function condition(low: string, high: string, threshold: number, split: CaseSplit) {
  const fold = familyIndex++ % 4
  for (const voltage of [threshold - .1, threshold, threshold + .1].map(value => Number(value.toFixed(1)))) {
    const chosen = voltage <= threshold ? low : high
    const selected = plan(`Perform ${chosen} according to the requested battery-voltage condition.`,
      `The selected ${chosen} has a correlated completion receipt.`, [command(chosen)])
    family(`binding-${split === 'evaluation' ? 'eval-' : ''}condition-${low}-${high}`, [
      { instruction: `If the reported battery voltage is at most ${threshold} volts, perform ${low}; otherwise perform ${high}.`, output: selected },
      { instruction: `Perform ${high} if the reported battery voltage is above ${threshold} volts; otherwise perform ${low}.`, output: selected },
      { instruction: `Only perform ${low} if the reported battery voltage is at most ${threshold} volts.`,
        output: voltage <= threshold ? selected : noTask() },
      { instruction: `Perform both ${low} and ${high}, in that order, regardless of the reported voltage.`,
        output: plan(`Perform ${low} followed by ${high}.`,
          `The ${low} and subsequent ${high} each have correlated completion receipts.`, [command(low), command(high)]) },
    ], split, { robotStatus: { updatedAt: TIME,
      body: { sessionId: body.sessionId, battery: { voltage, observedAt: TIME } } } }, fold)
  }
}
condition('bow', 'pushup', 6.8, 'development')
condition('wave', 'bow', 8.1, 'development')

function visual(target: string, finding: string, direction: 'left' | 'right', cycles: number, split: CaseSplit) {
  const objective = `Determine from a new photograph ${finding}.`
  const criteria = `A new photograph shows the ${target} clearly enough to establish ${finding}.`
  family(`binding-${split === 'evaluation' ? 'eval-' : ''}visual-${target.replaceAll(' ', '-')}`, [
    { instruction: `Turn ${direction} for ${cycles} gait cycles without using the camera.`,
      output: plan(`Turn ${direction} for ${cycles} gait cycles without using the camera.`,
        `The requested ${cycles}-cycle turn has a correlated completion receipt.`, [command(direction, cycles)]) },
    { instruction: `Take a new photograph to determine ${finding}; keep your current position.`,
      output: plan(objective, criteria, [capture()], true) },
    { instruction: `Turn ${direction} for ${cycles} gait cycles, then photograph the ${target} to establish ${finding}.`,
      output: plan(`Turn ${direction} for ${cycles} gait cycles and determine from a new photograph ${finding}.`,
        criteria, [command(direction, cycles), capture()], true) },
    { instruction: `Turn ${direction} until the ${target} is visible, then take a photograph to determine ${finding}.`,
      output: plan(`Turn ${direction} until the ${target} is visible and determine from a new photograph ${finding}.`,
        criteria, [{ kind: 'behavior', target,
          completionCriteria: `The ${target} is visible in a new camera observation.`,
          motion: { type: 'move', direction: 'forward', continuous: true, forward: 0,
            turn: direction === 'left' ? 25 : -25, speed: 25 },
          candidateLabels: [], identifyEveryFrames: 10, steering: null,
        }, capture()], true) },
  ], split)
}
visual('jar seal', 'whether the jar seal is intact or broken', 'left', 2, 'development')
visual('socket indicator', 'whether the socket indicator is lit or unlit', 'right', 1, 'development')
visual('meter needle', 'whether the meter needle is above or below the marked line', 'left', 3, 'development')

// New qualification subjects and command combinations; never fit or use these
// to choose a checkpoint. Prior qualification cases remain unchanged as well.
for (const name of ['stretch', 'shrug']) demonstration(name, 'evaluation')
condition('sit', 'pushup', 7.3, 'evaluation')
visual('cabinet catch', 'whether the cabinet catch is engaged or released', 'right', 4, 'evaluation')
