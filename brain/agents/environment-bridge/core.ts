import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { acquireLock } from '@metahuman/core';
import { ROOT } from '@metahuman/core/paths';

const LOG_PREFIX = '[environment-bridge]';
const PROTOCOL_VERSION = 1;
const RECONNECT_DELAY_MS = 2_000;
const MAX_MESSAGE_BYTES = 256 * 1024;

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

async function consumeActionStream(
  config: BridgeConfig,
  sessionId: string,
  websocket: WebSocket,
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
        websocket.send(JSON.stringify({
          type: 'environment.action',
          version: PROTOCOL_VERSION,
          action,
        }));
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
    websocket.send(JSON.stringify({
      type: 'bridge.connect',
      version: PROTOCOL_VERSION,
      token: config.adapterToken,
    }));

    let actionStream: Promise<void> | undefined;
    let pendingFeedback: Record<string, unknown> | undefined;
    await new Promise<void>((resolve, reject) => {
      websocket.on('message', (raw) => {
        void (async () => {
          const encoded = raw.toString();
          if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) {
            throw new Error('Environment adapter message exceeds its size limit');
          }
          const message = JSON.parse(encoded) as Record<string, unknown>;
          if (message.type === 'bridge.ready') {
            const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
            if (!sessionId) throw new Error('Environment adapter omitted sessionId');
            const observation = message.observation;
            if (observation && typeof observation === 'object') {
              await postJson(config, '/api/environment-bridge/observation', observation as Record<string, unknown>);
            }
            if (!actionStream) {
              actionStream = consumeActionStream(config, sessionId, websocket, localAbort.signal)
                .catch((error) => {
                  if (!localAbort.signal.aborted) reject(error);
                });
            }
            console.log(`${LOG_PREFIX} ready session=${sessionId} adapter=${config.adapterUrl}`);
            return;
          }
          if (message.type === 'environment.observation') {
            const observation = message.observation;
            if (observation && typeof observation === 'object') {
              const enriched = { ...(observation as Record<string, unknown>) };
              if (pendingFeedback) {
                enriched.feedback = [
                  ...(Array.isArray(enriched.feedback) ? enriched.feedback : []),
                  pendingFeedback,
                ];
                pendingFeedback = undefined;
              }
              await postJson(config, '/api/environment-bridge/observation', enriched);
            }
            return;
          }
          if (message.type === 'environment.feedback') {
            const feedback = message.feedback;
            if (feedback && typeof feedback === 'object') {
              pendingFeedback = feedback as Record<string, unknown>;
              await postJson(config, '/api/environment-bridge/action-result', feedback as Record<string, unknown>);
            }
          }
        })().catch(reject);
      });
      websocket.once('close', () => resolve());
      websocket.once('error', reject);
      localAbort.signal.addEventListener('abort', resolve, { once: true });
    });
    localAbort.abort();
    await actionStream;
  } finally {
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
