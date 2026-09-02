import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentContextBuilderNode } from './context-builder.node.js';
import { buildEnvironmentSelectorJsonSchema } from './helpers.js';

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

function correlatedObservation(
  requestedBy: 'environment-perception' | 'boredom-observer' | 'boredom-movement',
): EnvironmentObservation {
  return {
    environmentId: 'robot-environment',
    adapter: 'robot-adapter',
    sessionId: 'robot-1',
    timestamp: '2026-08-04T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage'],
      robotCommands: [],
      text: true,
      movement: false,
      visual: true,
      map: false,
    },
    feedback: [],
    visual: {
      id: 'visual-1',
      timestamp: '2026-08-04T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: TEST_JPEG,
      source: 'robot-camera',
      metadata: { correlationId: 'cycle-1' },
    },
    metadata: {
      correlationId: 'cycle-1',
      perceptionEvent: 'audio_utterance',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        triggerSource: 'user',
        graph: 'environment',
        requestedBy,
      },
    },
  };
}

const typedConversationRoute = {
  needsAction: false,
  needsEnvironment: false,
  needsVision: false,
  needsMemory: false,
  isFollowUp: false,
};

async function buildContext(
  requestedBy: 'environment-perception' | 'boredom-observer',
  routingAnalysis: Record<string, unknown> = typedConversationRoute,
) {
  return environmentContextBuilderNode.execute({
    instruction: 'How are you today?',
    observation: correlatedObservation(requestedBy),
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    routingAnalysis,
  }, {}, { systemPrompt: '', recentHistoryLimit: 4 });
}

test('ordinary correlated audio does not admit camera input without typed vision authorization', async () => {
  const result = await buildContext('environment-perception');

  assert.deepEqual(result.images, []);
  assert.equal(typeof result.messages.at(-1)?.content, 'string');
  assert.equal(result.context.contextAdmission.vision, false);
  assert.equal(result.context.imageSelection.used, 0);
  assert.equal(result.context.observation.visual.id, 'visual-1');
  assert.equal(result.context.visual.id, 'visual-1');
  assert.equal(result.context.visuals[0].id, 'visual-1');
});

test('typed vision authorization admits the correlated camera input', async () => {
  const result = await buildContext('environment-perception', {
    ...typedConversationRoute,
    needsEnvironment: true,
    needsVision: true,
  });

  assert.equal(result.images.length, 1);
  assert.equal(Array.isArray(result.messages.at(-1)?.content), true);
  const content = result.messages.at(-1)?.content;
  assert.match(
    String(Array.isArray(content) ? content[0]?.text : ''),
    /^The attached image is what you currently see\./,
  );
  assert.equal(result.context.contextAdmission.vision, true);
  assert.equal(result.context.imageSelection.used, 1);
});

test('an authorized freestyle request bypasses redundant selector inference after standing preparation', async () => {
  const current = correlatedObservation('environment-perception');
  current.capabilities = {
    actions: ['robotCommand', 'robotMotionPlan'],
    robotCommands: ['stand'],
    motionClasses: ['body_local'],
    movement: true,
    visual: true,
  };
  const preparedMovementRequest = {
    description: 'Create one original asymmetric body-local gesture.',
    motionClass: 'body_local',
  };
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Resume the already-authorized movement after standing preparation.',
    observation: current,
    preparedMovementRequest,
    taskState: {
      version: 1,
      objective: 'Create one original asymmetric body-local gesture.',
      phase: 'evaluating_evidence',
      step: 1,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      pendingMovementRequest: preparedMovementRequest,
      pendingMovementContract: {
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    },
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  assert.deepEqual(result.messages, []);
  assert.equal(result.jsonSchema, null);
  assert.equal(result.context.contextAdmission.selector, false);
});

test('an action-required route tells the selector that prose alone cannot satisfy the handoff', async () => {
  const result = await buildContext('environment-perception', {
    ...typedConversationRoute,
    needsEnvironment: true,
    needsAction: true,
  });
  const content = result.messages.at(-1)?.content;
  const serialized = Array.isArray(content)
    ? String(content.find(part => part.type === 'text')?.text)
    : String(content);
  const selectorEnvelope = JSON.parse(serialized);

  assert.equal(selectorEnvelope.decisionRequirements.mustSelectAction, true);
});

test('action-required command-only autonomy is structurally bound to advertised commands', async () => {
  const current = correlatedObservation('boredom-movement');
  current.capabilities = {
    actions: ['robotCommand'],
    robotCommands: ['gesture_alpha', 'gesture_beta'],
    movement: true,
    visual: true,
  };
  (current.metadata!.robotObserver as Record<string, unknown>).triggerSource = 'autonomy';
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Choose one safe advertised movement.',
    observation: current,
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      needsAction: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });
  const schema = result.jsonSchema as any;
  const item = schema.properties.actions.items;

  assert.equal(schema.properties.actions.minItems, 1);
  assert.deepEqual(item.properties.type.enum, ['robotCommand']);
  assert.deepEqual(item.properties.command.enum, ['gesture_alpha', 'gesture_beta']);
  assert.deepEqual(item.required, ['type', 'command']);
  assert.equal(schema.properties.movementRequest.type, 'null');
});

test('the selector receives the complete body-sized catalog including punctuation commands', async () => {
  const current = correlatedObservation('boredom-movement');
  const robotCommands = [
    '#1',
    '#2',
    ...Array.from({ length: 40 }, (_value, index) => `motion_${String(index + 1).padStart(2, '0')}`),
  ];
  const robotCommandDescriptions = Object.fromEntries(robotCommands.map(command => [
    command,
    `perform the body-owned physical effect for ${command}`,
  ]));
  current.capabilities = {
    actions: ['robotCommand'],
    robotCommands,
    robotCommandDescriptions: {
      ...robotCommandDescriptions,
      unadvertised: 'must not enter the selector prompt',
    },
    movement: true,
    visual: false,
  };
  (current.metadata!.robotObserver as Record<string, unknown>).triggerSource = 'autonomy';

  const result = await environmentContextBuilderNode.execute({
    instruction: 'Choose one fitting advertised movement.',
    observation: current,
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      needsAction: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });
  const selectorEnvelope = JSON.parse(String(result.message));
  const commandSchema = (result.jsonSchema as any).properties.actions.items.properties.command;

  assert.equal(selectorEnvelope.currentEnvironment.capabilities.robotCommands, undefined);
  assert.deepEqual(
    selectorEnvelope.currentEnvironment.capabilities.robotCommandCatalog,
    robotCommandDescriptions,
  );
  assert.match(selectorEnvelope.capabilityRules.join('\n'), /choose from robotCommandCatalog descriptions/i);
  assert.match(selectorEnvelope.capabilityRules.join('\n'), /multi-step objective/i);
  assert.match(selectorEnvelope.capabilityRules.join('\n'), /appropriate current step, then reassess after feedback/i);
  assert.match(selectorEnvelope.capabilityRules.join('\n'), /body part, motion, direction, and timing detail/i);
  assert.doesNotMatch(String(result.message), /must not enter the selector prompt/);
  assert.deepEqual(commandSchema.enum, robotCommands);
});

test('current robot state remains authoritative over dated Robot Status context', async () => {
  const current = correlatedObservation('environment-perception');
  current.state = {
    transport: 'protocol-v1',
    safety: 'body-owned',
    adapterConnected: true,
    body: {
      authenticated: true,
      robotId: 'ainekio-01',
      heartbeatAgeMs: 20,
      motionAvailable: true,
      cameraReady: true,
      microphoneReady: true,
      speakerReady: true,
    },
    gateway: {
      profile: 'home',
      effectiveCaps: {
        cameraMaxFps: 10,
        cameraDefaultResolution: 'VGA',
        statusIntervalSeconds: 5,
      },
    },
    freestyleMovement: {
      supported: true,
      enabled: true,
      available: true,
    },
    commandedPose: {
      version: 1,
      jointMapVersion: 1,
      sourceActionId: 'current-neutral-action',
      updatedAt: current.timestamp,
      kind: 'reference',
      reference: 'neutral',
    },
  };

  const result = await environmentContextBuilderNode.execute({
    instruction: 'Please stand up.',
    observation: current,
    robotStatus: {
      version: 1,
      updatedAt: '2026-08-04T11:30:00.000Z',
      body: {
        motion: { available: false, activity: 'idle' },
        state: { posture: 'standing' },
      },
      lastAction: {
        command: 'stand',
        status: 'completed',
        message: 'The robot stood earlier.',
      },
      situation: {
        situationalSummary: 'I am already standing with motion unavailable.',
        environmentDescription: 'An earlier view of the room.',
        currentGoal: 'Remain available for the user.',
        currentIntent: 'Wait for the next instruction.',
        userContext: 'The user is interacting with me.',
        uncertainties: ['The current pose may have changed.'],
      },
      agency: {
        activeDesires: [{ id: 'social', title: 'Stay engaged', strength: 0.7 }],
      },
      history: [{ situationalSummary: 'I was standing earlier.' }],
    },
    routingAnalysis: {
      ...typedConversationRoute,
      needsAction: true,
      needsEnvironment: true,
    },
  }, {
    userMessage: 'Please stand up.',
    username: 'greggles',
  }, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  const selectorEnvelope = JSON.parse(String(result.message));
  assert.equal(selectorEnvelope.currentEnvironment.state.body.motionAvailable, true);
  assert.equal(selectorEnvelope.currentEnvironment.state.commandedPose.reference, 'neutral');
  assert.deepEqual(selectorEnvelope.robotStatus, {
    updatedAt: '2026-08-04T11:30:00.000Z',
    situation: {
      currentGoal: 'Remain available for the user.',
      currentIntent: 'Wait for the next instruction.',
      userContext: 'The user is interacting with me.',
      uncertainties: ['The current pose may have changed.'],
    },
    agency: {
      activeDesires: [{ id: 'social', title: 'Stay engaged', strength: 0.7 }],
    },
  });
});

test('mixed action schema keeps robot command fields off captureImage actions', async () => {
  const current = correlatedObservation('environment-perception');
  current.capabilities = {
    actions: ['captureImage', 'robotCommand', 'sendText'],
    robotCommands: ['neutral', 'wave'],
    text: true,
    movement: true,
    visual: true,
  };
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Please take a picture.',
    observation: current,
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      needsAction: true,
    },
  }, { userMessage: 'Please take a picture.' }, { systemPrompt: '', recentHistoryLimit: 4 });
  const branches = (result.jsonSchema as any).properties.actions.items.anyOf;
  const nonCommandBranch = branches.find((branch: any) => (
    branch.properties.type.enum.includes('captureImage')
  ));
  const commandBranch = branches.find((branch: any) => (
    branch.properties.type.enum.includes('robotCommand')
  ));

  assert.equal('command' in nonCommandBranch.properties, false);
  assert.deepEqual(commandBranch.required, ['type', 'command']);
  assert.deepEqual(commandBranch.properties.command.enum, ['neutral', 'wave']);
});

test('explicit Boredom Observer work retains its visual-evidence admission', async () => {
  const result = await buildContext('boredom-observer');

  assert.equal(result.images.length, 1);
  assert.equal(result.context.contextAdmission.vision, true);
  assert.equal(result.context.imageSelection.requested, true);
});

test('selector receives history once inside its bounded envelope', async () => {
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Please wave now.',
    observation: correlatedObservation('environment-perception'),
    conversationHistory: [
      { role: 'user', content: 'Earlier, please stand.' },
      { role: 'assistant', content: 'That earlier request is complete.' },
    ],
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      isFollowUp: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  assert.equal(result.messages.length, 2);
  const selectorEnvelope = JSON.parse(String(result.messages[1]?.content));
  assert.equal(selectorEnvelope.currentInstruction, 'Please wave now.');
  assert.equal(selectorEnvelope.recentConversation.length, 2);
});

test('an ordinary selected-message reply reaches the Environment selector as focused context', async () => {
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Please wave now.',
    observation: correlatedObservation('environment-perception'),
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
    },
  }, {
    userMessage: 'Please wave now.',
    replyToContent: 'You previously described the object beside the chair.',
    username: 'greggles',
  }, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  const selectorEnvelope = JSON.parse(String(result.messages[1]?.content));
  assert.equal(selectorEnvelope.currentInstruction, 'Please wave now.');
  assert.equal(
    selectorEnvelope.replyToContext,
    'You previously described the object beside the chair.',
  );
});

test('a fresh user control turn retains memory context without unrelated action lineage', async () => {
  const current = correlatedObservation('environment-perception');
  current.feedback = [{
    id: 'old-feedback',
    actionId: 'old-action',
    timestamp: '2026-08-04T11:59:00.000Z',
    type: 'completed',
    message: 'An unrelated autonomous walk completed.',
    data: { command: 'walk_forward' },
  }];
  current.metadata = {
    ...current.metadata,
    actionId: 'old-action',
    correlationId: 'old-cycle',
    originatingInstruction: 'An unrelated autonomous objective.',
  };
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Please turn left ninety degrees.',
    observation: current,
    conversationHistory: [
      { role: 'user', content: 'Please turn until you see a foot.' },
      { role: 'assistant', content: 'My sensors indicate the room remains empty.' },
    ],
    memories: [{ content: 'My sensors indicate the room remains empty.' }],
    personaText: '## Identity\n- Name: Ainekio',
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      needsMemory: true,
      isFollowUp: true,
    },
  }, {
    userMessage: 'Please turn left ninety degrees.',
    username: 'greggles',
  }, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  const selectorEnvelope = JSON.parse(String(result.messages[1]?.content));
  assert.equal(selectorEnvelope.recentConversation.length, 2);
  assert.deepEqual(selectorEnvelope.memories, [
    'My sensors indicate the room remains empty.',
  ]);
  assert.deepEqual(selectorEnvelope.currentEnvironment.feedback, []);
  assert.equal('actionId' in selectorEnvelope.currentEnvironment, false);
  assert.equal('correlationId' in selectorEnvelope.currentEnvironment, false);
  assert.match(selectorEnvelope.activePersona, /Name: Ainekio/);
  assert.equal(result.context.contextSelection.recentHistory, true);
  assert.equal(result.context.contextSelection.semanticMemory, true);
});

test('a bounded feedback pass must return completion or one next action', async () => {
  const current = correlatedObservation('environment-perception');
  current.capabilities = {
    actions: ['captureImage', 'robotCommand'],
    robotCommands: ['wave'],
    movement: true,
    visual: true,
  };
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Evaluate the current frame and continue the same objective.',
    observation: current,
    taskState: {
      version: 1,
      objective: 'Wave until a hand is visible.',
      phase: 'evaluating_evidence',
      step: 1,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      visualEvidenceMode: 'single',
      selectedAction: { type: 'robotCommand', command: 'wave' },
    },
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      needsVision: true,
    },
  }, {
    environmentActionSource: 'user',
    username: 'greggles',
  }, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  const envelope = JSON.parse(String(result.message));
  const schema = result.jsonSchema as any;
  const progressBranches = schema.allOf.find((constraint: any) => (
    constraint.anyOf?.some((branch: any) => (
      branch.properties?.taskDecision?.properties?.outcome?.enum?.[0] === 'complete'
    ))
  )).anyOf;
  const actionBranch = progressBranches.find((branch: any) => (
    branch.properties?.actions?.minItems === 1
  ));
  const completionBranch = progressBranches.find((branch: any) => (
    branch.properties?.taskDecision?.properties?.outcome?.enum?.[0] === 'complete'
  ));

  assert.equal(envelope.decisionRequirements.mustAdvanceTask, true);
  assert.deepEqual(envelope.currentEnvironment.feedback, []);
  assert.equal(envelope.currentEnvironment.actionId, undefined);
  assert.equal(envelope.currentEnvironment.correlationId, 'cycle-1');
  assert.match(String(result.messages[0]?.content), /incomplete response with no action is invalid/i);
  assert.equal(actionBranch.properties.actions.minItems, 1);
  assert.deepEqual(completionBranch.properties.taskDecision.properties.outcome.enum, ['complete']);
  assert.deepEqual(completionBranch.properties.taskDecision.properties.objectiveComplete.enum, [true]);
  assert.deepEqual(
    completionBranch.properties.taskDecision.properties.requiredCompletionBasis.enum,
    ['response', 'action_result', 'visual_observation', 'environment_state', 'user_input'],
  );
  assert.equal(completionBranch.properties.taskDecision.properties.completionEvidence.minLength, 1);
});

test('autonomous observations exclude conversation history by default', async () => {
  const autonomous = correlatedObservation('boredom-observer');
  (autonomous.metadata!.robotObserver as Record<string, unknown>).triggerSource = 'autonomy';
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Review the current image.',
    observation: autonomous,
    conversationHistory: [
      { role: 'user', content: 'Earlier, please wave.' },
      { role: 'assistant', content: 'That earlier request is complete.' },
    ],
    personaText: '## Identity\n- Name: Ainekio\n\n## Personality Traits\n- curious: high',
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
      isFollowUp: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });

  const selectorEnvelope = JSON.parse(String(result.messages[1]?.content));
  assert.deepEqual(selectorEnvelope.recentConversation, []);
  assert.equal(selectorEnvelope.inputSource, 'autonomy');
  assert.equal(selectorEnvelope.decisionRequirements.mustSelectAction, false);
  assert.match(selectorEnvelope.activePersona, /Name: Ainekio/);
  assert.equal(result.context.personaIncluded, true);
  assert.equal(
    String(result.messages[1]?.content).match(/Name: Ainekio/g)?.length,
    1,
    'the active persona must enter the selector envelope exactly once',
  );
});

test('autonomous completion permits the model to choose silence', () => {
  const schema = buildEnvironmentSelectorJsonSchema({
    requireAutonomousConsequence: true,
  }) as any;
  const completionBranch = schema.allOf.flatMap((constraint: any) => constraint.anyOf ?? []).find((branch: any) => (
    branch.properties?.taskDecision?.properties?.outcome?.enum?.[0] === 'complete'
  ));

  assert.equal(completionBranch.properties.response.type, 'string');
  assert.equal('minLength' in completionBranch.properties.response, false);
});

test('selector schema exposes exactly conversation, named-action, and Freestyle routes', () => {
  const schema = buildEnvironmentSelectorJsonSchema({
    actions: ['robotCommand', 'robotMotionPlan'],
    robotCommands: ['stand', 'wave'],
  }) as any;
  const routes = schema.allOf[0].anyOf;

  assert.equal(routes.length, 3);
  assert.deepEqual(routes[0].properties.actions, { maxItems: 0 });
  assert.deepEqual(routes[0].properties.movementRequest, { type: 'null' });
  assert.deepEqual(routes[1].properties.actions, { minItems: 1 });
  assert.deepEqual(routes[1].properties.movementRequest, { type: 'null' });
  assert.deepEqual(routes[2].properties.actions, { maxItems: 0 });
  assert.deepEqual(routes[2].properties.movementRequest, { type: 'object' });
});

test('sampled Robot Operator inspiration enters the Environment envelope exactly once', async () => {
  const autonomous = correlatedObservation('boredom-movement');
  (autonomous.metadata!.robotObserver as Record<string, unknown>).triggerSource = 'autonomy';
  autonomous.metadata!.robotOperatorMemories = [
    'A quiet afternoon walk ended beside a bright red leaf.',
    'A quiet afternoon walk ended beside a bright red leaf.',
    'A familiar song once inspired a playful bow.',
  ];
  const result = await environmentContextBuilderNode.execute({
    instruction: 'Use sampled memories as inspiration for one outcome.',
    observation: autonomous,
    memories: [{ content: 'A familiar song once inspired a playful bow.' }],
    routingAnalysis: {
      ...typedConversationRoute,
      needsEnvironment: true,
    },
  }, {}, { systemPrompt: 'Return the typed Environment output.', recentHistoryLimit: 4 });
  const selectorEnvelope = JSON.parse(String(result.messages[1]?.content));

  assert.deepEqual(selectorEnvelope.memories, [
    'A quiet afternoon walk ended beside a bright red leaf.',
    'A familiar song once inspired a playful bow.',
  ]);
  assert.equal(
    String(result.messages[1]?.content).match(/bright red leaf/g)?.length,
    1,
  );
});
