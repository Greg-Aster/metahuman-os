import fs from 'node:fs';
import path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import {
  acquireLock,
  transcribeAudio,
} from '@metahuman/core';
import type {
  EnvironmentFeedback,
  EnvironmentObservation,
} from '@metahuman/core/environment-interface';
import { ROOT } from '@metahuman/core/paths';
import {
  audioTransportLimits,
  parseAudioUtteranceMessage,
  transcribeAudioUtterance,
  type AudioUtteranceMetadata,
  type ParsedAudioUtterance,
} from './audio-transport.js';

const LOG_PREFIX = '[environment-bridge]';
const PROTOCOL_VERSION = 1;
const RECONNECT_DELAY_MS = 2_000;
const MAX_MESSAGE_BYTES = audioTransportLimits.maxMessageBytes;
const MAX_PENDING_AUDIO_UTTERANCES = 2;
const DIAGNOSTIC_TELEMETRY_INTERVAL_MS = 1_000;
const MAX_DIAGNOSTIC_EVENTS_PER_WINDOW = 20;

interface DiagnosticEvent {
  timestamp: string;
  kind: string;
  bytes?: number;
  status?: string;
  message?: string;
}

interface DiagnosticWindow {
  startedAt: number;
  inboundBytes: number;
  outboundBytes: number;
  inboundMessages: number;
  outboundMessages: number;
  imageFrames: number;
  imageBytes: number;
  audioUtterances: number;
  audioBytes: number;
  microphoneLevel?: number;
  robotId?: string;
  robotStatus?: Record<string, unknown>;
  transcriptionStatus?: string;
  transcript?: string;
  freestyleMovement?: {
    supported: boolean;
    enabled: boolean;
    available: boolean;
  };
  movementPlan?: {
    actionId?: string;
    sequence?: number;
    status: string;
    frameCount?: number;
    durationMs?: number;
    activeFrame?: number;
    message?: string;
    updatedAt: string;
  };
  events: DiagnosticEvent[];
}

interface BridgeConfig {
  adapterUrl: string;
  adapterToken: string;
  coreUrl: string;
  serviceToken: string;
  graph: string;
  username: string;
}

interface ServiceConfig {
  services?: Record<string, Record<string, unknown>>;
}

function configValue(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readConfig(): BridgeConfig {
  let serviceConfig: ServiceConfig = {};
  try {
    serviceConfig = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'etc', 'services.json'), 'utf8'),
    ) as ServiceConfig;
  } catch {}
  const service = serviceConfig.services?.['environment-bridge'] ?? {};
  const adapterUrl = process.env.MH_ENVIRONMENT_ADAPTER_URL?.trim()
    || configValue(service, 'adapterUrl');
  const graph = process.env.MH_ENVIRONMENT_GRAPH?.trim()
    || configValue(service, 'graph')
    || 'environment';
  const adapterToken = process.env.MH_ENVIRONMENT_ADAPTER_TOKEN?.trim() || '';
  const serviceToken = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN?.trim() || '';
  const coreUrl = process.env.MH_ENVIRONMENT_CORE_URL?.trim()
    || 'http://127.0.0.1:4321';
  const username = process.env.MH_TRIGGER_USERNAME?.trim() || '';

  if (!adapterUrl) throw new Error('Environment adapter URL is not configured');
  const parsed = new URL(adapterUrl);
  if (!['ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error('Environment adapter URL must use ws:// or wss://');
  }
  if (!adapterToken) throw new Error('MH_ENVIRONMENT_ADAPTER_TOKEN is not configured');
  if (!serviceToken) throw new Error('MH_ENVIRONMENT_BRIDGE_TOKEN is not configured');
  if (!username) throw new Error('Environment bridge requires an owner user context');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(graph)) {
    throw new Error('Environment graph name is invalid');
  }

  return {
    adapterUrl: parsed.toString(),
    adapterToken,
    coreUrl: new URL(coreUrl).toString().replace(/\/$/, ''),
    serviceToken,
    graph,
    username,
  };
}

function waitForAbort(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

function rawDataBuffer(raw: RawData): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  return Buffer.from(raw);
}

function environmentObservation(value: unknown): EnvironmentObservation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const observation = value as Partial<EnvironmentObservation>;
  if (
    typeof observation.environmentId !== 'string'
    || typeof observation.adapter !== 'string'
    || typeof observation.sessionId !== 'string'
    || typeof observation.timestamp !== 'string'
    || !observation.capabilities
    || typeof observation.capabilities !== 'object'
  ) {
    return undefined;
  }
  return observation as EnvironmentObservation;
}

async function postJson(
  config: BridgeConfig,
  route: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(`${config.coreUrl}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      'Content-Type': 'application/json',
      'X-MetaHuman-Environment-User': config.username,
      'X-MetaHuman-Environment-Graph': config.graph,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`MetaHuman environment API failed (${response.status}): ${await response.text()}`);
  }
}

async function postDiagnosticAudio(
  config: BridgeConfig,
  utterance: ParsedAudioUtterance,
): Promise<void> {
  const response = await fetch(`${config.coreUrl}/api/environment-bridge/diagnostics/audio`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.serviceToken}`,
      'Content-Type': 'audio/wav',
      'X-Environment-Session-Id': utterance.metadata.sessionId,
      'X-Environment-Utterance-Id': utterance.metadata.utteranceId,
      'X-Environment-Timestamp': utterance.metadata.endedAt,
      'X-Environment-Duration-Ms': String(utterance.metadata.durationMs),
      'X-Environment-Wake-Triggered': String(utterance.metadata.wakeTriggered),
      'X-Environment-Truncated': String(utterance.metadata.truncated),
    },
    body: new Uint8Array(utterance.wav),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Environment diagnostic audio API failed (${response.status})`);
  }
}

async function consumeActionStream(
  config: BridgeConfig,
  sessionId: string,
  sendMessage: (message: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<void> {
  const url = new URL('/api/environment-bridge/stream', config.coreUrl);
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('limit', '32');
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${config.serviceToken}`,
    },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Environment action stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const rawData = block.match(/^data:\s*(.+)$/m)?.[1];
      if (event !== 'actions' || !rawData) continue;
      const data = JSON.parse(rawData) as { actions?: unknown[] };
      for (const action of data.actions ?? []) {
        if (!action || typeof action !== 'object') continue;
        sendMessage({
          type: 'environment.action',
          version: PROTOCOL_VERSION,
          action,
        });
      }
    }
  }
}

async function connectOnce(config: BridgeConfig, signal: AbortSignal): Promise<void> {
  const websocket = new WebSocket(config.adapterUrl, {
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const localAbort = new AbortController();
  let diagnosticTimer: NodeJS.Timeout | undefined;
  const abort = () => {
    localAbort.abort();
    websocket.close(1000, 'environment bridge stopping');
  };
  signal.addEventListener('abort', abort, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      websocket.once('open', resolve);
      websocket.once('error', reject);
    });
    let actionStream: Promise<void> | undefined;
    let pendingFeedback: EnvironmentFeedback | undefined;
    let latestObservation: EnvironmentObservation | undefined;
    let pendingAudioUtterances = 0;
    let audioQueue = Promise.resolve();
    let diagnosticSessionId = '';
    let telemetryQueue = Promise.resolve();
    const mediaUploads = new Set<Promise<void>>();
    const diagnostics: DiagnosticWindow = {
      startedAt: Date.now(),
      inboundBytes: 0,
      outboundBytes: 0,
      inboundMessages: 0,
      outboundMessages: 0,
      imageFrames: 0,
      imageBytes: 0,
      audioUtterances: 0,
      audioBytes: 0,
      events: [],
    };

    const diagnosticEvent = (event: DiagnosticEvent) => {
      diagnostics.events.push(event);
      if (diagnostics.events.length > MAX_DIAGNOSTIC_EVENTS_PER_WINDOW) {
        diagnostics.events.splice(
          0,
          diagnostics.events.length - MAX_DIAGNOSTIC_EVENTS_PER_WINDOW,
        );
      }
    };

    const sendMessage = (message: Record<string, unknown>) => {
      if (websocket.readyState !== WebSocket.OPEN) return;
      const encoded = JSON.stringify(message);
      diagnostics.outboundBytes += Buffer.byteLength(encoded);
      diagnostics.outboundMessages += 1;
      if (message.type === 'environment.action' && message.action && typeof message.action === 'object') {
        const action = message.action as Record<string, unknown>;
        if (action.type === 'robotMotionPlan') {
          const frames = Array.isArray(action.frames) ? action.frames : [];
          const durationMs = frames.reduce((total, frame) => {
            if (!frame || typeof frame !== 'object') return total;
            const duration = (frame as Record<string, unknown>).durationMs;
            return total + (typeof duration === 'number' && Number.isFinite(duration) ? duration : 0);
          }, 0);
          diagnostics.movementPlan = {
            actionId: typeof action.id === 'string' ? action.id : undefined,
            status: 'dispatched',
            frameCount: frames.length,
            durationMs,
            activeFrame: 0,
            updatedAt: new Date().toISOString(),
          };
          diagnosticEvent({
            timestamp: diagnostics.movementPlan.updatedAt,
            kind: 'movement.plan',
            status: 'dispatched',
            message: `${diagnostics.movementPlan.actionId || 'unidentified'} frames=${frames.length} durationMs=${durationMs}`,
          });
        } else if (action.type === 'stop') {
          diagnosticEvent({
            timestamp: new Date().toISOString(),
            kind: 'movement.stop',
            status: 'dispatched',
            message: typeof action.id === 'string' ? action.id : undefined,
          });
        }
      }
      websocket.send(encoded);
    };

    const flushTelemetry = (_force = false): Promise<void> => {
      const flush = async () => {
        if (!diagnosticSessionId) return;
        const now = Date.now();
        const intervalMs = Math.max(1, now - diagnostics.startedAt);
        const eventCount = diagnostics.events.length;
        const counters = {
          inboundBytes: diagnostics.inboundBytes,
          outboundBytes: diagnostics.outboundBytes,
          inboundMessages: diagnostics.inboundMessages,
          outboundMessages: diagnostics.outboundMessages,
          imageFrames: diagnostics.imageFrames,
          imageBytes: diagnostics.imageBytes,
          audioUtterances: diagnostics.audioUtterances,
          audioBytes: diagnostics.audioBytes,
        };
        await postJson(config, '/api/environment-bridge/telemetry', {
          sessionId: diagnosticSessionId,
          timestamp: new Date(now).toISOString(),
          intervalMs,
          robotId: diagnostics.robotId,
          ...counters,
          microphoneLevel: diagnostics.microphoneLevel,
          pendingAudioUtterances,
          transcriptionStatus: diagnostics.transcriptionStatus,
          transcript: diagnostics.transcript,
          robotStatus: diagnostics.robotStatus,
          freestyleMovement: diagnostics.freestyleMovement,
          movementPlan: diagnostics.movementPlan,
          events: diagnostics.events.slice(0, eventCount),
        });
        diagnostics.startedAt = now;
        diagnostics.inboundBytes -= counters.inboundBytes;
        diagnostics.outboundBytes -= counters.outboundBytes;
        diagnostics.inboundMessages -= counters.inboundMessages;
        diagnostics.outboundMessages -= counters.outboundMessages;
        diagnostics.imageFrames -= counters.imageFrames;
        diagnostics.imageBytes -= counters.imageBytes;
        diagnostics.audioUtterances -= counters.audioUtterances;
        diagnostics.audioBytes -= counters.audioBytes;
        diagnostics.events.splice(0, eventCount);
      };
      telemetryQueue = telemetryQueue.then(flush, flush);
      return telemetryQueue;
    };

    const recordVisual = (observation: EnvironmentObservation) => {
      const visual = observation.visual ?? observation.visuals?.[0];
      if (!visual) return;
      const metadataBytes = visual.metadata?.bytes;
      const bytes = typeof metadataBytes === 'number' && Number.isFinite(metadataBytes)
        ? Math.max(0, Math.floor(metadataBytes))
        : typeof visual.dataUrl === 'string'
          ? Math.max(0, Math.floor((visual.dataUrl.split(',')[1]?.length ?? 0) * 0.75))
          : 0;
      diagnostics.imageFrames += 1;
      diagnostics.imageBytes += bytes;
      diagnosticEvent({
        timestamp: visual.timestamp || observation.timestamp,
        kind: 'image.frame',
        bytes,
        message: visual.id,
      });
    };

    const recordFreestyleMovement = (observation: EnvironmentObservation) => {
      const policy = observation.state?.freestyleMovement;
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return;
      const value = policy as Record<string, unknown>;
      diagnostics.freestyleMovement = {
        supported: value.supported === true,
        enabled: value.enabled === true,
        available: value.available === true,
      };
    };

    diagnosticTimer = setInterval(() => {
      void flushTelemetry().catch(error => {
        console.error(`${LOG_PREFIX} diagnostic telemetry failed: ${(error as Error).message}`);
      });
    }, DIAGNOSTIC_TELEMETRY_INTERVAL_MS);
    diagnosticTimer.unref?.();

    sendMessage({
      type: 'bridge.connect',
      version: PROTOCOL_VERSION,
      token: config.adapterToken,
    });

    const sendAudioResult = (
      metadata: Pick<AudioUtteranceMetadata, 'utteranceId'>,
      status: 'completed' | 'ignored' | 'failed',
      message: string,
    ) => {
      sendMessage({
        type: 'audio.utterance.result',
        version: PROTOCOL_VERSION,
        utteranceId: metadata.utteranceId,
        status,
        message: message.slice(0, 256),
        timestamp: new Date().toISOString(),
      });
    };

    const enqueueAudioUtterance = (raw: Buffer) => {
      let utterance: ParsedAudioUtterance;
      try {
        utterance = parseAudioUtteranceMessage(raw);
      } catch (error) {
        console.error(`${LOG_PREFIX} rejected audio utterance: ${(error as Error).message}`);
        return;
      }
      diagnosticSessionId = utterance.metadata.sessionId;
      diagnostics.robotId = utterance.metadata.robotId;
      diagnostics.audioUtterances += 1;
      diagnostics.audioBytes += raw.length;
      diagnosticEvent({
        timestamp: utterance.metadata.endedAt,
        kind: 'audio.utterance',
        bytes: raw.length,
        status: utterance.metadata.truncated ? 'truncated' : 'complete',
        message: utterance.metadata.utteranceId,
      });
      const mediaUpload = postDiagnosticAudio(config, utterance).catch(error => {
        diagnosticEvent({
          timestamp: new Date().toISOString(),
          kind: 'audio.monitor.failed',
          status: 'failed',
          message: (error as Error).message,
        });
      });
      mediaUploads.add(mediaUpload);
      void mediaUpload.finally(() => mediaUploads.delete(mediaUpload));
      if (!latestObservation) {
        sendAudioResult(utterance.metadata, 'failed', 'Environment observation is not ready');
        return;
      }
      if (pendingAudioUtterances >= MAX_PENDING_AUDIO_UTTERANCES) {
        sendAudioResult(utterance.metadata, 'failed', 'Transcription queue is full');
        return;
      }

      const sourceObservation = latestObservation;
      pendingAudioUtterances += 1;
      const processUtterance = async () => {
        try {
          if (localAbort.signal.aborted) return;
          diagnostics.transcriptionStatus = 'transcribing';
          const observation = await transcribeAudioUtterance(
            utterance,
            sourceObservation,
            transcribeAudio,
          );
          if (!observation) {
            diagnostics.transcriptionStatus = 'ignored';
            sendAudioResult(utterance.metadata, 'ignored', 'No speech was transcribed');
            return;
          }
          if (localAbort.signal.aborted) return;
          await postJson(
            config,
            '/api/environment-bridge/observation',
            observation as unknown as Record<string, unknown>,
          );
          latestObservation = observation;
          diagnostics.transcriptionStatus = 'completed';
          diagnostics.transcript = observation.text?.[0]?.text;
          diagnosticEvent({
            timestamp: observation.timestamp,
            kind: 'audio.transcription',
            status: 'completed',
            message: diagnostics.transcript,
          });
          sendAudioResult(utterance.metadata, 'completed', 'Utterance transcribed');
          console.log(
            `${LOG_PREFIX} transcribed utterance=${utterance.metadata.utteranceId}`
            + ` durationMs=${utterance.metadata.durationMs}`,
          );
        } catch (error) {
          const message = (error as Error).message;
          diagnostics.transcriptionStatus = 'failed';
          diagnosticEvent({
            timestamp: new Date().toISOString(),
            kind: 'audio.transcription',
            status: 'failed',
            message,
          });
          console.error(
            `${LOG_PREFIX} transcription failed utterance=${utterance.metadata.utteranceId}: ${message}`,
          );
          sendAudioResult(utterance.metadata, 'failed', message);
        } finally {
          pendingAudioUtterances -= 1;
        }
      };
      audioQueue = audioQueue.then(processUtterance, processUtterance);
    };

    await new Promise<void>((resolve, reject) => {
      websocket.on('message', (raw, isBinary) => {
        const incoming = rawDataBuffer(raw);
        diagnostics.inboundBytes += incoming.length;
        diagnostics.inboundMessages += 1;
        if (isBinary) {
          enqueueAudioUtterance(incoming);
          return;
        }
        void (async () => {
          const encoded = incoming.toString();
          if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
            throw new Error('Environment adapter message exceeds its size limit');
          }
          const message = JSON.parse(encoded) as Record<string, unknown>;
          if (message.type === 'bridge.ready') {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            if (!sessionId) throw new Error('Environment adapter omitted sessionId');
            diagnosticSessionId = sessionId;
            const observation = message.observation;
            const connectedObservation = environmentObservation(observation);
            if (connectedObservation) {
              latestObservation = connectedObservation;
              recordVisual(connectedObservation);
              recordFreestyleMovement(connectedObservation);
              await postJson(
                config,
                '/api/environment-bridge/observation',
                connectedObservation as unknown as Record<string, unknown>,
              );
            }
            if (!actionStream) {
              actionStream = consumeActionStream(config, sessionId, sendMessage, localAbort.signal)
                .catch((error) => {
                  if (!localAbort.signal.aborted) reject(error);
                });
            }
            console.log(`${LOG_PREFIX} ready session=${sessionId} adapter=${config.adapterUrl}`);
            return;
          }
          if (message.type === 'environment.observation') {
            const observation = message.observation;
            const receivedObservation = environmentObservation(observation);
            if (receivedObservation) {
              diagnosticSessionId = receivedObservation.sessionId;
              recordVisual(receivedObservation);
              recordFreestyleMovement(receivedObservation);
              const enriched = { ...receivedObservation };
              if (pendingFeedback) {
                enriched.feedback = [
                  ...(Array.isArray(enriched.feedback) ? enriched.feedback : []),
                  pendingFeedback,
                ];
                pendingFeedback = undefined;
              }
              latestObservation = enriched;
              await postJson(
                config,
                '/api/environment-bridge/observation',
                enriched as unknown as Record<string, unknown>,
              );
            }
            return;
          }
          if (message.type === 'environment.telemetry') {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            const telemetry = message.telemetry;
            if (sessionId && telemetry && typeof telemetry === 'object') {
              diagnosticSessionId = sessionId;
              const value = telemetry as Record<string, unknown>;
              if (typeof value.robot_id === 'string') diagnostics.robotId = value.robot_id;
              if (value.kind === 'audio.level' && typeof value.level === 'number') {
                diagnostics.microphoneLevel = Math.max(0, Math.min(1, value.level));
              } else if (value.kind === 'robot.status') {
                diagnostics.robotStatus = { ...value };
              } else if (value.kind === 'movement.plan') {
                const status = typeof value.status === 'string' ? value.status : 'unknown';
                diagnostics.movementPlan = {
                  actionId: typeof value.actionId === 'string'
                    ? value.actionId
                    : diagnostics.movementPlan?.actionId,
                  sequence: typeof value.sequence === 'number'
                    ? value.sequence
                    : diagnostics.movementPlan?.sequence,
                  status,
                  frameCount: typeof value.frameCount === 'number'
                    ? value.frameCount
                    : diagnostics.movementPlan?.frameCount,
                  durationMs: typeof value.durationMs === 'number'
                    ? value.durationMs
                    : diagnostics.movementPlan?.durationMs,
                  activeFrame: typeof value.activeFrame === 'number'
                    ? value.activeFrame
                    : diagnostics.movementPlan?.activeFrame,
                  message: typeof value.message === 'string' ? value.message : undefined,
                  updatedAt: typeof value.timestamp === 'string'
                    ? value.timestamp
                    : new Date().toISOString(),
                };
                diagnosticEvent({
                  timestamp: diagnostics.movementPlan.updatedAt,
                  kind: 'movement.plan',
                  status,
                  message: `${diagnostics.movementPlan.actionId || 'unidentified'} frame=${diagnostics.movementPlan.activeFrame || 0}/${diagnostics.movementPlan.frameCount || 0}${diagnostics.movementPlan.message ? ` ${diagnostics.movementPlan.message}` : ''}`,
                });
              } else if (value.kind === 'movement.stop') {
                diagnosticEvent({
                  timestamp: typeof value.timestamp === 'string' ? value.timestamp : new Date().toISOString(),
                  kind: 'movement.stop',
                  status: typeof value.status === 'string' ? value.status : 'requested',
                  message: typeof value.actionId === 'string' ? value.actionId : undefined,
                });
              }
            }
            return;
          }
          if (message.type === 'environment.feedback') {
            const feedback = message.feedback;
            if (feedback && typeof feedback === 'object') {
              pendingFeedback = feedback as unknown as EnvironmentFeedback;
              diagnosticEvent({
                timestamp: pendingFeedback.timestamp,
                kind: 'action.feedback',
                status: pendingFeedback.type,
                message: pendingFeedback.message,
              });
              await postJson(config, '/api/environment-bridge/action-result', feedback as Record<string, unknown>);
            }
          }
        })().catch(reject);
      });
      websocket.once('close', () => resolve());
      websocket.once('error', reject);
      localAbort.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    localAbort.abort();
    if (diagnosticTimer) clearInterval(diagnosticTimer);
    await audioQueue;
    await Promise.allSettled(mediaUploads);
    await flushTelemetry(true).catch(error => {
      console.error(`${LOG_PREFIX} final diagnostic telemetry failed: ${(error as Error).message}`);
    });
    await actionStream;
  } finally {
    if (diagnosticTimer) clearInterval(diagnosticTimer);
    signal.removeEventListener('abort', abort);
    localAbort.abort();
    websocket.removeAllListeners();
    if (websocket.readyState === WebSocket.OPEN) websocket.close();
  }
}

export async function runEnvironmentBridgeAgent(signal: AbortSignal): Promise<void> {
  let lock;
  try {
    lock = acquireLock('agent-environment-bridge');
  } catch {
    console.log(`${LOG_PREFIX} another instance is already running`);
    return;
  }

  try {
    const config = readConfig();
    console.log(`${LOG_PREFIX} starting mode=event-driven adapter=${config.adapterUrl} graph=${config.graph}`);
    while (!signal.aborted) {
      try {
        await connectOnce(config, signal);
      } catch (error) {
        if (!signal.aborted) {
          console.error(`${LOG_PREFIX} connection failed: ${(error as Error).message}`);
        }
      }
      if (!signal.aborted) await waitForAbort(signal, RECONNECT_DELAY_MS);
    }
  } finally {
    lock.release();
  }
}

export async function run(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runEnvironmentBridgeAgent(controller.signal);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
