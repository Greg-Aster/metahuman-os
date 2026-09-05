import assert from 'node:assert/strict'
import test from 'node:test'

import type { EnvironmentObservation } from '../../environment-interface/index.js'
import { environmentContextBuilderNode } from './context-builder.node.js'
import { environmentImageInputNode } from './image-input.node.js'
import { buildEnvironmentSelectorJsonSchema } from './helpers.js'

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k='

function observation(): EnvironmentObservation {
  return {
    environmentId: 'robot-environment',
    adapter: 'robot-adapter',
    sessionId: 'robot-1',
    timestamp: '2026-09-02T12:00:00.000Z',
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan', 'captureImage'],
      robotCommands: ['stand', '#1', '#2'],
      robotCommandDescriptions: {
        stand: 'Rise into the standard upright four-leg standing pose.',
        '#1': 'Lift one rear leg in the first numbered gesture.',
        '#2': 'Lower into the second numbered squatting gesture.',
      },
      motionClasses: ['body_local'],
      text: true,
      movement: true,
      visual: true,
      map: false,
    },
    state: { posture: 'standing', body: { motionAvailable: true } },
    feedback: [],
    visual: {
      id: 'visual-1',
      timestamp: '2026-09-02T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: TEST_JPEG,
      source: 'robot-camera',
      metadata: { correlationId: 'cycle-1' },
    },
    metadata: { correlationId: 'cycle-1' },
  }
}

const robotStatus = {
  updatedAt: '2026-09-02T11:59:00.000Z',
  body: {
    sessionId: 'robot-1',
    battery: { voltage: 7.4, observedAt: '2026-09-02T11:59:00.000Z' },
    motion: { available: true, activity: 'idle', observedAt: '2026-09-02T11:59:00.000Z' },
  },
  lastAction: {
    actionId: 'action-1',
    type: 'robotCommand',
    command: 'stand',
    status: 'completed',
  },
  task: {
    objective: 'Continue looking for the cat.',
    instruction: 'Look around until you see the cat.',
    source: 'autonomy',
    decision: {
      outcome: 'act',
      reason: 'Another viewpoint is needed.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    selectedAction: { type: 'robotCommand', command: 'stand' },
    actionId: 'action-1',
    actionStatus: 'completed',
    feedback: null,
    baselineFrame: null,
    updatedAt: '2026-09-02T11:59:00.000Z',
  },
  situation: {
    currentGoal: 'Continue looking for the cat.',
    currentIntent: 'Inspect the current view.',
    userContext: '',
    uncertainties: ['The cat has not been located.'],
  },
  agency: { activeDesires: [] },
}

test('Environment Context Builder packages only orchestrator-selected context and current-run vision', async () => {
  const result = await environmentContextBuilderNode.execute({
    observation: observation(),
    observationCurrent: true,
    instruction: 'Please raise a leg.',
    userInstruction: 'Please raise a leg.',
    routingAnalysis: {
      needsResponse: false,
      needsConversationHistory: true,
      needsMemory: true,
      needsRobotStatus: true,
      needsEnvironment: true,
      needsVision: true,
      needsAction: true,
      needsTaskLifecycle: false,
    },
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    conversationHistory: [
      { role: 'user', content: 'What can you do?' },
      { role: 'assistant', content: 'I can use my advertised motions.' },
    ],
    personaText: 'Ainekio is curious and direct.',
    robotStatus,
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
    recentHistoryLimit: 4,
  })

  const envelope = JSON.parse(String(result.message))
  assert.equal(result.currentInstruction, 'Please raise a leg.')
  assert.equal(result.instructionSource, 'user')
  assert.equal(envelope.currentInstruction, 'Please raise a leg.')
  assert.equal(envelope.inputSource, 'user')
  assert.equal(envelope.selectedRoutes.needsAction, true)
  assert.equal(envelope.evidenceAvailability.environmentObservation, 'triggering')
  assert.equal(envelope.evidenceAvailability.currentVision, true)
  assert.equal(envelope.currentEnvironment.state.posture, 'standing')
  assert.equal(
    envelope.currentEnvironment.capabilities.robotCommandCatalog['#2'],
    'Lower into the second numbered squatting gesture.',
  )
  assert.equal(envelope.robotStatus.body.battery.voltage, 7.4)
  assert.equal(envelope.robotStatus.lastAction.command, 'stand')
  assert.equal(envelope.robotStatus.task.objective, 'Continue looking for the cat.')
  assert.deepEqual(envelope.recentConversation.map((entry: any) => entry.content), [
    'What can you do?',
    'I can use my advertised motions.',
  ])
  assert.equal('taskState' in envelope, false)
  assert.equal('decisionRequirements' in envelope, false)
  assert.equal(result.images.length, 1)
})

test('Environment Context Builder does not present a saved camera frame as current typed-chat evidence', async () => {
  const savedObservation = observation()
  savedObservation.feedback = [{
    id: 'old-feedback',
    timestamp: '2026-09-02T11:59:00.000Z',
    type: 'completed',
    message: 'An earlier action completed.',
    actionId: 'old-action',
  }]
  savedObservation.metadata = { correlationId: 'old-cycle', actionId: 'old-action' }
  const imageSelection = await environmentImageInputNode.execute({
    visual: savedObservation.visual,
    observationCurrent: false,
  }, {}, {})
  assert.deepEqual(imageSelection.images, [])
  assert.equal(imageSelection.current, false)

  const staleVision = await environmentContextBuilderNode.execute({
    observation: savedObservation,
    observationCurrent: false,
    instruction: 'Inspect the current view.',
    userInstruction: 'Inspect the current view.',
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: true,
      needsVision: true,
      needsAction: false,
      needsTaskLifecycle: false,
    },
    images: imageSelection.images,
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
    recentHistoryLimit: 4,
  })

  const staleEnvelope = JSON.parse(String(staleVision.message))
  assert.equal(staleEnvelope.evidenceAvailability.environmentObservation, 'saved')
  assert.equal(staleEnvelope.evidenceAvailability.currentVision, false)
  assert.deepEqual(staleEnvelope.currentEnvironment.visualFrames, [])
  assert.deepEqual(staleEnvelope.currentEnvironment.feedback, [])
  assert.equal('actionId' in staleEnvelope.currentEnvironment, false)
  assert.equal('correlationId' in staleEnvelope.currentEnvironment, false)
  assert.deepEqual(staleVision.images, [])

  const conversationOnly = await environmentContextBuilderNode.execute({
    instruction: 'A conversational turn.',
    userInstruction: 'A conversational turn.',
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: false,
      needsVision: false,
      needsAction: false,
      needsTaskLifecycle: false,
    },
  }, { username: 'owner' }, { systemPrompt: 'Return one Environment decision.' })
  const conversationEnvelope = JSON.parse(String(conversationOnly.message))
  assert.equal(conversationEnvelope.currentEnvironment, null)
  assert.equal(conversationOnly.messages.length, 2)
  assert.deepEqual(
    (conversationOnly.jsonSchema as any).properties.taskDecision,
    { type: 'null' },
  )
})

test('Environment selector schema exposes conversation, advertised action, and Freestyle as the three LLM-owned routes', () => {
  const schema = buildEnvironmentSelectorJsonSchema({
    actions: ['robotCommand', 'robotMotionPlan'],
    robotCommands: ['stand', '#1', '#2'],
    taskLifecycleSelected: true,
  }) as any
  const routes = schema.allOf[0].anyOf

  assert.equal(routes.length, 3)
  assert.deepEqual(routes[0].properties.actions, { maxItems: 0 })
  assert.deepEqual(routes[0].properties.movementRequest, { type: 'null' })
  assert.equal(routes[0].properties.taskDecision.properties.outcome.enum.includes('act'), false)
  assert.deepEqual(routes[1].properties.actions, { minItems: 1 })
  assert.deepEqual(routes[1].properties.taskDecision.properties.outcome.enum, ['act'])
  assert.deepEqual(routes[1].properties.taskDecision.properties.objectiveComplete.enum, [false])
  assert.deepEqual(routes[2].properties.movementRequest, { type: 'object' })
  assert.deepEqual(routes[2].properties.taskDecision.properties.outcome.enum, ['act'])
  assert.deepEqual(routes[2].properties.taskDecision.properties.objectiveComplete.enum, [false])
  assert.deepEqual(routes[2].properties.taskDecision.properties.motionClass.enum, ['body_local'])

  const meaningfulOutputs = schema.allOf[1].anyOf
  assert.deepEqual(meaningfulOutputs[0].properties.response, { type: 'string', minLength: 1 })
  assert.deepEqual(meaningfulOutputs[1].properties.actions, { type: 'array', minItems: 1 })
  assert.deepEqual(meaningfulOutputs[2].properties.movementRequest, { type: 'object' })
  assert.deepEqual(meaningfulOutputs[3].properties.taskDecision, { type: 'object' })
  assert.equal(schema.properties.taskDecision.type, 'object')

  const standaloneSchema = buildEnvironmentSelectorJsonSchema({
    actions: ['robotCommand', 'robotMotionPlan'],
    robotCommands: ['stand'],
    taskLifecycleSelected: false,
  }) as any
  assert.deepEqual(standaloneSchema.properties.taskDecision, { type: 'null' })
  assert.equal(standaloneSchema.allOf[1].anyOf.length, 3)
})
