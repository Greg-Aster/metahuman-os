import fs from 'node:fs';
import { getProfilePaths } from '../path-builder.js';
import {
  enqueueEnvironmentAction,
  getLatestEnvironmentObservation,
} from '../environment-interface/store.js';
import {
  combineRobotSpeechWavChunks,
  discardRobotSpeech,
  stageRobotSpeech,
} from './robot-audio.js';

const MAX_ROBOT_KOKORO_STREAM_BYTES = 3 * 1024 * 1024;
const MAX_ROBOT_WAV_CHUNKS = 64;

export interface SpeechOutputSettings {
  provider: string;
  outputTarget: 'local' | 'robot';
  speechDisabled: boolean;
}

export interface RobotSpeechDelivery {
  actionId: string;
  requestId: string;
  totalChunks: number;
}

interface KokoroRobotSpeechOptions {
  username: string;
  text: string;
  requestId: string;
  signal?: AbortSignal;
  voice?: string;
  voiceId?: string;
  speed?: number;
  langCode?: string;
  sessionId?: string;
}

interface KokoroConfig {
  voice: string;
  speed: number;
  langCode: string;
  customVoicepack: string | null;
  normalize: boolean;
  robotVolumePercent?: number;
}

function readVoiceConfig(username: string): Record<string, any> {
  const voiceConfig = getProfilePaths(username).voiceConfig;
  if (!fs.existsSync(voiceConfig)) return {};
  try {
    return JSON.parse(fs.readFileSync(voiceConfig, 'utf8')) as Record<string, any>;
  } catch (error) {
    console.warn(`[robot-speech] Failed to load voice config for ${username}:`, error);
    return {};
  }
}

export function getSpeechOutputSettings(username: string): SpeechOutputSettings {
  const config = readVoiceConfig(username);
  return {
    provider: typeof config.tts?.provider === 'string' ? config.tts.provider : 'kokoro',
    outputTarget: config.tts?.outputTarget === 'robot' ? 'robot' : 'local',
    speechDisabled: config.tts?.speechDisabled === true,
  };
}

export function getRobotSpeakerSession(): string | undefined {
  const observation = getLatestEnvironmentObservation();
  const body = observation?.state?.body;
  const speakerReady = body
    && typeof body === 'object'
    && !Array.isArray(body)
    && (body as Record<string, unknown>).speakerReady === true;
  return speakerReady ? observation?.sessionId : undefined;
}

function resolveKokoroConfig(
  username: string,
  options: Pick<KokoroRobotSpeechOptions, 'voice' | 'voiceId' | 'speed' | 'langCode'>,
): KokoroConfig {
  const config = readVoiceConfig(username);
  const saved = config.tts?.kokoro ?? {};
  const requestedVoice = options.voiceId || options.voice;
  const builtInVoiceRequested = Boolean(
    requestedVoice && /^[a-z]{2}_[a-z]+$/.test(requestedVoice),
  );
  const useCustomVoicepack = saved.useCustomVoicepack === true
    && typeof saved.customVoicepackPath === 'string'
    && saved.customVoicepackPath.length > 0
    && !builtInVoiceRequested;
  const configuredRobotVolume = config.tts?.robotVolumePercent;
  const robotVolumePercent = typeof configuredRobotVolume === 'number'
    && Number.isFinite(configuredRobotVolume)
    && configuredRobotVolume >= 1
    && configuredRobotVolume <= 100
    ? configuredRobotVolume
    : undefined;

  return {
    voice: requestedVoice || saved.voice || 'af_heart',
    speed: options.speed ?? saved.speed ?? 1,
    langCode: options.langCode || saved.langCode || 'a',
    customVoicepack: useCustomVoicepack ? saved.customVoicepackPath : null,
    normalize: useCustomVoicepack ? saved.normalizeCustomVoicepacks !== false : false,
    robotVolumePercent,
  };
}

export function normalizeRobotSpeechText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[*/]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function collectKokoroWavChunks(
  body: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal,
): Promise<Buffer[]> {
  if (!body) throw new Error('Kokoro returned no audio stream');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const wavChunks: Buffer[] = [];
  let buffer = '';
  let receivedBytes = 0;
  let completed = false;

  const processBlock = (block: string): void => {
    const rawData = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!rawData) return;
    const event = JSON.parse(rawData) as Record<string, unknown>;
    if (event.event === 'complete') {
      completed = true;
      return;
    }
    if (event.event === 'error') {
      throw new Error(String(event.error || 'Kokoro synthesis failed'));
    }
    const encoded = event.audio_base64;
    if (
      typeof encoded !== 'string'
      || encoded.length === 0
      || encoded.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      || wavChunks.length >= MAX_ROBOT_WAV_CHUNKS
    ) {
      throw new Error('Kokoro returned an invalid robot audio event');
    }
    const wav = Buffer.from(encoded, 'base64');
    if (typeof event.audio_size === 'number' && event.audio_size !== wav.length) {
      throw new Error('Kokoro audio size does not match its event');
    }
    wavChunks.push(wav);
  };

  try {
    while (!completed) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_ROBOT_KOKORO_STREAM_BYTES) {
        throw new Error('Kokoro robot audio stream exceeds its size limit');
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = buffer.match(/\r?\n\r?\n/);
        if (!boundary || boundary.index === undefined) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        processBlock(block);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!completed) throw new Error('Kokoro stream ended before completion');
  return wavChunks;
}

export async function renderRobotSpeech(
  options: KokoroRobotSpeechOptions,
): Promise<RobotSpeechDelivery> {
  const text = normalizeRobotSpeechText(options.text);
  if (!text) throw new Error('Robot speech contains no speakable text');
  const sessionId = options.sessionId || getRobotSpeakerSession();
  if (!sessionId) throw new Error('The Environment Bridge robot speaker is not ready');

  const kokoro = resolveKokoroConfig(options.username, options);
  const kokoroServerUrl = process.env.KOKORO_SERVER_URL || 'http://127.0.0.1:9882';
  const response = await fetch(`${kokoroServerUrl}/synthesize-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      lang_code: kokoro.langCode,
      voice: kokoro.voice,
      speed: kokoro.speed,
      custom_voicepack: kokoro.customVoicepack,
      normalize: kokoro.normalize,
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Kokoro server error (${response.status}): ${message}`);
  }

  let artifactId: string | undefined;
  try {
    const wavChunks = await collectKokoroWavChunks(response.body, options.signal);
    const artifact = stageRobotSpeech(
      combineRobotSpeechWavChunks(wavChunks, kokoro.robotVolumePercent),
    );
    artifactId = artifact.id;
    const action = enqueueEnvironmentAction(
      {
        type: 'speak',
        sessionId,
        speechArtifactId: artifact.id,
        speechDurationMs: artifact.durationMs,
        metadata: { owner: 'tts-out' },
      },
      {
        allowedActions: ['speak'],
        username: options.username,
        source: 'system',
        correlationId: options.requestId,
        idempotencyKey: `tts-render:${options.requestId}`,
      },
    );
    artifactId = undefined;
    return {
      actionId: action.id,
      requestId: options.requestId,
      totalChunks: wavChunks.length,
    };
  } catch (error) {
    if (artifactId) discardRobotSpeech(artifactId);
    throw error;
  }
}
