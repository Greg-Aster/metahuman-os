import type { EnvironmentObservation, EnvironmentVisualFrame } from './types.js';

const MAX_DIAGNOSTIC_EVENTS = 40;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024;
const MAX_EVENT_MESSAGE_LENGTH = 240;

export interface EnvironmentBridgeDiagnosticEvent {
  timestamp: string;
  kind: string;
  bytes?: number;
  status?: string;
  message?: string;
}

export interface EnvironmentBridgeTransportDiagnostics {
  inboundBytes: number;
  outboundBytes: number;
  inboundMessages: number;
  outboundMessages: number;
  inboundBytesPerSecond: number;
  outboundBytesPerSecond: number;
}

export interface EnvironmentBridgeMediaDiagnostics {
  imageFrames: number;
  imageBytes: number;
  audioUtterances: number;
  audioBytes: number;
}

export interface EnvironmentBridgeDiagnosticImage {
  id: string;
  timestamp: string;
  mimeType: string;
  bytes: number;
  available: boolean;
}

export interface EnvironmentBridgeDiagnosticAudio {
  utteranceId: string;
  timestamp: string;
  bytes: number;
  durationMs?: number;
  wakeTriggered?: boolean;
  truncated?: boolean;
  available: boolean;
}

export interface EnvironmentBridgeDiagnosticsSession {
  sessionId: string;
  robotId?: string;
  updatedAt: string;
  transport: EnvironmentBridgeTransportDiagnostics;
  media: EnvironmentBridgeMediaDiagnostics;
  microphoneLevel: number;
  pendingAudioUtterances: number;
  lastTranscriptionStatus?: string;
  lastTranscript?: string;
  robotStatus?: Record<string, unknown>;
  freestyleMovement?: EnvironmentBridgeFreestyleMovementDiagnostics;
  movementPlan?: EnvironmentBridgeMovementPlanDiagnostics;
  latestImage?: EnvironmentBridgeDiagnosticImage;
  latestAudio?: EnvironmentBridgeDiagnosticAudio;
  recentEvents: EnvironmentBridgeDiagnosticEvent[];
}

export interface EnvironmentBridgeFreestyleMovementDiagnostics {
  supported: boolean;
  enabled: boolean;
  available: boolean;
}

export interface EnvironmentBridgeMovementPlanDiagnostics {
  actionId?: string;
  sequence?: number;
  status: string;
  frameCount?: number;
  durationMs?: number;
  activeFrame?: number;
  message?: string;
  updatedAt: string;
}

export interface EnvironmentBridgeDiagnosticsSnapshot {
  updatedAt: string;
  sessions: EnvironmentBridgeDiagnosticsSession[];
}

export interface EnvironmentBridgeTelemetryUpdate {
  sessionId: string;
  timestamp?: string;
  robotId?: string;
  intervalMs?: number;
  inboundBytes?: number;
  outboundBytes?: number;
  inboundMessages?: number;
  outboundMessages?: number;
  imageFrames?: number;
  imageBytes?: number;
  audioUtterances?: number;
  audioBytes?: number;
  microphoneLevel?: number;
  pendingAudioUtterances?: number;
  transcriptionStatus?: string;
  transcript?: string;
  robotStatus?: Record<string, unknown>;
  freestyleMovement?: EnvironmentBridgeFreestyleMovementDiagnostics;
  movementPlan?: EnvironmentBridgeMovementPlanDiagnostics;
  events?: EnvironmentBridgeDiagnosticEvent[];
}

interface DiagnosticMedia {
  image?: { mimeType: string; data: Buffer };
  audio?: Buffer;
}

const sessions = new Map<string, EnvironmentBridgeDiagnosticsSession>();
const media = new Map<string, DiagnosticMedia>();
const subscribers = new Set<() => void>();

function nowIso(): string {
  return new Date().toISOString();
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundedInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  return Math.min(maximum, Math.floor(finiteNonNegative(value)));
}

function emptySession(sessionId: string, timestamp: string): EnvironmentBridgeDiagnosticsSession {
  return {
    sessionId,
    updatedAt: timestamp,
    transport: {
      inboundBytes: 0,
      outboundBytes: 0,
      inboundMessages: 0,
      outboundMessages: 0,
      inboundBytesPerSecond: 0,
      outboundBytesPerSecond: 0,
    },
    media: {
      imageFrames: 0,
      imageBytes: 0,
      audioUtterances: 0,
      audioBytes: 0,
    },
    microphoneLevel: 0,
    pendingAudioUtterances: 0,
    recentEvents: [],
  };
}

function notify(): void {
  for (const subscriber of subscribers) {
    try {
      subscriber();
    } catch {}
  }
}

function boundedEvents(
  existing: EnvironmentBridgeDiagnosticEvent[],
  incoming: EnvironmentBridgeDiagnosticEvent[] | undefined,
): EnvironmentBridgeDiagnosticEvent[] {
  const normalized = (incoming ?? []).flatMap(event => {
    if (!event || typeof event.kind !== 'string' || !event.kind.trim()) return [];
    return [{
      timestamp: typeof event.timestamp === 'string' ? event.timestamp : nowIso(),
      kind: event.kind.trim().slice(0, 80),
      bytes: boundedInteger(event.bytes) || undefined,
      status: typeof event.status === 'string' ? event.status.slice(0, 80) : undefined,
      message: typeof event.message === 'string'
        ? event.message.slice(0, MAX_EVENT_MESSAGE_LENGTH)
        : undefined,
    }];
  });
  return [...existing, ...normalized].slice(-MAX_DIAGNOSTIC_EVENTS);
}

export function recordEnvironmentBridgeTelemetry(
  update: EnvironmentBridgeTelemetryUpdate,
): EnvironmentBridgeDiagnosticsSnapshot {
  const sessionId = update.sessionId.trim().slice(0, 160);
  if (!sessionId) throw new Error('Environment bridge telemetry requires a sessionId');
  const timestamp = typeof update.timestamp === 'string' ? update.timestamp : nowIso();
  const current = sessions.get(sessionId) ?? emptySession(sessionId, timestamp);
  const intervalMs = Math.max(1, boundedInteger(update.intervalMs, 60_000));
  const inboundBytes = boundedInteger(update.inboundBytes);
  const outboundBytes = boundedInteger(update.outboundBytes);
  const microphoneLevel = update.microphoneLevel === undefined
    ? current.microphoneLevel
    : Math.max(0, Math.min(1, finiteNonNegative(update.microphoneLevel)));

  const next: EnvironmentBridgeDiagnosticsSession = {
    ...current,
    robotId: typeof update.robotId === 'string' && update.robotId.trim()
      ? update.robotId.trim().slice(0, 160)
      : current.robotId,
    updatedAt: timestamp,
    transport: {
      inboundBytes: current.transport.inboundBytes + inboundBytes,
      outboundBytes: current.transport.outboundBytes + outboundBytes,
      inboundMessages: current.transport.inboundMessages + boundedInteger(update.inboundMessages),
      outboundMessages: current.transport.outboundMessages + boundedInteger(update.outboundMessages),
      inboundBytesPerSecond: Math.round((inboundBytes * 1000) / intervalMs),
      outboundBytesPerSecond: Math.round((outboundBytes * 1000) / intervalMs),
    },
    media: {
      imageFrames: current.media.imageFrames + boundedInteger(update.imageFrames),
      imageBytes: current.media.imageBytes + boundedInteger(update.imageBytes),
      audioUtterances: current.media.audioUtterances + boundedInteger(update.audioUtterances),
      audioBytes: current.media.audioBytes + boundedInteger(update.audioBytes),
    },
    microphoneLevel,
    pendingAudioUtterances: update.pendingAudioUtterances === undefined
      ? current.pendingAudioUtterances
      : boundedInteger(update.pendingAudioUtterances, 2),
    lastTranscriptionStatus: typeof update.transcriptionStatus === 'string'
      ? update.transcriptionStatus.slice(0, 80)
      : current.lastTranscriptionStatus,
    lastTranscript: typeof update.transcript === 'string'
      ? update.transcript.slice(0, 4096)
      : current.lastTranscript,
    robotStatus: update.robotStatus && typeof update.robotStatus === 'object'
      ? { ...update.robotStatus }
      : current.robotStatus,
    freestyleMovement: update.freestyleMovement && typeof update.freestyleMovement === 'object'
      ? {
          supported: update.freestyleMovement.supported === true,
          enabled: update.freestyleMovement.enabled === true,
          available: update.freestyleMovement.available === true,
        }
      : current.freestyleMovement,
    movementPlan: update.movementPlan && typeof update.movementPlan === 'object'
      ? {
          actionId: typeof update.movementPlan.actionId === 'string'
            ? update.movementPlan.actionId.slice(0, 160)
            : current.movementPlan?.actionId,
          sequence: update.movementPlan.sequence === undefined
            ? current.movementPlan?.sequence
            : boundedInteger(update.movementPlan.sequence),
          status: typeof update.movementPlan.status === 'string'
            ? update.movementPlan.status.slice(0, 80)
            : current.movementPlan?.status || 'unknown',
          frameCount: update.movementPlan.frameCount === undefined
            ? current.movementPlan?.frameCount
            : boundedInteger(update.movementPlan.frameCount, 32),
          durationMs: update.movementPlan.durationMs === undefined
            ? current.movementPlan?.durationMs
            : boundedInteger(update.movementPlan.durationMs, 10_000),
          activeFrame: update.movementPlan.activeFrame === undefined
            ? current.movementPlan?.activeFrame
            : boundedInteger(update.movementPlan.activeFrame, 32),
          message: typeof update.movementPlan.message === 'string'
            ? update.movementPlan.message.slice(0, MAX_EVENT_MESSAGE_LENGTH)
            : undefined,
          updatedAt: typeof update.movementPlan.updatedAt === 'string'
            ? update.movementPlan.updatedAt
            : timestamp,
        }
      : current.movementPlan,
    recentEvents: boundedEvents(current.recentEvents, update.events),
  };
  sessions.set(sessionId, next);
  notify();
  return getEnvironmentBridgeDiagnosticsSnapshot();
}

function visualData(visual: EnvironmentVisualFrame): { mimeType: string; data: Buffer } | undefined {
  if (typeof visual.dataUrl !== 'string') return undefined;
  const match = visual.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return undefined;
  const data = Buffer.from(match[2]!, 'base64');
  if (data.length < 4 || data.length > MAX_IMAGE_BYTES) return undefined;
  return { mimeType: match[1]!, data };
}

export function recordEnvironmentBridgeDiagnosticObservation(
  observation: EnvironmentObservation,
): void {
  const visual = observation.visual ?? observation.visuals?.[0];
  if (!visual) return;
  const decoded = visualData(visual);
  if (!decoded) return;
  const timestamp = visual.timestamp || observation.timestamp || nowIso();
  const current = sessions.get(observation.sessionId)
    ?? emptySession(observation.sessionId, timestamp);
  media.set(observation.sessionId, {
    ...media.get(observation.sessionId),
    image: decoded,
  });
  sessions.set(observation.sessionId, {
    ...current,
    updatedAt: timestamp,
    latestImage: {
      id: visual.id,
      timestamp,
      mimeType: decoded.mimeType,
      bytes: decoded.data.length,
      available: true,
    },
  });
  notify();
}

export function storeEnvironmentBridgeDiagnosticAudio(
  sessionId: string,
  utteranceId: string,
  audio: Buffer,
  metadata: {
    timestamp?: string;
    durationMs?: number;
    wakeTriggered?: boolean;
    truncated?: boolean;
  } = {},
): EnvironmentBridgeDiagnosticAudio {
  if (!sessionId.trim() || !utteranceId.trim()) {
    throw new Error('Diagnostic audio requires session and utterance identifiers');
  }
  if (
    audio.length < 44
    || audio.length > MAX_AUDIO_BYTES
    || audio.toString('ascii', 0, 4) !== 'RIFF'
    || audio.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Diagnostic audio must be a bounded WAV file');
  }
  const timestamp = metadata.timestamp ?? nowIso();
  const current = sessions.get(sessionId) ?? emptySession(sessionId, timestamp);
  const latestAudio: EnvironmentBridgeDiagnosticAudio = {
    utteranceId: utteranceId.slice(0, 160),
    timestamp,
    bytes: audio.length,
    durationMs: metadata.durationMs === undefined
      ? undefined
      : boundedInteger(metadata.durationMs, 15_000),
    wakeTriggered: metadata.wakeTriggered,
    truncated: metadata.truncated,
    available: true,
  };
  media.set(sessionId, { ...media.get(sessionId), audio: Buffer.from(audio) });
  sessions.set(sessionId, { ...current, updatedAt: timestamp, latestAudio });
  notify();
  return latestAudio;
}

export function getEnvironmentBridgeDiagnosticMedia(
  sessionId: string,
  kind: 'image' | 'audio',
): { data: Buffer; contentType: string } | undefined {
  const item = media.get(sessionId);
  if (kind === 'image' && item?.image) {
    return { data: Buffer.from(item.image.data), contentType: item.image.mimeType };
  }
  if (kind === 'audio' && item?.audio) {
    return { data: Buffer.from(item.audio), contentType: 'audio/wav' };
  }
  return undefined;
}

export function getEnvironmentBridgeDiagnosticsSnapshot(): EnvironmentBridgeDiagnosticsSnapshot {
  const values = [...sessions.values()]
    .map(session => ({
      ...session,
      transport: { ...session.transport },
      media: { ...session.media },
      robotStatus: session.robotStatus ? { ...session.robotStatus } : undefined,
      freestyleMovement: session.freestyleMovement ? { ...session.freestyleMovement } : undefined,
      movementPlan: session.movementPlan ? { ...session.movementPlan } : undefined,
      latestImage: session.latestImage ? { ...session.latestImage } : undefined,
      latestAudio: session.latestAudio ? { ...session.latestAudio } : undefined,
      recentEvents: session.recentEvents.map(event => ({ ...event })),
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return { updatedAt: values[0]?.updatedAt ?? nowIso(), sessions: values };
}

export function subscribeEnvironmentBridgeDiagnostics(callback: () => void): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function resetEnvironmentBridgeDiagnosticsForTests(): void {
  sessions.clear();
  media.clear();
  subscribers.clear();
}
