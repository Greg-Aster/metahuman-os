import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvironmentObservation } from '@metahuman/core/environment-interface';
import type { AudioUtteranceMetadata } from './audio-transport.js';
import { AudioVisualObservationJoin } from './audio-visual-join.js';

const metadata: AudioUtteranceMetadata = {
  type: 'audio.utterance',
  version: 1,
  sessionId: 'robot-session',
  utteranceId: 'utterance-1',
  robotId: 'robot-1',
  epoch: 3,
  startedAt: '2026-07-23T12:00:00.000Z',
  endedAt: '2026-07-23T12:00:01.000Z',
  firstCounter: 1,
  lastCounter: 50,
  frameCount: 50,
  missingFrames: 0,
  durationMs: 1000,
  wakeTriggered: false,
  truncated: false,
  format: 'wav',
  sampleRateHz: 16000,
  channels: 1,
  bitsPerSample: 16,
};

function transcript(): EnvironmentObservation {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-session',
    timestamp: '2026-07-23T12:00:02.000Z',
    capabilities: { actions: ['captureImage'], visual: true },
    text: [{
      id: 'audio-text',
      source: 'environment',
      text: 'hello',
      timestamp: '2026-07-23T12:00:02.000Z',
    }],
    metadata: {
      correlationId: 'utterance-1',
      audioUtteranceId: 'utterance-1',
    },
  };
}

function visual(overrides: Partial<EnvironmentObservation> = {}): EnvironmentObservation {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-session',
    timestamp: '2026-07-23T12:00:01.500Z',
    capabilities: { actions: ['captureImage'], visual: true },
    state: { body: { cameraReady: true } },
    visual: {
      id: 'camera-1',
      timestamp: '2026-07-23T12:00:01.500Z',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      metadata: { robotId: 'robot-1', audioUtteranceId: 'utterance-1' },
    },
    metadata: {
      correlationId: 'utterance-1',
      audioUtteranceId: 'utterance-1',
      robotId: 'robot-1',
      epoch: 3,
    },
    ...overrides,
  };
}

test('publishes one observation after matching transcript and visual arrive', async () => {
  const published: EnvironmentObservation[] = [];
  const join = new AudioVisualObservationJoin({
    publish: async observation => { published.push(observation); },
  });
  assert.equal(join.register(metadata), true);
  assert.equal(await join.submitTranscript(metadata.utteranceId, transcript()), true);
  assert.equal(published.length, 0);
  assert.equal(await join.submitVisual(visual()), true);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.text?.[0]?.text, 'hello');
  assert.equal(published[0]?.visual?.id, 'camera-1');
  assert.equal(published[0]?.metadata?.visualStatus, 'matched');
  join.close();
});

test('publishes text without a stale image after the bounded visual deadline', async () => {
  const published: EnvironmentObservation[] = [];
  const join = new AudioVisualObservationJoin({
    publish: async observation => { published.push(observation); },
  });
  assert.equal(join.register(metadata), true);
  await join.submitTranscript(metadata.utteranceId, transcript());
  await join.expire(metadata.utteranceId);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.visual, undefined);
  assert.equal(published[0]?.metadata?.visualStatus, 'unavailable');
  assert.equal(await join.submitVisual(visual()), true, 'late correlated image is consumed');
  assert.equal(published.length, 1, 'late image cannot create a second cognition run');
  join.close();
});

test('rejects a correlated image from the wrong robot', async () => {
  const published: EnvironmentObservation[] = [];
  const join = new AudioVisualObservationJoin({
    publish: async observation => { published.push(observation); },
  });
  assert.equal(join.register(metadata), true);
  await join.submitTranscript(metadata.utteranceId, transcript());
  await join.submitVisual(visual({
    metadata: {
      correlationId: 'utterance-1',
      audioUtteranceId: 'utterance-1',
      robotId: 'robot-2',
      epoch: 3,
    },
  }));
  await join.expire(metadata.utteranceId);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.visual, undefined);
  join.close();
});

