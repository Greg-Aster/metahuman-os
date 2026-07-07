import {
  audit,
  type EnvironmentConnectionConfig,
  getEnvironmentBridgeStatePath,
  listEnvironmentConnections,
  readEnvironmentBridgeState,
  setEnvironmentBridgeEnabled,
  summarizeEnvironmentBridgeState,
  upsertEnvironmentConnection,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { startMegamealBridgeAdapter } from './adapters/megameal.js';

export interface EnvironmentBridgeAgentOptions {
  enabled?: boolean;
  adapter?: string;
  username?: string;
  url?: string;
  roomName?: string;
  graphName?: string;
  persist?: boolean;
  signal?: AbortSignal;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;
const ADAPTER_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function argValue(args: string[], ...names: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) {
        return stringValue(args[index + 1]);
      }
      if (arg.startsWith(`${name}=`)) {
        return stringValue(arg.slice(name.length + 1));
      }
    }
  }
  return '';
}

function readOptions(args: string[], rawOptions: Record<string, unknown> | undefined = {}): EnvironmentBridgeAgentOptions {
  const adapter = stringValue(rawOptions.adapter) || argValue(args, '--adapter');
  const username = stringValue(rawOptions.username) || argValue(args, '--username', '--user');
  const url = stringValue(rawOptions.url) || argValue(args, '--url');
  const roomName = stringValue(rawOptions.roomName) || argValue(args, '--room', '--room-name');
  const graphName = stringValue(rawOptions.graphName) || argValue(args, '--graph', '--graph-name');
  return {
    enabled: args.includes('--disable') ? false : rawOptions.enabled !== false,
    adapter: adapter || undefined,
    username: username || undefined,
    url: url || undefined,
    roomName: roomName || undefined,
    graphName: graphName || undefined,
  };
}

function normalizeUrl(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return undefined;
  }
}

function environmentIdForUrl(adapter: string, rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${adapter}:${url.origin}/`;
  } catch {
    return `${adapter}:${rawUrl}`;
  }
}

function configureConnection(options: {
  adapter: string;
  url: string;
  roomName?: string;
  graphName?: string;
  username?: string;
  enabled: boolean;
}): EnvironmentConnectionConfig {
  const environmentId = environmentIdForUrl(options.adapter, options.url);
  return upsertEnvironmentConnection({
    id: environmentId,
    adapter: options.adapter,
    url: options.url,
    roomName: options.roomName,
    graphName: options.graphName || 'environment-mode',
    enabled: options.enabled,
    metadata: {
      ...(options.username ? { modelUsername: options.username } : {}),
    },
  });
}

function resolveConnection(options: EnvironmentBridgeAgentOptions): EnvironmentConnectionConfig | undefined {
  const explicitUrl = Boolean(options.url);
  const url = options.url ? normalizeUrl(options.url) : undefined;
  if (explicitUrl && !url) {
    throw new Error(`Invalid environment bridge URL: ${options.url}`);
  }
  if (url) {
    if (!options.adapter) {
      throw new Error('Environment bridge adapter is required when a URL is provided.');
    }
    return configureConnection({
      adapter: options.adapter,
      url,
      roomName: options.roomName,
      graphName: options.graphName,
      username: options.username,
      enabled: options.enabled !== false,
    });
  }
  return undefined;
}

function defaultConnection(options: EnvironmentBridgeAgentOptions): EnvironmentConnectionConfig | undefined {
  const adapter = options.adapter ?? 'megameal';
  if (adapter !== 'megameal') {
    return undefined;
  }

  return configureConnection({
    adapter,
    url: options.url ?? 'http://localhost:4322/',
    roomName: options.roomName,
    graphName: options.graphName,
    username: options.username,
    enabled: options.enabled !== false,
  });
}

function validateUsername(username: string | undefined): void {
  if (!username) {
    return;
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error(`Invalid environment bridge username: ${username}`);
  }
}

function validateAdapter(adapter: string | undefined): void {
  if (!adapter) {
    return;
  }
  if (!ADAPTER_PATTERN.test(adapter)) {
    throw new Error(`Invalid environment bridge adapter: ${adapter}`);
  }
}

export async function runEnvironmentBridgeAgent(options: EnvironmentBridgeAgentOptions = {}): Promise<AgentResult> {
  const start = Date.now();
  const enabled = options.enabled !== false;
  validateUsername(options.username);
  validateAdapter(options.adapter);
  const connection = enabled ? resolveConnection(options) ?? defaultConnection(options) : undefined;
  setEnvironmentBridgeEnabled(enabled);
  const state = readEnvironmentBridgeState();
  const summary = summarizeEnvironmentBridgeState(state);
  const observedConnections = enabled ? listEnvironmentConnections({ enabledOnly: true }).length : 0;

  audit({
    level: 'info',
    category: 'system',
    event: enabled ? 'environment_bridge_agent_started' : 'environment_bridge_agent_stopped',
    details: {
      mode: 'event-driven',
      enabled,
      sessions: summary.sessionCount,
      queuedActions: summary.queuedActionCount,
      observedConnections,
      environmentId: connection?.id,
      adapter: connection?.adapter,
      graphName: connection?.graphName,
    },
    actor: options.username,
  });

  console.log(
    `[environment-bridge] mode=event-driven enabled=${summary.enabled} environmentId=${connection?.id ?? 'none'} adapter=${connection?.adapter ?? 'none'} sessions=${summary.sessionCount} queued=${summary.queuedActionCount} observedConnections=${observedConnections}`,
  );

  if (enabled && connection?.adapter === 'megameal') {
    const runtime = startMegamealBridgeAdapter({
      connection,
      username: options.username,
      signal: options.signal,
    });

    try {
      await runtime.ready;
      if (options.persist !== false) {
        await waitForStop(options.signal, runtime.stop);
      }
    } finally {
      await runtime.stop();
      setEnvironmentBridgeEnabled(false);
      audit({
        level: 'info',
        category: 'system',
        event: 'environment_bridge_agent_stopped',
        details: {
          mode: 'event-driven',
          environmentId: connection.id,
          adapter: connection.adapter,
          durationMs: Date.now() - start,
        },
        actor: options.username,
      });
    }
  }

  const finalSummary = summarizeEnvironmentBridgeState(readEnvironmentBridgeState());
  return {
    success: true,
    data: {
      mode: 'event-driven',
      summary: finalSummary,
      statePath: getEnvironmentBridgeStatePath(),
      connection,
      observedConnections,
    },
    duration: Date.now() - start,
    itemsProcessed: 0,
  };
}

async function waitForStop(signal: AbortSignal | undefined, stop: () => Promise<void>): Promise<void> {
  if (signal?.aborted) {
    await stop();
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      void stop().finally(resolve);
    };

    signal?.addEventListener('abort', finish, { once: true });
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const options = readOptions(input.args ?? [], input.options as Record<string, unknown> | undefined);
  options.username = options.username ?? ctx.username;
  options.signal = ctx.signal;
  const result = await runEnvironmentBridgeAgent(options);
  const summary = summarizeEnvironmentBridgeState(readEnvironmentBridgeState());
  return {
    ...result,
    data: {
      ...(result.data as Record<string, unknown>),
      actor: ctx.username,
      summary,
    },
  };
}
