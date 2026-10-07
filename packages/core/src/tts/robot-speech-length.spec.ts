import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-long-speech-'));
process.env.METAHUMAN_ROOT = root;
process.env.MH_ENVIRONMENT_SPEECH_SPOOL = path.join(root, 'speech');
const { claimRobotSpeech, stageRobotSpeech, wavToRobotPcm } = await import('./robot-audio.js');
const { prepareRobotSpeech } = await import('./robot-speech.js');
const { KokoroService } = await import('./providers/kokoro-service.js');
const { prepareEnvironmentCommand } = await import('../environment-interface/store.js');
const { getProfilePaths } = await import('../path-builder.js');
const { persistQueueState } = await import('../queue/queue-persister.js');
const { eventBus } = await import('../infrastructure/event-bus/client.js');
const configFile = getProfilePaths('fixture').voiceConfig;
fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, JSON.stringify({ tts: { provider: 'kokoro', kokoro: {
  langCode: 'a', voice: 'af_heart', speed: 1, autoFallbackToPiper: false,
} }, cache: { enabled: false, directory: path.join(root, 'cache') } }));

after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });

function wav(seconds: number): Buffer {
  const audio = Buffer.alloc(44 + seconds * 24_000 * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(24_000, 24); audio.writeUInt32LE(48_000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  // Nonzero first and last samples make dropped tails observable.
  audio.writeInt16LE(1234, 44); audio.writeInt16LE(2345, audio.length - 2);
  return audio;
}

test('a multi-minute reply survives rendering, admission and claiming intact', async () => {
  const chunk = wav(2);
  const synthesis = mock.method(KokoroService.prototype, 'synthesizeStream', async function* () {
    for (let index = 0; index < 80; index++) yield {
      index, total: 80, text: 'fixture', audio: chunk, isFinal: index === 79, synthesisMs: 0, cacheHit: false,
    };
  });
  try {
    const prepared = await prepareRobotSpeech({ username: 'fixture', sessionId: 'robot', text: 'Complete reply.', requestId: 'long-reply' });
    assert.equal(prepared.totalChunks, 80); // Former limit: 64 chunks and 3 MiB.
    assert.equal(prepared.action.speechDurationMs, 160_000);
    const command = prepareEnvironmentCommand(prepared.action, { allowedActions: ['speak'], source: 'system', username: 'fixture' });
    const artifact = claimRobotSpeech(prepared.action.speechArtifactId!)!;
    assert.equal(artifact.pcm.length, 160_000 * 32);
    assert.equal(command.input.speechDurationMs, 160_000);
    assert.equal(artifact.pcm.readInt16LE(artifact.pcm.length - 2), wavToRobotPcm(chunk).readInt16LE(63_998));
    assert.equal(claimRobotSpeech(artifact.id), null);
  } finally { synthesis.mock.restore(); }
});

test('a single long WAV has no artificial chunk-size ceiling', () => {
  const pcm = wavToRobotPcm(wav(90)); // Former limit: 2 MiB per WAV.
  assert.equal(pcm.length, 90 * 32_000);
  assert.equal(pcm.readInt16LE(0), 1234);
  assert.ok(pcm.readInt16LE(pcm.length - 2) > 0);
  assert.throws(() => wavToRobotPcm(Buffer.alloc(20)), /truncated/);
});

test('waiting replies survive long playback and orphan audio is still cleaned', () => {
  const replies = Array.from({ length: 6 }, () => stageRobotSpeech({ pcm: Buffer.alloc(640), durationMs: 20 }));
  assert.equal(fs.readdirSync(path.join(root, 'speech')).length, 6); // Former limit: 4.
  const orphan = stageRobotSpeech({ pcm: Buffer.alloc(640), durationMs: 20 });
  const old = new Date(Date.now() - 10 * 60_000);
  for (const reply of [...replies, orphan]) fs.utimesSync(path.join(root, 'speech', `${reply.id}.pcm`), old, old);
  persistQueueState({ items: replies.map((reply, index) => ({ id: `job-${index}`, type: 'environment_command',
    state: 'queued', input: { type: 'speak', speechArtifactId: reply.id } })), history: [],
    durableReceipts: [], bodyOwners: {}, inFlightRemote: [], lastUpdated: new Date().toISOString() } as any);
  const next = stageRobotSpeech({ pcm: Buffer.alloc(640), durationMs: 20 });
  for (const reply of replies) assert.deepEqual(claimRobotSpeech(reply.id)?.pcm, reply.pcm);
  assert.equal(claimRobotSpeech(orphan.id), null);
  assert.ok(claimRobotSpeech(next.id));
});
