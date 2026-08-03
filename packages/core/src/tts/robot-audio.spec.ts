import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  claimRobotSpeech,
  combineRobotSpeechWavChunks,
  normalizeRobotSpeechVolume,
  stageRobotSpeech,
  wavToRobotPcm,
} from './robot-audio.js';

function pcmWav(sampleRate: number, samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

test('Kokoro WAV is converted once to one 20 ms robot PCM frame', () => {
  const source = Array.from({ length: 480 }, (_, index) => index - 240);
  const pcm = wavToRobotPcm(pcmWav(24_000, source));
  assert.equal(pcm.length, 640);
  const combined = combineRobotSpeechWavChunks([pcmWav(24_000, source)]);
  assert.equal(combined.pcm.length, 640);
  assert.equal(combined.durationMs, 20);
});

test('robot speech volume normalizes the source peak to the configured percentage', () => {
  const source = Buffer.alloc(8);
  source.writeInt16LE(1_000, 0);
  source.writeInt16LE(-2_000, 2);
  source.writeInt16LE(500, 4);
  source.writeInt16LE(0, 6);

  const normalized = normalizeRobotSpeechVolume(source, 90);
  const peak = Math.max(
    ...Array.from(
      { length: normalized.length / 2 },
      (_, index) => Math.abs(normalized.readInt16LE(index * 2)),
    ),
  );
  assert.equal(peak, Math.round(32_767 * 0.9));
  assert.throws(() => normalizeRobotSpeechVolume(source, 0), /between 1 and 100/);
  assert.throws(() => normalizeRobotSpeechVolume(source, 101), /between 1 and 100/);
});

test('robot speech spool is bounded, permission-restricted, and claim-once', () => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-speech-'));
  const previous = process.env.MH_ENVIRONMENT_SPEECH_SPOOL;
  process.env.MH_ENVIRONMENT_SPEECH_SPOOL = spool;
  try {
    const staged = stageRobotSpeech({
      pcm: Buffer.alloc(640),
      durationMs: 20,
    });
    const file = path.join(spool, `${staged.id}.pcm`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(claimRobotSpeech(staged.id)?.pcm, Buffer.alloc(640));
    assert.equal(claimRobotSpeech(staged.id), null);
  } finally {
    if (previous === undefined) delete process.env.MH_ENVIRONMENT_SPEECH_SPOOL;
    else process.env.MH_ENVIRONMENT_SPEECH_SPOOL = previous;
    fs.rmSync(spool, { recursive: true, force: true });
  }
});
