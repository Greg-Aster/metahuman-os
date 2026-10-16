import { addCase, action, task, noTask, intentOutput, TIME } from './development-cases.js'
import { createHash } from 'node:crypto'

// Public command meanings from the bridge interface; fixture identity and state are synthetic.
const catalog = {
  "backward": "walk backward; continuous=true runs until stopped; optional speed or stride and rate controls",
  "bow": "lower the front body into a sustained bow, then return to stand",
  "celebrate": "lower into a full-body pose and wave all four legs, then return to stand",
  "crab": "ongoing wide-stance sideways left; supports Speed, stride, cadence and Finish",
  "crab_backward": "ongoing wide-stance backward; supports Speed, stride, cadence and Finish",
  "crab_forward": "ongoing wide-stance forward; supports Speed, stride, cadence and Finish",
  "crab_right": "ongoing wide-stance sideways right; supports Speed, stride, cadence and Finish",
  "crab_turn_left": "ongoing wide-stance turning left; supports Speed, stride, cadence and Finish",
  "crab_turn_right": "ongoing wide-stance turning right; supports Speed, stride, cadence and Finish",
  "crawl": "walk continuously with the body low above the floor; supports direction, Speed, stride and cadence",
  "crouch": "squat on all four feet and hold the body above the floor",
  "curious": "perform the preprogrammed left-right scanning and curious pose motion",
  "cute": "move into a low expressive pose and wave the rear legs, then return to stand",
  "dance": "alternate paired legs in a rhythmic dance, then return to stand",
  "dead": "collapse into Play Dead with outstretched front arms and grounded lower legs; hold",
  "freaky": "move into a low asymmetric pose and pulse one leg, then return to stand",
  "lay_down": "lower into the grounded wide lying pose and hold; distinct from Rest and Play Dead",
  "left": "ongoing gait turn left; supports Speed, stride, cadence and Finish; optional units choose finite cycles",
  "neutral": "move into the body-control neutral pose",
  "nod": "perform the preprogrammed shallow nodding gesture, then return to stand",
  "point": "hold an asymmetric pointing pose, then return to stand",
  "pushup": "lower the front body for repeated push-ups, then return to stand",
  "rest": "move into the preprogrammed rest pose",
  "right": "ongoing gait turn right; supports Speed, stride, cadence and Finish; optional units choose finite cycles",
  "run": "bound with front and rear leg pairs; automatic Speed above 100 to 200 selects Run, 0 finishes",
  "sad": "hold and sway through a lowered sad pose, then return to stand",
  "shake": "shake the rear leg pair, then return to stand",
  "shrug": "sit, lift and open the front arms in a shrug, then return to standing",
  "sit": "lower into the preprogrammed held sitting pose",
  "stand": "stand normally on all four feet",
  "stop": "stop the current body motion",
  "stretch": "extend diagonal and front leg pairs in a stretch, then return to stand",
  "surprised": "lower into a flat pose and wave the front legs, then return to stand",
  "swim": "paddle the upper leg joints in a swimming-like motion, then return to stand",
  "upright": "experimental motion: sit, brace the front legs backward, then rise onto the rear lower legs and hold upri",
  "walk": "walk forward; continuous=true runs until stopped; optional speed or stride and rate controls",
  "wave": "raise and wave one leg, then return to stand",
  "worm": "two slow, deep whole-body waves, then return to standing"
}

export function bodyObservation() {
  return { adapter: 'synthetic-body', environmentId: 'training-room', sessionId: 'training-body', timestamp: TIME,
    capabilities: { actions: ['robotCommand', 'captureImage', 'stop', 'faceExpression'],
      robotCommands: Object.keys(catalog), robotCommandDescriptions: catalog,
      movement: true, visual: true,
      expressionLibrary: Object.keys(catalog).map(name => ({ name, label: name, group: 'Expressions' })),
    },
    state: { body: { robotId: 'training-body', authenticated: true, motionAvailable: true },
      posture: 'stand', gateway: { selectedRobot: { robot_id: 'training-body', model: 'v2-12servo',
        commandedPose: { reference: 'stand', sourceActionId: 'prior-command', updatedAt: TIME },
        posture: null,
      } },
    },
  }
}
const meanings = [
  ['rest', ['Settle into your built-in resting pose.', 'Take the programmed resting stance.', 'Move your body to its rest posture.', 'Adopt the standard resting position.']],
  ['lay_down', ['Lower yourself into the lying pose.', 'Lie flat on the ground and hold.', 'Adopt the grounded lying posture.', 'Settle your body all the way down.']],
  ['stand', ['Return your body to the normal standing stance.', 'Rise onto all four feet.', 'Take the standard standing pose.', 'Hold your usual four-legged stance.']],
  ['sit', ['Lower into your seated stance.', 'Take your programmed sitting position.', 'Adopt a sitting posture now.', 'Settle onto your seated pose.']],
] as const
const scenes = [
  'The camera faces a workshop floor with a wooden bench to the left and a closed storage cabinet to the right. A power cable runs behind the bench. The doorway is open, but the area beyond it is outside the image. The lower edge shows part of a front limb. No view of the other limbs is available.',
  'The view faces a shelving unit holding boxes and small containers. The nearest floor surface is visible below the shelf, with a rectangular mat beside a chair. The chair partially occludes the area behind it. The camera angle has changed since the previous frame; the image alone does not identify what moved.',
  'A table occupies the upper half of the image. Underneath it are chair legs, a dark bag and a bright patch of sunlight. Reflections make the edge of the bag difficult to distinguish from the floor. The robot body is outside the frame, so a physical body posture cannot be established from this image.',
  'The image shows a hallway with a rug and two closed doors. The far end is darker than the foreground. A small object lies near the right wall, but its identity is unclear. This is a saved frame from a previous request; no new frame or physical pose measurement accompanies the current instruction.',
  'The camera points toward a desk with a monitor, a keyboard and several tools. A window produces glare behind the monitor. The floor is visible only at the edges of the desk. Small objects under the desk cannot be identified from this angle. There is no correlated measurement of the robot joints in this frame.',
  'A storage area fills the frame. Cardboard boxes are stacked against one wall and a folded chair stands beside them. A clear patch of floor is visible in front of the boxes. The top of the image is blurred. This interpretation records visible objects and does not establish any current action outcome.',
  'The view is low and faces a door threshold. The doorway and adjoining wall are visible, with a floor mat extending through the opening. The image has a slight tilt. There is no joint telemetry in the image and no reliable basis for inferring the robot posture solely from the camera angle.',
  'The latest saved image faces the workbench again. The bench legs and a nearby stool are visible. A container sits near the far wall. The floor is partly obscured by the bench. The image retains its original capture time; it is not a fresh observation of the new request or its result.',
]
const observationHistory = scenes.map((summary, index) => {
  const executionId = createHash('sha256').update(`synthetic-observation-${index}`).digest('hex')
  const frameId = `fixture-camera-frame-${executionId}`
  return { summary, frameIds: [frameId], uncertainties: ['Current posture is not measured by this saved frame.'],
    observationId: `${executionId}:visual-observation`, executionId, occurrenceId: `${executionId}:interpretation`,
    environmentId: 'training-room', adapter: 'synthetic-body', sessionId: 'training-body', robotId: 'training-body',
    interpretedAt: `2030-01-14T12:0${index}:05.000Z`,
    frames: [{ id: frameId, timestamp: `2030-01-14T12:0${index}:00.000Z`, actionId: `capture-${executionId}` }],
  }
})
for (const [command, texts] of meanings) {
  const inputs = { observation: bodyObservation() }
  const family = addCase('task', 'body-posture-catalog', [...texts], ['needsAction', 'needsEnvironment'],
    task(`Execute the requested ${command} posture.`, [action(command)]), inputs)
  addCase('intent', 'body-posture-routing', [...texts], [],
    intentOutput(['environment'], ['persona.personality'], true, true))
  // Conflicting prior activity is independently selected evidence, not the new instruction.
  addCase('task', 'body-posture-prior-activity', texts.map(text => `${text} This is a new request.`),
    ['needsAction', 'needsEnvironment', 'needsRobotStatus'],
    task(`Execute the requested ${command} posture.`, [action(command)]), {
      ...inputs, robotStatus: { updatedAt: TIME, situation: { currentGoal: 'Stand up', currentIntent: 'Maintain the standing pose' },
        live: { executions: [{ executionId: 'earlier-request', objective: 'Stand up', status: 'waiting' }],
          movement: { commanded: { name: 'stand' }, measuredPhysicalMotion: { available: false } } } },
    }).fold = family.fold
  addCase('task', 'body-posture-observation-history', texts.map(text => `Right now, ${text.toLowerCase()}`),
    ['needsAction', 'needsEnvironment'], task(`Execute the requested ${command} posture.`, [action(command)]),
    { ...inputs, observationHistory }).fold = family.fold
}
const discussion = ['Explain what the rest posture means without moving.',
  'What distinguishes lying down from resting? Do not perform either.',
  'Rewrite the rest of this sentence: the robot stood.',
  'Discuss resting positions; keep your current pose.']
addCase('task', 'posture-discussion', discussion, ['needsResponse'], noTask(), { observation: bodyObservation() })
addCase('intent', 'posture-discussion', discussion, [], intentOutput([], ['persona.personality']))
// Separate wording is kept out of the fit. These include the reported live failures.
for (const [command, texts] of [
  ['rest', ['Please rest.', 'I would like you to do the rest position.']],
  ['lay_down', ['Please lie down.', 'Could you get flat against the floor?']],
  ['stand', ['Please stand up', 'Get back onto your four feet.']],
] as const) {
  addCase('task', 'posture-live-regression', [...texts], ['needsAction', 'needsEnvironment'],
    task(`Execute ${command}.`, [action(command)]), { observation: bodyObservation() }, 'evaluation')
  addCase('intent', 'posture-live-regression', [...texts], [], intentOutput(['environment'], ['persona.personality'], true, true), {}, 'evaluation')
}
