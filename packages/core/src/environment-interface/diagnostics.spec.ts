import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  getEnvironmentBridgeDiagnosticMedia,
  getEnvironmentBridgeDiagnosticsSnapshot,
  recordEnvironmentBridgeDiagnosticObservation,
  recordEnvironmentBridgeTelemetry,
  resetEnvironmentBridgeDiagnosticsForTests,
  storeEnvironmentBridgeDiagnosticAudio,
} from './diagnostics.js';

afterEach(() => resetEnvironmentBridgeDiagnosticsForTests());

test('aggregates bounded transport rates, media counts, robot state, and events', () => {
  recordEnvironmentBridgeTelemetry({
    sessionId: 'robot-session',
    timestamp: '2026-07-17T21:00:00.000Z',
    intervalMs: 1000,
    inboundBytes: 3200,
    outboundBytes: 400,
    inboundMessages: 5,
    outboundMessages: 2,
    audioUtterances: 1,
    audioBytes: 2400,
    microphoneLevel: 0.5,
    pendingAudioUtterances: 1,
    transcriptionStatus: 'transcribing',
    robotStatus: { vbat: 7.4, mic_drops: 2 },
    freestyleMovement: { supported: true, enabled: true, available: true },
    movementPlan: {
      actionId: 'plan-1',
      sequence: 17,
      status: 'active',
      frameCount: 4,
      durationMs: 1800,
      activeFrame: 2,
      updatedAt: '2026-07-17T21:00:00.000Z',
    },
    events: [{
      timestamp: '2026-07-17T21:00:00.000Z',
      kind: 'audio.utterance',
      bytes: 2400,
    }],
  });
  recordEnvironmentBridgeTelemetry({
    sessionId: 'robot-session',
    timestamp: '2026-07-17T21:00:01.000Z',
    intervalMs: 500,
    inboundBytes: 1000,
    inboundMessages: 1,
    transcriptionStatus: 'completed',
    transcript: 'walk forward',
  });

  const session = getEnvironmentBridgeDiagnosticsSnapshot().sessions[0]!;
  assert.equal(session.transport.inboundBytes, 4200);
  assert.equal(session.transport.inboundBytesPerSecond, 2000);
  assert.equal(session.transport.outboundBytes, 400);
  assert.equal(session.media.audioUtterances, 1);
  assert.equal(session.microphoneLevel, 0.5);
  assert.equal(session.pendingAudioUtterances, 1);
  assert.equal(session.lastTranscriptionStatus, 'completed');
  assert.equal(session.lastTranscript, 'walk forward');
  assert.equal(session.robotStatus?.mic_drops, 2);
  assert.equal(session.freestyleMovement?.available, true);
  assert.equal(session.movementPlan?.actionId, 'plan-1');
  assert.equal(session.movementPlan?.activeFrame, 2);
  assert.equal(session.recentEvents[0]?.kind, 'audio.utterance');
});

test('keeps only the latest bounded image and WAV in memory', () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  recordEnvironmentBridgeDiagnosticObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-session',
    timestamp: '2026-07-17T21:00:00.000Z',
    capabilities: { actions: ['robotCommand'] },
    visual: {
      id: 'frame-1',
      timestamp: '2026-07-17T21:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`,
    },
  });
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36, 4);
  wav.write('WAVE', 8, 'ascii');
  storeEnvironmentBridgeDiagnosticAudio('robot-session', 'utterance-1', wav, {
    durationMs: 20,
    wakeTriggered: true,
  });

  const session = getEnvironmentBridgeDiagnosticsSnapshot().sessions[0]!;
  assert.equal(session.latestImage?.id, 'frame-1');
  assert.equal(session.latestAudio?.utteranceId, 'utterance-1');
  assert.deepEqual(
    getEnvironmentBridgeDiagnosticMedia('robot-session', 'image')?.data,
    image,
  );
  assert.deepEqual(
    getEnvironmentBridgeDiagnosticMedia('robot-session', 'audio')?.data,
    wav,
  );
  assert.throws(
    () => storeEnvironmentBridgeDiagnosticAudio(
      'robot-session',
      'too-large',
      Buffer.alloc((512 * 1024) + 1),
    ),
    /bounded WAV/,
  );
});
