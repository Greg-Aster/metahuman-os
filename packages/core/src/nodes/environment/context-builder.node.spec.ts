import assert from 'node:assert/strict'
import test from 'node:test'

import type { EnvironmentObservation } from '../../environment-interface/index.js'
import { environmentContextBuilderNode } from './context-builder.node.js'
import { environmentImageInputNode } from './image-input.node.js'
import { buildEnvironmentSelectorEnvelope, buildEnvironmentSelectorJsonSchema } from './helpers.js'

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k='

test('selector follows the adapter-selected V1 or V2 body without losing model or live gait controls', () => {
  const robots = {
    v1: { connected: true, connection_state: 'online', epoch: 1, next_sequence: 20,
      profile: 'home', mode: 'normal', transport: 'wifi', features: ['motion_plan_v1'], model: 'v1-8servo' },
    v2: { connected: true, connection_state: 'online', epoch: 3, next_sequence: 42,
      profile: 'tether', mode: 'normal', transport: 'wifi', features: ['body_capabilities_v1'], model: 'v2-12servo',
      active_walk: { t: 'intent', name: 'walk', dir: 'fwd', steps: 0, gait: 'walk', speed: 150 } },
  }
  for (const robotId of ['v1', 'v2', 'v1'] as const) {
    const v2 = robotId === 'v2'
    const current = observation()
    current.capabilities = { actions: ['robotCommand', 'move', ...(v2 ? [] : ['robotMotionPlan' as const])],
      robotCommands: v2 ? ['crawl', 'crab_right', 'turn_left_15'] : ['#1', '#2', 'crab'],
      robotCommandDescriptions: v2 ? { crab_right: 'ongoing wide-stance sideways right' }
        : { crab: 'perform an alternating crab-like leg motion, then return to stand' } }
    current.state = { body: { authenticated: true, robotId }, gateway: {
      connected: true, transport: 'protocol-v1', uptime: 100, instance: 'fixture',
      joint_contract: { version: 1, joints: ['R1', 'R2', 'L1', 'L2', 'R4', 'R3', 'L3', 'L4'] }, robots },
      activeMovementUpdates: { version: 1, available: v2, gatewayInstance: 'fixture', maxValidityMs: 2000,
        controls: v2 ? ['speed', 'stride', 'rate', 'forward', 'turn'] : [], robotId, epoch: 3, maxInFlight: 1 } }
    const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ instruction: 'Use this robot.', observation: current }))
    assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot.model, robots[robotId].model)
    assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot.profile, robots[robotId].profile)
    assert.equal('joint_contract' in envelope.currentEnvironment.state.gateway, false)
    assert.equal('robots' in envelope.currentEnvironment.state.gateway, false)
    assert.deepEqual(envelope.currentEnvironment.state.activeMovementUpdates.controls,
      v2 ? ['speed', 'stride', 'rate', 'forward', 'turn'] : [])
    assert.equal(envelope.capabilityRules.some((rule: string) => rule.startsWith('V2 locomotion:')), v2)
    assert.equal(envelope.currentEnvironment.capabilities.actions.includes('robotMotionPlan'), !v2)
    assert.deepEqual(envelope.currentEnvironment.capabilities.robotCommandCatalog, current.capabilities.robotCommandDescriptions)
    if (v2) assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot.activeWalk.speed, 150)
  }
})

test('an unselected gateway does not lend another robot its model', () => {
  const current = observation()
  current.state = { body: { authenticated: false, robotId: null },
    gateway: { robots: { other: { model: 'v2-12servo' } } } }
  const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ instruction: 'Which body?', observation: current }))
  assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot, null)
})

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

test('selected dialogue reaches the selector without a second hidden history window or text cutoff', async () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `${index}: ${'Detail retained by Buffer History. '.repeat(8)}Final requirement ${index}.`,
  }))
  const result = await environmentContextBuilderNode.execute({
    userInstruction: 'Continue that activity.',
    conversationHistory: history,
    routingAnalysis: { needsConversationHistory: true },
  }, {}, {})
  assert.deepEqual(JSON.parse(result.message).recentConversation, history)
})

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
    },
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [observation().visual],
    conversationHistory: [
      { role: 'user', content: 'What can you do?' },
      { role: 'assistant', content: 'I can use my advertised motions.' },
    ],
    personaText: 'Ainekio is curious and direct.',
    robotStatus,
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
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
  savedObservation.visuals = [
    { ...savedObservation.visual!, id: 'older-a', timestamp: '2026-09-02T11:57:00.000Z' },
    { ...savedObservation.visual!, id: 'older-b', timestamp: '2026-09-02T11:58:00.000Z' },
  ]
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
    visuals: savedObservation.visuals,
    observationCurrent: false,
  }, {}, {})
  assert.equal(imageSelection.images.length, 1, 'A saved frame remains available with its recorded time')
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
    },
    images: imageSelection.images,
    frames: imageSelection.frames,
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
  })

  const staleEnvelope = JSON.parse(String(staleVision.message))
  assert.equal(staleEnvelope.evidenceAvailability.environmentObservation, 'saved')
  assert.equal(staleEnvelope.evidenceAvailability.currentVision, false)
  assert.equal(staleEnvelope.currentEnvironment.visualFrames[0].id, savedObservation.visual!.id)
  assert.equal(staleEnvelope.currentEnvironment.visualFrames[0].timestamp, savedObservation.visual!.timestamp)
  assert.equal(staleEnvelope.currentEnvironment.visualFrames.length, 1, 'Metadata describes the selected image, not unselected candidates')
  assert.deepEqual(staleEnvelope.currentEnvironment.feedback, [])
  assert.equal('actionId' in staleEnvelope.currentEnvironment, false)
  assert.equal('correlationId' in staleEnvelope.currentEnvironment, false)
  assert.deepEqual(staleVision.images, imageSelection.images, 'Selected dated evidence is retained, not relabelled as current')
  assert.match(staleVision.messages[1].content[0].text, /visualFrames times/)
  assert.equal(staleVision.context.contextAdmission.actionContracts, true, 'A fresh capture remains available')

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
    },
  }, { username: 'owner' }, { systemPrompt: 'Return one Environment decision.' })
  const conversationEnvelope = JSON.parse(String(conversationOnly.message))
  assert.equal(conversationEnvelope.currentEnvironment, null)
  assert.equal(conversationOnly.messages.length, 2)
  assert.deepEqual((conversationOnly.jsonSchema as any).anyOf[0].properties.taskDecision.anyOf.map((branch: any) => branch.type),
    ['null', 'object'], 'Goal decisions belong to the informed selector even when no action route was selected')
})

test('Environment selector schema describes conversation or an ordered program with evidence-based task completion', () => {
  const capabilities = { actions: ['robotCommand', 'robotMotionPlan'], robotCommands: ['stand', '#1', '#2'] }
  const schema = buildEnvironmentSelectorJsonSchema(capabilities) as any
  assert.equal('properties' in schema, false, 'Provider alternatives are complete object contracts')
  assert.equal('allOf' in schema, false)
  for (const route of schema.anyOf) {
    assert.equal(route.type, 'object')
    assert.equal(route.additionalProperties, false)
    assert.deepEqual(route.required, ['taskDecision', 'program', 'response'])
    assert.deepEqual(Object.keys(route.properties), ['taskDecision', 'program', 'response'],
      'The provider grammar selects objective state before its program and speech')
    assert.equal('allOf' in route, false)
    assert.equal(route.properties.response.type, 'string')
  }
  const conversation = schema.anyOf.find((route: any) => route.properties.program.type === 'null')
  const activity = schema.anyOf.find((route: any) => route.properties.program.type === 'object')
  assert.ok(conversation)
  assert.ok(activity)
  assert.deepEqual(conversation.properties.taskDecision.anyOf[0], { type: 'null' })
  assert.equal(conversation.properties.taskDecision.anyOf[1].properties.outcome.enum.includes('act'), false)
  const program = activity.properties.program
  assert.equal(program.additionalProperties, false)
  assert.deepEqual(program.required, ['steps'])
  assert.equal(program.properties.steps.type, 'array')
  assert.equal(program.properties.steps.minItems, 1)
  assert.equal('maxItems' in program.properties.steps, false, 'The program can express every ordered phase')
  const steps = program.properties.steps.items.anyOf
  assert.deepEqual(steps.map((step: any) => step.properties.kind.const), ['action', 'generatedMotion'])
  for (const step of steps) assert.equal(step.additionalProperties, false)
  assert.deepEqual(steps[0].required, ['kind', 'action'])
  assert.deepEqual(steps[0].properties.action.required, ['type', 'command'])
  assert.deepEqual(steps[0].properties.action.properties.type.enum, ['robotCommand'])
  assert.deepEqual(steps[0].properties.action.properties.command.enum, capabilities.robotCommands)
  assert.deepEqual(steps[1].required, ['kind', 'description'])
  assert.equal(steps[1].properties.description.minLength, 1)
  assert.equal(activity.properties.taskDecision.type, 'object', 'A physical program requires its objective decision')
  assert.equal(activity.properties.taskDecision.additionalProperties, false)
  const outcomes = activity.properties.taskDecision.properties.outcome.enum
  assert.ok(outcomes.includes('act'))
  assert.ok(outcomes.includes('continue'))
  assert.equal(outcomes.includes('complete'), false, 'Selecting a program is not proof of execution')
  const required = buildEnvironmentSelectorJsonSchema({ ...capabilities, requireAction: true }) as any
  assert.deepEqual(required.anyOf, [activity], 'Requiring action uses the same complete program contract')
})

test('program steps remain restricted to advertised commands, generation and feedback capabilities', () => {
  for (const [actions, robotCommands, expectedKinds, expectedActions] of [
    [[], [], [], []],
    [['robotCommand'], [], [], []],
    [['robotCommand'], ['wave'], ['action'], ['robotCommand']],
    [['robotMotionPlan'], [], ['generatedMotion'], []],
    [['move'], [], ['action'], ['move']],
    [['captureImage'], [], ['action'], ['captureImage']],
    [['move', 'captureImage'], [], ['action', 'behavior'], ['move', 'captureImage']],
    [['robotCommand', 'robotMotionPlan', 'move', 'captureImage'], ['wave'], ['action', 'generatedMotion', 'behavior'], ['move', 'captureImage', 'robotCommand']],
  ] as const) {
    const schema = buildEnvironmentSelectorJsonSchema({ actions, robotCommands }) as any
    const activity = schema.anyOf.find((route: any) => route.properties.program.type === 'object')
    const steps = activity?.properties.program.properties.steps.items.anyOf ?? []
    assert.deepEqual(steps.map((step: any) => step.properties.kind.const), expectedKinds, JSON.stringify(actions))
    const action = steps.find((step: any) => step.properties.kind.const === 'action')?.properties.action
    const choices = action ? action.anyOf ?? [action] : []
    assert.deepEqual(choices.flatMap((choice: any) => choice.properties.type.enum).sort(), [...expectedActions].sort())
    for (const choice of choices) {
      assert.equal(choice.additionalProperties, false)
      if (choice.properties.command) assert.deepEqual(choice.properties.command.enum, robotCommands)
    }
    const behavior = steps.find((step: any) => step.properties.kind.const === 'behavior')
    if (behavior) {
      assert.equal(behavior.additionalProperties, false)
      assert.deepEqual(behavior.required, ['kind', 'target', 'completionCriteria', 'motion', 'candidateLabels', 'identifyEveryFrames', 'steering'])
      assert.equal(behavior.properties.target.minLength, 1)
      assert.equal(behavior.properties.completionCriteria.minLength, 1)
      assert.equal(behavior.properties.motion.properties.type.const, 'move')
      assert.equal(behavior.properties.motion.properties.continuous.const, true)
      assert.equal(behavior.properties.identifyEveryFrames.minimum, 1)
    }
    const disabled = buildEnvironmentSelectorJsonSchema({ actions, robotCommands, actionRouteSelected: false, requireAction: true }) as any
    assert.ok(disabled.anyOf.every((route: any) => route.properties.program.type === 'null'))
    assert.ok(disabled.anyOf.every((route: any) => !route.properties.taskDecision.anyOf[1].properties.outcome.enum.includes('act')))
  }
})

test('Environment Image Input distinguishes a saved view from evidence for a specific action', async () => {
  const savedObservation = observation()
  savedObservation.visual = { ...savedObservation.visual!,
    metadata: { correlationId: 'action-cycle-1', actionId: 'action-1' } }
  const available = await environmentImageInputNode.execute({
    visual: savedObservation.visual, observationCurrent: false, execution: { task: null },
  }, {}, {})
  assert.equal(available.current, false)
  assert.equal(available.verified, true)
  assert.equal(available.images.length, 1)

  for (const actionId of ['action-1', 'different-action']) {
    const selected = await environmentImageInputNode.execute({
      visual: savedObservation.visual, observationCurrent: false, actionId, correlationId: 'action-cycle-1',
      terminalFeedback: { type: 'completed', actionId },
    }, {}, {})
    assert.equal(selected.current, false)
    assert.equal(selected.verified, actionId === 'action-1')
    assert.equal(selected.images.length, actionId === 'action-1' ? 1 : 0,
      'A matching cycle cannot turn a different action image into proof of this result')
  }
})

test('dated inner dreams and retrieved memories survive Environment context without becoming user speech', async () => {
  const result = await environmentContextBuilderNode.execute({
    instruction: 'What did you dream about last night?', userInstruction: 'What did you dream about last night?',
    routingAnalysis: { needsConversationHistory: true, needsMemory: true },
    conversationHistory: [
      { role: 'system', content: '[Inner thought - dream]: A blue creature floated above the keys.', timestamp: '2026-09-29T22:11:55Z',
        meta: { isInnerDialogue: true, originalRole: 'dream', dialogueSource: 'dreamer' } },
      { role: 'user', content: 'Hello.', timestamp: '2026-10-07T21:40:00Z' },
      { role: 'assistant', content: 'Hello.' },
    ],
    memories: [{ id: 'dream-record', type: 'dream', timestamp: '2026-09-29T22:11:55Z', content: 'The floor rippled.' }],
  }, { currentTime: '2026-10-07T21:43:00Z' }, { systemPrompt: 'Fixture' });
  const envelope = JSON.parse(result.message);
  assert.equal(envelope.innerDialogue[0].type, 'dream');
  assert.equal(envelope.innerDialogue[0].timestamp, '2026-09-29T22:11:55Z');
  assert.match(envelope.innerDialogue[0].content, /blue creature/);
  assert.equal(envelope.currentTime, '2026-10-07T21:43:00Z');
  assert.equal(envelope.memories[0].id, 'dream-record');
  assert.equal(envelope.memories[0].timestamp, '2026-09-29T22:11:55Z');
  assert.deepEqual(envelope.recentConversation.map((m: any) => m.role), ['user', 'assistant']);
  assert.equal(envelope.recentConversation[0].timestamp, '2026-10-07T21:40:00Z');
});

test('idle selected body has unknown posture unless posture evidence is supplied', () => {
  const current = observation();
  current.state = { body: { robotId: 'body' }, gateway: { robots: { body: { active_walk: null } } } };
  const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ observation: current, instruction: 'Please stand up' }));
  assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot.posture, null);
  assert.equal(envelope.currentEnvironment.state.gateway.selectedRobot.activeWalk, null);
});
