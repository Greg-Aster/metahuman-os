import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { streamResponse } from '../types.js';
import { getAgentMonitorSnapshot } from '../../agent-monitor.js';
import { subscribeEnvironmentBridgeState } from '../../environment-interface/index.js';
import { subscribeEnvironmentBridgeDiagnostics } from '../../environment-interface/diagnostics.js';
import { systemPaths } from '../../path-builder.js';

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleMonitorStream: UnifiedHandler = async (req) => {
  const response = streamResponse(streamMonitorUpdates(req.signal));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
};

async function* streamMonitorUpdates(signal: AbortSignal | undefined): AsyncGenerator<string> {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let debounceTimer: NodeJS.Timeout | undefined;
  const watchers: fs.FSWatcher[] = [];

  const push = (data: Record<string, unknown>) => {
    if (closed) return;
    queue.push(sse(data));
    wake?.();
    wake = undefined;
  };

  const close = () => {
    closed = true;
    wake?.();
    wake = undefined;
  };

  const sendSnapshot = () => {
    if (closed) return;
    try {
      const snapshot = getAgentMonitorSnapshot();

      push({
        type: 'snapshot',
        ...snapshot,
        agents: snapshot.runningAgents,
      });
    } catch (error) {
      console.error('Error computing agent monitor snapshot:', error);
    }
  };

  const scheduleSnapshot = () => {
    if (closed) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(sendSnapshot, 100);
  };

  const watchPath = (target: string) => {
    try {
      if (!fs.existsSync(target)) return;
      watchers.push(fs.watch(target, scheduleSnapshot));
    } catch (error) {
      console.warn('[monitor/stream] Watch failed:', target, (error as Error).message);
    }
  };

  push({ type: 'connected' });
  sendSnapshot();
  const unsubscribeBridgeState = subscribeEnvironmentBridgeState(scheduleSnapshot);
  const unsubscribeBridgeDiagnostics = subscribeEnvironmentBridgeDiagnostics(scheduleSnapshot);

  watchPath(path.join(systemPaths.logs, 'agents'));
  watchPath(path.join(systemPaths.run, 'locks'));
  watchPath(path.join(systemPaths.logs, 'audit'));
  watchPath(path.join(systemPaths.root, 'etc', 'agents.json'));

  signal?.addEventListener('abort', close, { once: true });

  try {
    while (!closed || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield queue.shift()!;
    }
  } finally {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    unsubscribeBridgeState();
    unsubscribeBridgeDiagnostics();
    for (const watcher of watchers) {
      watcher.close();
    }
    signal?.removeEventListener('abort', close);
    close();
  }
}
