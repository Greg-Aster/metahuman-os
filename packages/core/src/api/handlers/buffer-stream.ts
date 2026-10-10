import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { badRequestResponse, streamResponse } from '../types.js';
import { getBufferNotificationPath, loadBufferForUser } from '../../conversation-buffer.js';

type BufferMode = 'conversation' | 'inner' | 'system' | 'robot';

function isBufferMode(value: string): value is BufferMode {
  return value === 'conversation' || value === 'inner' || value === 'system' || value === 'robot';
}

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleBufferStream: UnifiedHandler = async (req) => {
  const modes = [...new Set(req.query?.mode?.split(',') ?? [])];
  if (!modes.length || !modes.every(isBufferMode)) {
    return badRequestResponse('mode query param required (conversation|inner|system|robot, comma-separated)');
  }
  if (!req.user.isAuthenticated) {
    return streamResponse((async function* () {
      yield sse({ type: 'error', error: 'Not authenticated. Please refresh the page and log in.' });
    })());
  }
  const response = streamResponse(streamBufferUpdates(req.signal, req.user.username, modes));
  return { ...response, headers: { ...response.headers, 'X-Accel-Buffering': 'no' } };
};

async function* streamBufferUpdates(
  signal: AbortSignal | undefined,
  username: string,
  modes: BufferMode[],
): AsyncGenerator<string> {
  const queue: string[] = [];
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<BufferMode, NodeJS.Timeout>();
  let wake: (() => void) | undefined;
  let closed = false;
  const push = (data: Record<string, unknown>) => {
    if (closed) return;
    queue.push(sse(data));
    wake?.();
    wake = undefined;
  };
  const close = () => {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const watcher of watchers) watcher.close();
    watchers.length = 0;
    wake?.();
    wake = undefined;
  };
  const report = (mode: BufferMode, error: unknown) => {
    console.error(`[buffer-stream] ${mode}:`, error);
    push({ type: 'error', mode, error: (error as Error).message });
  };
  const sendUpdate = (mode: BufferMode) => {
    if (closed) return;
    try {
      const buffer = loadBufferForUser(username, mode);
      const messages = (buffer.messages || [])
        .filter((msg: any) => !msg.meta?.summaryMarker)
        .map((msg: any) => ({ role: msg.role, content: msg.content,
          timestamp: msg.timestamp || Date.now(), meta: msg.meta }));
      push({ type: 'update', mode, messages, lastUpdated: buffer.lastUpdated });
    } catch (error) { report(mode, error); }
  };

  signal?.addEventListener('abort', close, { once: true });
  try {
    if (signal?.aborted) return;
    for (const mode of modes) {
      try {
        const notifyPath = getBufferNotificationPath(username, mode);
        fs.mkdirSync(path.dirname(notifyPath), { recursive: true });
        if (!fs.existsSync(notifyPath)) fs.writeFileSync(notifyPath, new Date().toISOString());
        const watcher = fs.watch(notifyPath, () => {
          clearTimeout(timers.get(mode));
          timers.set(mode, setTimeout(() => { timers.delete(mode); sendUpdate(mode); }, 100));
        });
        watchers.push(watcher);
        watcher.on('error', error => report(mode, error));
        push({ type: 'connected', mode });
        sendUpdate(mode);
      } catch (error) { report(mode, error); }
    }
    while (!closed) {
      while (queue.length && !closed) yield queue.shift()!;
      if (!closed) await new Promise<void>(resolve => { wake = resolve; });
    }
  } finally {
    signal?.removeEventListener('abort', close);
    close();
  }
}
