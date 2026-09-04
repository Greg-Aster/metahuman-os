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
import { createKokoroTTSService } from '../tts.js';

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

function getRobotVolumePercent(username: string): number | undefined {
  const config = readVoiceConfig(username);
  const configuredRobotVolume = config.tts?.robotVolumePercent;
  return typeof configuredRobotVolume === 'number'
    && Number.isFinite(configuredRobotVolume)
    && configuredRobotVolume >= 1
    && configuredRobotVolume <= 100
    ? configuredRobotVolume
    : undefined;
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
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function collectKokoroWavChunks(
  service: ReturnType<typeof createKokoroTTSService>,
  text: string,
  options: KokoroRobotSpeechOptions,
): Promise<Buffer[]> {
  const wavChunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of service.synthesizeStream(text, {
    signal: options.signal,
    voice: options.voiceId || options.voice,
    speakingRate: options.speed,
    langCode: options.langCode,
    requestId: options.requestId,
  })) {
    if (wavChunks.length >= MAX_ROBOT_WAV_CHUNKS) {
      throw new Error('Kokoro returned too many robot audio chunks');
    }
    receivedBytes += chunk.audio.length;
    if (receivedBytes > MAX_ROBOT_KOKORO_STREAM_BYTES) {
      throw new Error('Kokoro robot audio stream exceeds its size limit');
    }
    wavChunks.push(chunk.audio);
  }

  if (wavChunks.length === 0) throw new Error('Kokoro returned no robot audio');
  return wavChunks;
}

export async function renderRobotSpeech(
  options: KokoroRobotSpeechOptions,
): Promise<RobotSpeechDelivery> {
  const text = normalizeRobotSpeechText(options.text);
  if (!text) throw new Error('Robot speech contains no speakable text');
  const sessionId = options.sessionId || getRobotSpeakerSession();
  if (!sessionId) throw new Error('The Environment Bridge robot speaker is not ready');

  const service = createKokoroTTSService(options.username);
  const robotVolumePercent = getRobotVolumePercent(options.username);

  let artifactId: string | undefined;
  try {
    const wavChunks = await collectKokoroWavChunks(service, text, options);
    const artifact = stageRobotSpeech(
      combineRobotSpeechWavChunks(wavChunks, robotVolumePercent),
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
