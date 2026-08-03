import {
  robotSpeechAudioLimits,
  type RobotSpeechArtifact,
} from '@metahuman/core';

export const ROBOT_SPEECH_MAGIC = Buffer.from('AIKSPK01', 'ascii');
const MAX_METADATA_BYTES = 4 * 1024;

export function encodeRobotSpeechMessage(params: {
  sessionId: string;
  actionId: string;
  durationMs: number;
  artifact: RobotSpeechArtifact;
}): Buffer {
  if (!params.sessionId.trim() || !params.actionId.trim()) {
    throw new Error('Robot speech transport requires session and action IDs');
  }
  if (
    !Number.isFinite(params.durationMs)
    || params.durationMs <= 0
    || params.durationMs > 15_000
  ) {
    throw new Error('Robot speech duration is outside the supported range');
  }
  const metadata = Buffer.from(JSON.stringify({
    type: 'audio.speech',
    version: 1,
    sessionId: params.sessionId,
    actionId: params.actionId,
    speechId: params.artifact.id,
    format: 'pcm_s16le',
    sampleRateHz: robotSpeechAudioLimits.sampleRateHz,
    channels: 1,
    frameBytes: robotSpeechAudioLimits.frameBytes,
    durationMs: Math.round(params.durationMs),
    pcmBytes: params.artifact.pcm.length,
  }));
  if (metadata.length > MAX_METADATA_BYTES) {
    throw new Error('Robot speech metadata exceeds its size limit');
  }
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32LE(metadata.length);
  return Buffer.concat([
    ROBOT_SPEECH_MAGIC,
    length,
    metadata,
    params.artifact.pcm,
  ]);
}
