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
import type { EnvironmentAction } from '../environment-interface/types.js';
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js';

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

/** Each synthesized chunk is admitted while subsequent audio is still rendering. */
export async function* prepareRobotSpeechChunks(
  options: KokoroRobotSpeechOptions,
): AsyncGenerator<{ action: Partial<EnvironmentAction>; index: number; totalChunks: number }> {
  const text = normalizeRobotSpeechText(options.text);
  if (!text) throw new Error('Robot speech contains no speakable text');
  const sessionId = options.sessionId || getRobotSpeakerSession();
  if (!sessionId) throw new Error('The Environment Bridge robot speaker is not ready');
  const service = createKokoroTTSService(options.username);
  const robotVolumePercent = getRobotVolumePercent(options.username);
  let count = 0;
  for await (const chunk of service.synthesizeStream(text, {
    signal: options.signal, voice: options.voiceId || options.voice,
    speakingRate: options.speed, langCode: options.langCode, requestId: options.requestId,
  })) {
    options.signal?.throwIfAborted();
    const artifact = stageRobotSpeech(combineRobotSpeechWavChunks([chunk.audio], robotVolumePercent));
    count++;
    yield { action: { type: 'speak', sessionId, speechArtifactId: artifact.id,
      speechDurationMs: artifact.durationMs, metadata: { owner: 'tts-out',
        speechRequestId: options.requestId, speechChunkIndex: chunk.index, speechChunkCount: chunk.total } },
      index: chunk.index, totalChunks: chunk.total };
  }
  if (!count) throw new Error('Kokoro returned no robot audio');
}

/** Finite Coordinator work; each chunk uses the same checkpointed playback owner. */
export async function runRobotSpeechWork(
  input: KokoroRobotSpeechOptions & { graph: SvelteFlowGraph; generation?: number },
  username: string,
  signal: AbortSignal,
): Promise<{ actionId: string; actionIds: string[] }> {
  const { runGraph, requireGraphNodeOutput } = await import('../graph-runtime.js');
  const actionIds: string[] = [];
  for await (const prepared of prepareRobotSpeechChunks({ ...input, username, signal })) {
    const result = await runGraph({ graph: input.graph, signal,
      context: { username, userId: username, preparedRobotSpeech: prepared, ttsGeneration: input.generation } });
    if (result.status !== 'completed') throw result.error ?? new Error('Robot speech admission did not complete');
    actionIds.push(requireGraphNodeOutput(result, 'robot_speech_delivery').actionId);
  }
  return { actionId: actionIds[0]!, actionIds };
}

export async function renderRobotSpeech(options: KokoroRobotSpeechOptions): Promise<RobotSpeechDelivery> {
  let actionId = '';
  let totalChunks = 0;
  for await (const prepared of prepareRobotSpeechChunks(options)) {
    try {
      const action = enqueueEnvironmentAction(prepared.action, {
        allowedActions: ['speak'], username: options.username, source: 'system',
        correlationId: options.requestId, idempotencyKey: `tts-render:${options.requestId}:${prepared.index}`,
      });
      actionId ||= action.id;
      totalChunks = prepared.totalChunks;
    } catch (error) {
      if (prepared.action.speechArtifactId) discardRobotSpeech(prepared.action.speechArtifactId);
      throw error;
    }
  }
  return { actionId, requestId: options.requestId, totalChunks };
}
