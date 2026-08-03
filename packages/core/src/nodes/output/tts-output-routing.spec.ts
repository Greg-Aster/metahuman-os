import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverTTSOutput, type TTSQueueItem } from './tts.node.js';
import { normalizeRobotSpeechText } from '../../tts/robot-speech.js';

const request = {
  username: 'test-user',
  text: 'Hello from the robot.',
  mode: 'conversation' as const,
  source: 'environment-mode',
};

test('local speech keeps using the existing browser queue', async () => {
  let queued = 0;
  let rendered = 0;
  const result = await deliverTTSOutput(request, {
    getSettings: () => ({
      provider: 'kokoro',
      outputTarget: 'local',
      speechDisabled: false,
    }),
    queue: (_username, text, mode, source): TTSQueueItem => {
      queued += 1;
      return { id: 'tts-local', text, mode, source, timestamp: 1 };
    },
    renderRobot: async () => {
      rendered += 1;
      return { actionId: 'unexpected', requestId: 'unexpected', totalChunks: 1 };
    },
  });

  assert.deepEqual(result, {
    accepted: true,
    deliveryId: 'tts-local',
    route: 'local',
    reason: undefined,
  });
  assert.equal(queued, 1);
  assert.equal(rendered, 0);
});

test('Environment Mode robot speech bypasses the browser queue exactly once', async () => {
  let queued = 0;
  let rendered = 0;
  const result = await deliverTTSOutput(request, {
    getSettings: () => ({
      provider: 'kokoro',
      outputTarget: 'robot',
      speechDisabled: false,
    }),
    queue: () => {
      queued += 1;
      return null;
    },
    createRequestId: () => 'tts-robot-test',
    renderRobot: async (options) => {
      rendered += 1;
      assert.equal(options.requestId, 'tts-robot-test');
      assert.equal(options.text, request.text);
      return {
        actionId: 'speech-action-1',
        requestId: options.requestId,
        totalChunks: 1,
      };
    },
  });

  assert.deepEqual(result, {
    accepted: true,
    deliveryId: 'speech-action-1',
    route: 'robot',
  });
  assert.equal(queued, 0);
  assert.equal(rendered, 1);
});

test('the main speech disable state blocks server-owned robot synthesis', async () => {
  let queued = 0;
  let rendered = 0;
  const result = await deliverTTSOutput(request, {
    getSettings: () => ({
      provider: 'kokoro',
      outputTarget: 'robot',
      speechDisabled: true,
    }),
    queue: () => {
      queued += 1;
      return null;
    },
    renderRobot: async () => {
      rendered += 1;
      return { actionId: 'unexpected', requestId: 'unexpected', totalChunks: 1 };
    },
  });

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'robot');
  assert.match(result.reason || '', /disabled/i);
  assert.equal(queued, 0);
  assert.equal(rendered, 0);
});

test('robot output does not create a second route for non-Environment TTS nodes', async () => {
  let queued = 0;
  let rendered = 0;
  const result = await deliverTTSOutput(
    { ...request, source: 'reflection' },
    {
      getSettings: () => ({
        provider: 'kokoro',
        outputTarget: 'robot',
        speechDisabled: false,
      }),
      queue: () => {
        queued += 1;
        return null;
      },
      renderRobot: async () => {
        rendered += 1;
        return { actionId: 'unexpected', requestId: 'unexpected', totalChunks: 1 };
      },
    },
  );

  assert.equal(result.accepted, false);
  assert.match(result.reason || '', /Environment Mode/);
  assert.equal(queued, 0);
  assert.equal(rendered, 0);
});

test('server-owned robot speech strips non-speakable model formatting', () => {
  assert.equal(
    normalizeRobotSpeechText('<think>hidden</think> **Hello** [friend](https://example.com).'),
    'Hello friend.',
  );
});
