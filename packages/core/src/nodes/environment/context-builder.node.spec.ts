import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentContextBuilderNode } from './context-builder.node.js';

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

function correlatedObservation(
  requestedBy: 'environment-perception' | 'robot-observer',
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

test('explicit Robot Observer work retains its visual-evidence admission', async () => {
  const result = await buildContext('robot-observer');

  assert.equal(result.images.length, 1);
  assert.equal(result.context.contextAdmission.vision, true);
  assert.equal(result.context.imageSelection.requested, true);
});
