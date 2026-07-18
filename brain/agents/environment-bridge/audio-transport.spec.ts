import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnvironmentObservation } from '@metahuman/core/environment-interface';
import {
  parseAudioUtteranceMessage,
  transcribeAudioUtterance,
} from './audio-transport.js';

function wavWithFrames(frameCount: number): Buffer {
  const dataBytes = frameCount * 640;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  wav.fill(1, 44);
  return wav;
}

function audioMessage(): Buffer {
  const metadata = Buffer.from(JSON.stringify({
    type: 'audio.utterance',
    version: 1,
    sessionId: 'robot-session',
    utteranceId: 'utterance-1',
    robotId: 'robot-1',
    epoch: 3,
    startedAt: '2026-07-17T12:00:00.000Z',
    endedAt: '2026-07-17T12:00:00.060Z',
    firstCounter: 10,
    lastCounter: 12,
    frameCount: 2,
    missingFrames: 1,
    durationMs: 60,
    wakeTriggered: true,
    truncated: false,
    format: 'wav',
    sampleRateHz: 16000,
    channels: 1,
    bitsPerSample: 16,
  }));
  const header = Buffer.alloc(12);
  header.write('AIKAUD01', 0, 'ascii');
  header.writeUInt32LE(metadata.length, 8);
  return Buffer.concat([header, metadata, wavWithFrames(3)]);
}

const observation: EnvironmentObservation = {
  environmentId: 'ainekio',
  adapter: 'ainekio-gateway',
  sessionId: 'robot-session',
  timestamp: '2026-07-17T11:59:59.000Z',
  capabilities: { actions: ['robotCommand'], text: true },
  state: { transport: 'protocol-v1' },
  visual: {
    id: 'stale-camera-frame',
    timestamp: '2026-07-17T11:59:59.000Z',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  },
};

test('parses one bounded PCM WAV utterance and preserves bridge metadata', async () => {
  const parsed = parseAudioUtteranceMessage(audioMessage());
  assert.equal(parsed.metadata.durationMs, 60);
  assert.equal(parsed.metadata.missingFrames, 1);
  assert.equal(parsed.wav.length, 44 + (3 * 640));

  const calls: Array<{ bytes: number; format: string }> = [];
  const transcribed = await transcribeAudioUtterance(
    parsed,
    observation,
    async (audio, format) => {
      calls.push({ bytes: audio.length, format });
      return 'walk forward';
    },
    () => new Date('2026-07-17T12:00:01.000Z'),
  );

  assert.deepEqual(calls, [{ bytes: 44 + (3 * 640), format: 'wav' }]);
  assert.equal(transcribed?.text?.[0]?.text, 'walk forward');
  assert.equal(transcribed?.text?.[0]?.metadata?.utteranceId, 'utterance-1');
  const audioState = transcribed?.state?.lastAudioUtterance as Record<string, unknown>;
  assert.equal(audioState.wakeTriggered, true);
  assert.equal(transcribed?.visual, undefined, 'stale camera input must not accompany microphone text');
});

test('rejects audio whose metadata duration does not match the WAV payload', () => {
  const encoded = audioMessage();
  const metadataBytes = encoded.readUInt32LE(8);
  const metadata = JSON.parse(encoded.toString('utf8', 12, 12 + metadataBytes));
  metadata.durationMs = 80;
  const replacement = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(12);
  header.write('AIKAUD01', 0, 'ascii');
  header.writeUInt32LE(replacement.length, 8);
  const malformed = Buffer.concat([header, replacement, encoded.subarray(12 + metadataBytes)]);

  assert.throws(
    () => parseAudioUtteranceMessage(malformed),
    /duration does not match/,
  );
});
