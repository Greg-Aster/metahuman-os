import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeRobotSpeechMessage, ROBOT_SPEECH_MAGIC } from './speech-transport.js';

test('robot speech bridge packet carries one bounded PCM artifact', () => {
  const pcm = Buffer.alloc(640, 7);
  const packet = encodeRobotSpeechMessage({
    sessionId: 'ainekio-01',
    actionId: 'action-1',
    durationMs: 20,
    artifact: { id: 'speech-1', pcm, durationMs: 20 },
  });
  assert.deepEqual(packet.subarray(0, 8), ROBOT_SPEECH_MAGIC);
  const metadataBytes = packet.readUInt32LE(8);
  const metadata = JSON.parse(packet.toString('utf8', 12, 12 + metadataBytes));
  assert.equal(metadata.type, 'audio.speech');
  assert.equal(metadata.actionId, 'action-1');
  assert.equal(metadata.frameBytes, 640);
  assert.deepEqual(packet.subarray(12 + metadataBytes), pcm);
});
