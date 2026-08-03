import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { systemPaths } from '../paths.js';

const TARGET_SAMPLE_RATE = 16_000;
const FRAME_BYTES = 640;
const MAX_PCM_BYTES = 480_000;
const MAX_WAV_BYTES = 2 * 1024 * 1024;
const MAX_STAGED_ARTIFACTS = 4;
const ARTIFACT_TTL_MS = 2 * 60_000;
const ARTIFACT_ID = /^speech-[a-zA-Z0-9-]{1,96}$/;

export interface RobotSpeechAudio {
  pcm: Buffer;
  durationMs: number;
}

export interface RobotSpeechArtifact extends RobotSpeechAudio {
  id: string;
}

function spoolDir(): string {
  return process.env.MH_ENVIRONMENT_SPEECH_SPOOL?.trim()
    || path.join(systemPaths.run, 'environment-speech');
}

function artifactPath(id: string): string {
  if (!ARTIFACT_ID.test(id)) throw new Error('Invalid robot speech artifact ID');
  return path.join(spoolDir(), `${id}.pcm`);
}

function cleanupSpool(now = Date.now()): void {
  const dir = spoolDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const artifacts = fs.readdirSync(dir)
    .filter(name => /^speech-[a-zA-Z0-9-]{1,96}\.(?:pcm|claim-\d+)$/.test(name))
    .map(name => {
      const file = path.join(dir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  for (const artifact of artifacts) {
    if (now - artifact.mtimeMs > ARTIFACT_TTL_MS) {
      try { fs.unlinkSync(artifact.file); } catch {}
    }
  }

  const staged = fs.readdirSync(dir)
    .filter(name => /^speech-[a-zA-Z0-9-]{1,96}\.pcm$/.test(name))
    .map(name => {
      const file = path.join(dir, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  while (staged.length >= MAX_STAGED_ARTIFACTS) {
    const oldest = staged.shift();
    if (oldest) {
      try { fs.unlinkSync(oldest.file); } catch {}
    }
  }
}

function readPcmFrame(wav: Buffer, dataOffset: number, channels: number, frame: number): number {
  const byteOffset = dataOffset + frame * channels * 2;
  if (channels === 1) return wav.readInt16LE(byteOffset);
  return Math.trunc(
    (wav.readInt16LE(byteOffset) + wav.readInt16LE(byteOffset + 2)) / 2,
  );
}

export function wavToRobotPcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.length > MAX_WAV_BYTES) {
    throw new Error('Kokoro WAV chunk is outside the supported size');
  }
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Kokoro returned an invalid WAV chunk');
  }

  let format: { channels: number; sampleRate: number; bits: number; encoding: number } | undefined;
  let dataOffset = -1;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length) throw new Error('Kokoro WAV chunk is truncated');
    if (id === 'fmt ' && size >= 16) {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bits: wav.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      dataOffset = start;
      dataBytes = size;
    }
    offset = end + (size & 1);
  }

  if (
    !format
    || format.encoding !== 1
    || ![1, 2].includes(format.channels)
    || format.bits !== 16
    || format.sampleRate < 8_000
    || format.sampleRate > 48_000
    || dataOffset < 0
  ) {
    throw new Error('Kokoro WAV must be mono or stereo 16-bit PCM');
  }

  const sourceFrames = Math.floor(dataBytes / (format.channels * 2));
  if (sourceFrames < 1) return Buffer.alloc(0);
  const outputFrames = Math.max(
    1,
    Math.round(sourceFrames * TARGET_SAMPLE_RATE / format.sampleRate),
  );
  const output = Buffer.allocUnsafe(outputFrames * 2);
  for (let index = 0; index < outputFrames; index += 1) {
    const position = index * format.sampleRate / TARGET_SAMPLE_RATE;
    const left = Math.min(sourceFrames - 1, Math.floor(position));
    const right = Math.min(sourceFrames - 1, left + 1);
    const fraction = position - left;
    const leftValue = readPcmFrame(wav, dataOffset, format.channels, left);
    const rightValue = readPcmFrame(wav, dataOffset, format.channels, right);
    const sample = Math.max(
      -32_768,
      Math.min(32_767, Math.round(leftValue + (rightValue - leftValue) * fraction)),
    );
    output.writeInt16LE(sample, index * 2);
  }
  return output;
}

export function normalizeRobotSpeechVolume(
  pcm: Buffer,
  volumePercent: number,
): Buffer {
  if (
    !Number.isFinite(volumePercent)
    || volumePercent < 1
    || volumePercent > 100
  ) {
    throw new Error('Robot speech volume must be between 1 and 100 percent');
  }
  if (pcm.length % 2 !== 0) {
    throw new Error('Robot speech PCM must contain complete 16-bit samples');
  }

  let sourcePeak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    sourcePeak = Math.max(sourcePeak, Math.abs(pcm.readInt16LE(offset)));
  }
  if (sourcePeak === 0) return Buffer.from(pcm);

  const targetPeak = Math.round(32_767 * volumePercent / 100);
  const gain = targetPeak / sourcePeak;
  const normalized = Buffer.allocUnsafe(pcm.length);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = Math.round(pcm.readInt16LE(offset) * gain);
    normalized.writeInt16LE(Math.max(-32_768, Math.min(32_767, sample)), offset);
  }
  return normalized;
}

export function combineRobotSpeechWavChunks(
  chunks: Buffer[],
  volumePercent?: number,
): RobotSpeechAudio {
  const converted: Buffer[] = [];
  let pcmBytes = 0;
  for (const chunk of chunks) {
    const pcm = wavToRobotPcm(chunk);
    pcmBytes += pcm.length;
    if (pcmBytes > MAX_PCM_BYTES) {
      throw new Error('Robot speech exceeds the 15 second playback limit');
    }
    if (pcm.length) converted.push(pcm);
  }
  if (pcmBytes === 0) throw new Error('Kokoro produced no playable robot audio');

  const combined = Buffer.concat(converted);
  const leveled = volumePercent === undefined
    ? combined
    : normalizeRobotSpeechVolume(combined, volumePercent);
  const durationMs = Math.ceil(pcmBytes / 32);
  const padding = (FRAME_BYTES - (pcmBytes % FRAME_BYTES)) % FRAME_BYTES;
  return {
    pcm: Buffer.concat([leveled, Buffer.alloc(padding)]),
    durationMs,
  };
}

export function stageRobotSpeech(audio: RobotSpeechAudio): RobotSpeechArtifact {
  if (
    audio.pcm.length === 0
    || audio.pcm.length > MAX_PCM_BYTES
    || audio.pcm.length % FRAME_BYTES !== 0
  ) {
    throw new Error('Robot speech PCM is not a bounded sequence of 640-byte frames');
  }
  cleanupSpool();
  const id = `speech-${Date.now()}-${randomBytes(6).toString('hex')}`;
  const file = artifactPath(id);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, audio.pcm, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
  return { id, pcm: audio.pcm, durationMs: audio.durationMs };
}

export function claimRobotSpeech(id: string): RobotSpeechArtifact | null {
  cleanupSpool();
  const file = artifactPath(id);
  const claimed = `${file.slice(0, -4)}.claim-${process.pid}`;
  try {
    fs.renameSync(file, claimed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const pcm = fs.readFileSync(claimed);
    if (pcm.length === 0 || pcm.length > MAX_PCM_BYTES || pcm.length % FRAME_BYTES !== 0) {
      throw new Error('Claimed robot speech artifact is invalid');
    }
    return { id, pcm, durationMs: Math.ceil(pcm.length / 32) };
  } finally {
    try { fs.unlinkSync(claimed); } catch {}
  }
}

export function discardRobotSpeech(id: string): void {
  try { fs.unlinkSync(artifactPath(id)); } catch {}
}

export const robotSpeechAudioLimits = {
  frameBytes: FRAME_BYTES,
  maxPcmBytes: MAX_PCM_BYTES,
  sampleRateHz: TARGET_SAMPLE_RATE,
};
