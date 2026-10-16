import { addCase, noTask, task, TIME, type CaseSplit } from './development-cases.js'
import { bodyObservation } from './posture-cases.js'
import type { EnvironmentObservation } from '@metahuman/core'

// Synthetic supervised examples, not runtime policies. Directions below come
// from the request; free-choice regression plans are reference answers only.
// Equivalent plans remain eligible for the existing semantic/grounding review.
const body: EnvironmentObservation = bodyObservation() as EnvironmentObservation
body.capabilities.actions.push('move')
body.state = { posture: null, cameraReady: true }
const capture = () => ({ kind: 'action', action: { type: 'captureImage' } })
const command = (name: string, units?: number) => ({ kind: 'action', action: {
  type: 'robotCommand', command: name, ...(units !== undefined ? { units, continuous: false } : {}),
} })

// Dated, synthetic evidence exercises the same selected-context path as live
// tasks. It is not an observation of the new request's result.
const observationHistory = [
  'A shelf holds cardboard boxes. The labels face the camera, but reflected light obscures the lettering. The view does not establish what is written on them.',
  'The camera faces a workbench. Tool cases occupy its lower shelf, with labels at different angles. The nearest case is partly occluded by a stool leg.',
  'A marker lies on the floor beside a table. Its colored body is visible, but its printed identification cannot be read at this distance.',
  'A cable runs behind a box. Its far connector is outside the frame, so the image cannot establish whether that end is plugged into anything.',
  'A desk lamp illuminates a container. Glare hides part of its surface. The image does not show all sides or prove that a later camera adjustment has occurred.',
].map((summary, index) => ({ summary, uncertainties: ['This saved image predates the current intention.'],
  frameIds: [`goal-fixture-frame-${index}`], observationId: `goal-fixture-observation-${index}`,
  interpretedAt: `2030-01-14T12:0${index}:05.000Z`,
  frames: [{ id: `goal-fixture-frame-${index}`, timestamp: `2030-01-14T12:0${index}:00.000Z` }],
}))

let familyIndex = 0
function add(suite: string, instructions: string[], output: Record<string, any>, split: CaseSplit = 'development') {
  const fold = familyIndex++ % 4
  for (const inputSource of ['user', 'autonomy'] as const) {
    const source = addCase('task', suite, instructions,
      [output.program ? 'needsAction' : 'needsResponse', 'needsEnvironment'], output,
      { observation: body, observationHistory }, split)
    source.inputSource = inputSource
    // The same intention with different attribution is one fold family.
    source.fold = fold
  }
}
function goal(objective: string, completionCriteria: string, steps: unknown[],
  requiredCompletionBasis: 'action_result' | 'visual_observation' | 'environment_state' = 'visual_observation') {
  return task(objective, steps, { completionCriteria,
    reason: 'The program requests the activity; its results will provide evidence for the stated objective.',
    continuationPolicy: requiredCompletionBasis === 'action_result' ? 'none' : 'bounded', requiredCompletionBasis })
}

add('goal-movement-capture', [
  'Turn left for one cycle, then take a picture to check whether the shelf labels are readable.',
  'Make one left-turn cycle and photograph the shelf; I want to know whether its labels can be read.',
  'After one cycle turning left, capture a view in which the shelf labels can be checked for legibility.',
], goal('Turn left for one cycle and obtain a view with readable shelf labels.',
  'A new image after the turn shows legible lettering on the shelf labels.', [command('left', 1), capture()]))
add('goal-movement-capture', [
  'Move sideways right for one cycle, then photograph the workbench so the tool labels are visible.',
  'Use one rightward sideways gait cycle and take a picture to inspect the workbench tool labels.',
  'Shift right by one sideways cycle and get a new view showing the labels on the workbench tools.',
], goal('Shift right for one cycle and obtain a picture showing the workbench tool labels.',
  'A new image from the shifted viewpoint shows the tool labels clearly.', [command('crab_right', 1), capture()]))
add('goal-movement-capture', [
  'Walk forward for two gait cycles, then take a picture to identify the marker beside the table.',
  'Advance two walking cycles and photograph the marker by the table so its identification can be read.',
  'After two forward gait cycles, capture a view that lets us identify the marker beside the table.',
], goal('Advance two walking cycles and obtain a view that identifies the marker beside the table.',
  'A new image after the advance makes the marker identification readable.', [command('walk', 2), capture()]))
add('goal-visual-only', [
  'Photograph the box and check whether its label is legible.',
  'Take a new picture so we can read the lettering on the box.',
  'Get a fresh view of the box label and determine what it says.',
], goal('Obtain a new image with readable lettering on the box label.',
  'The new image supports reading the box label, rather than merely confirming a capture.', [capture()]))
add('goal-visual-only', [
  'Take a picture of the cable connection and determine whether it is plugged in.',
  'Get a fresh view that establishes whether the cable connector is attached.',
  'Photograph the connection so we can establish whether the cable is plugged into the socket.',
], goal('Determine from a new image whether the cable is plugged into the socket.',
  'A new image shows the connector and socket clearly enough to establish whether they are connected.', [capture()]))
add('goal-reported-state', [
  'Stand up and check whether the reported body state says upright.',
  'Take the standing pose, then verify that the body reports an upright state.',
  'Stand and confirm the resulting reported posture is upright.',
], goal('Stand and confirm the resulting reported body posture is upright.',
  'A body-state report after the stand command records an upright posture.', [command('stand')], 'environment_state'))
add('goal-finite-sequence', [
  'Bow once and then take a photograph.',
  'After one bow, capture a new image.',
  'Perform a bow followed by a camera capture.',
], goal('Perform one bow followed by one camera capture.',
  'The bow and subsequent capture have completed with their correlated results and returned image.',
  [command('bow'), capture()], 'action_result'))
add('goal-finite-capture', [
  'Take a single photograph without moving.',
  'Capture one image and leave the body in its current position.',
  'Get one camera frame; no body movement is requested.',
], goal('Capture one new image without moving the body.',
  'One capture has completed and its correlated image has been returned.', [capture()], 'action_result'))
add('goal-open-search', [
  'Locate the orange container and obtain a picture that lets us read its label.',
  'Find the orange container and photograph its label clearly enough to read it.',
  'Get a readable label image from the orange container after locating it.',
], goal('Locate the orange container and obtain a readable image of its label.',
  'A new image of the located orange container makes its label legible.', [{
    kind: 'behavior', target: 'orange container', completionCriteria: 'The orange container is visible.',
    motion: { type: 'move', direction: 'forward', continuous: true, forward: 0, turn: 25, speed: 25 },
    candidateLabels: [], identifyEveryFrames: 10, steering: null,
  }, capture()]))
add('goal-discussion', [
  'Explain camera glare without moving or taking a photograph.',
  'Describe how an angle change affects glare; do not move or capture an image.',
  'Discuss readable labels in photographs without performing any actions.',
], noTask())

// Unseen subjects and combinations, separate from fitting and the reported case.
add('goal-unseen-evaluation', [
  'Turn right for two cycles, then take a photo to read the serial number on the storage bin.',
  'After two right-turn cycles, obtain an image where the storage bin serial number is readable.',
], goal('Turn right for two cycles and obtain a readable image of the storage bin serial number.',
  'The new image after the turn makes the storage bin serial number legible.',
  [command('right', 2), capture()]), 'evaluation')
add('goal-unseen-evaluation', [
  'Take a new picture and determine whether the drawer is open or closed.',
  'Photograph the drawer so its open or closed state can be established.',
], goal('Determine from a new picture whether the drawer is open or closed.',
  'The new image clearly establishes the drawer state.', [capture()]), 'evaluation')

// Sanitized reproduction. The exact private live input remains in the local
// diagnostic record, never in the fit or published corpus.
add('goal-live-regression', [
  'Reposition camera angle to reduce glare and capture a clearer view of the items beside the desk lamp.',
], goal('Reposition the camera and obtain a clearer, lower-glare view of the items beside the desk lamp.',
  'A new view after repositioning shows the items beside the desk lamp with reduced glare.', [{
    kind: 'behavior', target: 'items beside the desk lamp',
    completionCriteria: 'A changed camera angle shows the items with reduced glare.',
    motion: { type: 'move', direction: 'forward', continuous: true, forward: 0, turn: 25, speed: 25 },
    candidateLabels: [], identifyEveryFrames: 10, steering: null,
  }]), 'regression')
