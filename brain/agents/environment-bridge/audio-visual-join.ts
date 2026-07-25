import type { EnvironmentObservation } from '@metahuman/core/environment-interface';
import type { AudioUtteranceMetadata } from './audio-transport.js';

const DEFAULT_JOIN_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PENDING = 2;

interface PendingJoin {
  metadata: AudioUtteranceMetadata;
  transcript?: EnvironmentObservation;
  visual?: EnvironmentObservation;
  visualDeadlineReached: boolean;
  publishing: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface AudioVisualJoinOptions {
  publish: (observation: EnvironmentObservation) => Promise<void>;
  onError?: (error: Error) => void;
  timeoutMs?: number;
  maxPending?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function correlatedUtteranceId(observation: EnvironmentObservation): string {
  const metadata = record(observation.metadata);
  return typeof metadata?.audioUtteranceId === 'string'
    ? metadata.audioUtteranceId
    : '';
}

function visualMatchesUtterance(
  observation: EnvironmentObservation,
  metadata: AudioUtteranceMetadata,
): boolean {
  if (observation.sessionId !== metadata.sessionId) return false;
  const observationMetadata = record(observation.metadata);
  const frameMetadata = record(observation.visual?.metadata);
  const robotId = observationMetadata?.robotId ?? frameMetadata?.robotId;
  const epoch = observationMetadata?.epoch;
  return (
    (robotId === undefined || robotId === metadata.robotId)
    && (epoch === undefined || epoch === metadata.epoch)
  );
}

function mergeObservation(entry: PendingJoin): EnvironmentObservation {
  const transcript = entry.transcript!;
  const visual = entry.visual;
  return {
    ...(visual ?? transcript),
    timestamp: transcript.timestamp,
    text: transcript.text,
    feedback: undefined,
    visual: visual?.visual,
    visuals: visual?.visuals,
    metadata: {
      ...(record(transcript.metadata) ?? {}),
      ...(record(visual?.metadata) ?? {}),
      correlationId: entry.metadata.utteranceId,
      audioUtteranceId: entry.metadata.utteranceId,
      perceptionEvent: 'audio_utterance',
      visualStatus: visual ? 'matched' : 'unavailable',
    },
  };
}

export class AudioVisualObservationJoin {
  private readonly publish: (observation: EnvironmentObservation) => Promise<void>;
  private readonly onError: (error: Error) => void;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly pending = new Map<string, PendingJoin>();

  constructor(options: AudioVisualJoinOptions) {
    this.publish = options.publish;
    this.onError = options.onError ?? (() => {});
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS);
    this.maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
  }

  register(metadata: AudioUtteranceMetadata): boolean {
    if (this.pending.has(metadata.utteranceId)) return false;
    if (this.pending.size >= this.maxPending) return false;
    const entry: PendingJoin = {
      metadata,
      visualDeadlineReached: false,
      publishing: false,
      timer: setTimeout(() => {
        void this.expire(metadata.utteranceId).catch(this.onError);
      }, this.timeoutMs),
    };
    entry.timer.unref?.();
    this.pending.set(metadata.utteranceId, entry);
    return true;
  }

  async submitTranscript(
    utteranceId: string,
    observation: EnvironmentObservation,
  ): Promise<boolean> {
    const entry = this.pending.get(utteranceId);
    if (!entry) return false;
    entry.transcript = observation;
    await this.flush(entry);
    return true;
  }

  async submitVisual(observation: EnvironmentObservation): Promise<boolean> {
    const utteranceId = correlatedUtteranceId(observation);
    if (!utteranceId) return false;
    const entry = this.pending.get(utteranceId);
    if (!entry) return true;
    if (visualMatchesUtterance(observation, entry.metadata)) {
      entry.visual = observation;
      await this.flush(entry);
    }
    return true;
  }

  async expire(utteranceId: string): Promise<void> {
    const entry = this.pending.get(utteranceId);
    if (!entry) return;
    entry.visualDeadlineReached = true;
    await this.flush(entry);
  }

  drop(utteranceId: string): void {
    const entry = this.pending.get(utteranceId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(utteranceId);
  }

  close(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }

  private async flush(entry: PendingJoin): Promise<void> {
    if (
      entry.publishing
      || !entry.transcript
      || (!entry.visual && !entry.visualDeadlineReached)
    ) {
      return;
    }
    entry.publishing = true;
    clearTimeout(entry.timer);
    this.pending.delete(entry.metadata.utteranceId);
    await this.publish(mergeObservation(entry));
  }
}

