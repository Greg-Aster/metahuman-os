import type { EnvironmentObservation } from '@metahuman/core/environment-interface';

const AUDIO_UTTERANCE_MAGIC = Buffer.from('AIKAUD01', 'ascii');
const AUDIO_UTTERANCE_HEADER_BYTES = AUDIO_UTTERANCE_MAGIC.length + 4;
const MAX_AUDIO_UTTERANCE_BYTES = 512 * 1024;
const MAX_AUDIO_METADATA_BYTES = 8 * 1024;
const EXPECTED_SAMPLE_RATE_HZ = 16000;
const EXPECTED_CHANNELS = 1;
const EXPECTED_BITS_PER_SAMPLE = 16;
const EXPECTED_FRAME_DURATION_MS = 20;

export interface AudioUtteranceMetadata {
  type: 'audio.utterance';
  version: 1;
  sessionId: string;
  utteranceId: string;
  robotId: string;
  epoch: number;
  startedAt: string;
  endedAt: string;
  firstCounter: number;
  lastCounter: number;
  frameCount: number;
  missingFrames: number;
  durationMs: number;
  wakeTriggered: boolean;
  truncated: boolean;
  format: 'wav';
  sampleRateHz: 16000;
  channels: 1;
  bitsPerSample: 16;
}

export interface ParsedAudioUtterance {
  metadata: AudioUtteranceMetadata;
  wav: Buffer;
}

type WavFacts = {
  audioFormat: number;
  channels: number;
  sampleRateHz: number;
  bitsPerSample: number;
  dataBytes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, name: string, maximum = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Audio utterance ${name} is invalid`);
  }
  return value;
}

function boundedInteger(value: unknown, name: string, maximum = 0xffffffff): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`Audio utterance ${name} is invalid`);
  }
  return Number(value);
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Audio utterance ${name} is invalid`);
  }
  return value;
}

function parseMetadata(value: unknown): AudioUtteranceMetadata {
  if (!isRecord(value) || value.type !== 'audio.utterance' || value.version !== 1) {
    throw new Error('Audio utterance metadata contract is invalid');
  }
  const metadata: AudioUtteranceMetadata = {
    type: 'audio.utterance',
    version: 1,
    sessionId: boundedString(value.sessionId, 'sessionId'),
    utteranceId: boundedString(value.utteranceId, 'utteranceId'),
    robotId: boundedString(value.robotId, 'robotId'),
    epoch: boundedInteger(value.epoch, 'epoch'),
    startedAt: boundedString(value.startedAt, 'startedAt'),
    endedAt: boundedString(value.endedAt, 'endedAt'),
    firstCounter: boundedInteger(value.firstCounter, 'firstCounter'),
    lastCounter: boundedInteger(value.lastCounter, 'lastCounter'),
    frameCount: boundedInteger(value.frameCount, 'frameCount', 750),
    missingFrames: boundedInteger(value.missingFrames, 'missingFrames', 750),
    durationMs: boundedInteger(value.durationMs, 'durationMs', 15000),
    wakeTriggered: requiredBoolean(value.wakeTriggered, 'wakeTriggered'),
    truncated: requiredBoolean(value.truncated, 'truncated'),
    format: value.format === 'wav' ? 'wav' : (() => { throw new Error('Audio utterance format is invalid'); })(),
    sampleRateHz: value.sampleRateHz === EXPECTED_SAMPLE_RATE_HZ
      ? EXPECTED_SAMPLE_RATE_HZ
      : (() => { throw new Error('Audio utterance sample rate is invalid'); })(),
    channels: value.channels === EXPECTED_CHANNELS
      ? EXPECTED_CHANNELS
      : (() => { throw new Error('Audio utterance channel count is invalid'); })(),
    bitsPerSample: value.bitsPerSample === EXPECTED_BITS_PER_SAMPLE
      ? EXPECTED_BITS_PER_SAMPLE
      : (() => { throw new Error('Audio utterance sample width is invalid'); })(),
  };
  if (
    metadata.frameCount < 1
    || metadata.durationMs < EXPECTED_FRAME_DURATION_MS
    || metadata.durationMs % EXPECTED_FRAME_DURATION_MS !== 0
    || !Number.isFinite(Date.parse(metadata.startedAt))
    || !Number.isFinite(Date.parse(metadata.endedAt))
  ) {
    throw new Error('Audio utterance timing metadata is invalid');
  }
  return metadata;
}

function inspectWav(wav: Buffer): WavFacts {
  if (
    wav.length < 44
    || wav.toString('ascii', 0, 4) !== 'RIFF'
    || wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Audio utterance does not contain a valid WAV container');
  }
  if (wav.readUInt32LE(4) + 8 !== wav.length) {
    throw new Error('Audio utterance WAV length is inconsistent');
  }

  let offset = 12;
  let facts: Partial<WavFacts> = {};
  while (offset + 8 <= wav.length) {
    const chunk = wav.toString('ascii', offset, offset + 4);
    const chunkBytes = wav.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + chunkBytes > wav.length) {
      throw new Error('Audio utterance WAV chunk is truncated');
    }
    if (chunk === 'fmt ' && chunkBytes >= 16) {
      facts = {
        ...facts,
        audioFormat: wav.readUInt16LE(payload),
        channels: wav.readUInt16LE(payload + 2),
        sampleRateHz: wav.readUInt32LE(payload + 4),
        bitsPerSample: wav.readUInt16LE(payload + 14),
      };
    } else if (chunk === 'data') {
      facts.dataBytes = chunkBytes;
    }
    offset = payload + chunkBytes + (chunkBytes % 2);
  }

  if (
    facts.audioFormat !== 1
    || facts.channels !== EXPECTED_CHANNELS
    || facts.sampleRateHz !== EXPECTED_SAMPLE_RATE_HZ
    || facts.bitsPerSample !== EXPECTED_BITS_PER_SAMPLE
    || typeof facts.dataBytes !== 'number'
  ) {
    throw new Error('Audio utterance WAV PCM contract is invalid');
  }
  return facts as WavFacts;
}

export function parseAudioUtteranceMessage(raw: Buffer): ParsedAudioUtterance {
  if (
    raw.length < AUDIO_UTTERANCE_HEADER_BYTES
    || raw.length > MAX_AUDIO_UTTERANCE_BYTES
    || !raw.subarray(0, AUDIO_UTTERANCE_MAGIC.length).equals(AUDIO_UTTERANCE_MAGIC)
  ) {
    throw new Error('Environment bridge received an invalid audio utterance envelope');
  }
  const metadataBytes = raw.readUInt32LE(AUDIO_UTTERANCE_MAGIC.length);
  if (
    metadataBytes < 2
    || metadataBytes > MAX_AUDIO_METADATA_BYTES
    || AUDIO_UTTERANCE_HEADER_BYTES + metadataBytes >= raw.length
  ) {
    throw new Error('Audio utterance metadata size is invalid');
  }
  const metadata = parseMetadata(JSON.parse(
    raw.toString('utf8', AUDIO_UTTERANCE_HEADER_BYTES, AUDIO_UTTERANCE_HEADER_BYTES + metadataBytes),
  ));
  const wav = raw.subarray(AUDIO_UTTERANCE_HEADER_BYTES + metadataBytes);
  const wavFacts = inspectWav(wav);
  const totalFrames = metadata.durationMs / EXPECTED_FRAME_DURATION_MS;
  const expectedDataBytes = metadata.durationMs * EXPECTED_SAMPLE_RATE_HZ
    * EXPECTED_CHANNELS * (EXPECTED_BITS_PER_SAMPLE / 8) / 1000;
  if (
    wavFacts.dataBytes !== expectedDataBytes
    || metadata.frameCount + metadata.missingFrames !== totalFrames
  ) {
    throw new Error('Audio utterance duration does not match its PCM payload');
  }
  return { metadata, wav };
}

export async function transcribeAudioUtterance(
  utterance: ParsedAudioUtterance,
  latestObservation: EnvironmentObservation,
  transcribe: (audio: Buffer, format: 'wav') => Promise<string>,
  now: () => Date = () => new Date(),
): Promise<EnvironmentObservation | null> {
  if (utterance.metadata.sessionId !== latestObservation.sessionId) {
    throw new Error('Audio utterance session does not match the connected environment');
  }
  const transcript = (await transcribe(utterance.wav, 'wav')).trim();
  if (!transcript) return null;

  const timestamp = now().toISOString();
  const audioMetadata = {
    utteranceId: utterance.metadata.utteranceId,
    robotId: utterance.metadata.robotId,
    epoch: utterance.metadata.epoch,
    startedAt: utterance.metadata.startedAt,
    endedAt: utterance.metadata.endedAt,
    durationMs: utterance.metadata.durationMs,
    frameCount: utterance.metadata.frameCount,
    missingFrames: utterance.metadata.missingFrames,
    wakeTriggered: utterance.metadata.wakeTriggered,
    truncated: utterance.metadata.truncated,
  };
  return {
    ...latestObservation,
    timestamp,
    visual: undefined,
    visuals: undefined,
    feedback: undefined,
    text: [{
      id: `ainekio-audio-${utterance.metadata.utteranceId}`,
      source: 'environment',
      text: transcript,
      timestamp,
      senderId: utterance.metadata.robotId,
      senderName: 'robot microphone',
      channel: 'microphone',
      metadata: audioMetadata,
    }],
    state: {
      ...(latestObservation.state ?? {}),
      lastAudioUtterance: audioMetadata,
    },
  };
}

export const audioTransportLimits = {
  maxMessageBytes: MAX_AUDIO_UTTERANCE_BYTES,
  maxMetadataBytes: MAX_AUDIO_METADATA_BYTES,
} as const;
