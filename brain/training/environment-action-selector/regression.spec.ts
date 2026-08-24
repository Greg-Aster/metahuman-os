import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEnvironmentSelectorEnvelope,
  validateEnvironmentSelectorOutput,
  type EnvironmentModelOutput,
  type EnvironmentObservation,
} from '@metahuman/core'
import { environmentActionParserNode } from '@metahuman/core/nodes'

import { ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES } from './development-cases.js'

const regressionId = 'boredom-spiky-friend-head-tilt'
const instruction = 'A fresh autonomous camera image shows a small fuzzy teal spiky friend. Decide whether one curious head tilt should be treated as expression or as an attempt to gain a new view.'
const observation: EnvironmentObservation = {
  environmentId: 'regression-robot',
  adapter: 'sanitized-fixture-adapter',
  sessionId: 'regression-session',
  timestamp: '2030-01-15T12:00:00.000Z',
  state: {},
  capabilities: {
    actions: ['robotCommand', 'robotMotionPlan', 'captureImage'],
    robotCommands: ['turn_right_90', 'turn_left_90'],
    motionClasses: ['body_local', 'open_loop_displacement'],
    movement: true,
    visual: true,
  },
  visual: {
    id: 'spiky-friend-frame',
    timestamp: '2030-01-15T12:00:00.000Z',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    metadata: { correlationId: 'spiky-friend-cycle' },
  },
  metadata: {
    correlationId: 'spiky-friend-cycle',
    robotObserver: {
      cycleId: 'spiky-friend-cycle',
      step: 1,
      triggerSource: 'autonomy',
      graph: 'environment',
      requestedBy: 'boredom-observer',
    },
  },
}
const expected: EnvironmentModelOutput = {
  response: 'I will make one curious head tilt and inspect the returned view.',
  actions: [],
  movementRequest: { description: 'Tilt the head gently toward the visible object.' },
  taskDecision: {
    objective: 'Inspect the visible object from a slightly different viewpoint.',
    outcome: 'act',
    reason: 'The motion is intended to gain a different view, not merely to express curiosity.',
    objectiveComplete: false,
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
    motionClass: 'body_local',
    actionPurpose: 'information_gain',
    observationSummary: 'A small fuzzy teal spiky toy is visible in the current robot-camera image.',
    visualEvidenceMode: 'single',
  },
}

test('the spiky-friend head-tilt regression exercises the generic information-gain contract only', async () => {
  assert.equal(
    ENVIRONMENT_ACTION_SELECTOR_DEVELOPMENT_CASES.some(value => value.id === regressionId),
    false,
    'the exact regression must remain outside development training data',
  )

  const validation = validateEnvironmentSelectorOutput(JSON.stringify(expected), observation.sessionId)
  assert.equal(validation.valid, true, validation.errors.join('; '))
  assert.equal(validation.value?.taskDecision.actionPurpose, 'information_gain')
  assert.equal(validation.value?.taskDecision.requiredCompletionBasis, 'visual_observation')
  assert.equal('presentation' in (validation.value?.taskDecision ?? {}), false)

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify(expected),
    observation,
    sessionId: observation.sessionId,
  }, {} as never, {} as never)
  assert.equal(parsed.valid, true)
  assert.equal(parsed.movementRequest?.description, 'Tilt the head gently toward the visible object.')

  const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ instruction, observation }))
  assert.equal(envelope.inputSource, 'autonomy')
  assert.deepEqual(envelope.currentEnvironment.capabilities.actions, observation.capabilities.actions)
  assert.equal(envelope.taskState, null)
})
