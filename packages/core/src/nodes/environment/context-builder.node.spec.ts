import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentContextBuilderNode } from './context-builder.node.js';

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

function correlatedObservation(
  requestedBy: 'environment-perception' | 'robot-observer' | 'boredom-movement',
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
        maxSteps: 4,
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
  requestedBy: 'environment-perception' | 'robot-observer',
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
  assert.equal(result.context.contextAdmission.vision, true);
  assert.equal(result.context.imageSelection.used, 1);
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

test('explicit Robot Observer work retains its visual-evidence admission', async () => {
  const result = await buildContext('robot-observer');

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

test('autonomous observations exclude conversation history by default', async () => {
  const autonomous = correlatedObservation('robot-observer');
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
