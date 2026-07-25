import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { badRequestResponse, streamResponse } from '../types.js';
import {
  getBufferNotificationPath,
  getBufferPathForUser,
  loadBufferForUser,
} from '../../conversation-buffer.js';

type BufferMode = 'conversation' | 'inner' | 'system' | 'robot';

function isBufferMode(value: string | undefined): value is BufferMode {
  return value === 'conversation' || value === 'inner' || value === 'system' || value === 'robot';
}

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleBufferStream: UnifiedHandler = async (req) => {
  const mode = req.query?.mode;
  if (!isBufferMode(mode)) {
    return badRequestResponse('mode query param required (conversation|inner|system|robot)');
  }

  if (!req.user.isAuthenticated) {
    return streamResponse((async function* () {
      yield sse({ type: 'error', error: 'Not authenticated. Please refresh the page and log in.' });
    })());
  }

  const bufferPath = getBufferPathForUser(req.user.username, mode);
  const notifyPath = getBufferNotificationPath(req.user.username, mode);
  const response = streamResponse(streamBufferUpdates(req.signal, req.user.username, mode, bufferPath, notifyPath));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
};

async function* streamBufferUpdates(
  signal: AbortSignal | undefined,
  username: string,
  mode: BufferMode,
  bufferPath: string,
  notifyPath: string,
): AsyncGenerator<string> {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let watcher: fs.FSWatcher | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;

  const push = (chunk: string) => {
    if (closed) return;
    queue.push(chunk);
    wake?.();
    wake = undefined;
  };

  const close = () => {
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close();
    wake?.();
    wake = undefined;
  };

  const sendBufferUpdate = () => {
    if (closed) return;
    try {
      const buffer = loadBufferForUser(username, mode);
      const messages = (buffer.messages || [])
        .filter((msg: any) => !msg.meta?.summaryMarker)
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
          meta: msg.meta,
        }));

      push(sse({ type: 'update', messages, mode, lastUpdated: buffer.lastUpdated }));
    } catch (error) {
      console.error(`[buffer-stream] Error reading ${mode} buffer:`, error);
    }
  };

  try {
    push(sse({ type: 'connected', mode, bufferPath }));
    sendBufferUpdate();

    const notifyDir = path.dirname(notifyPath);
    if (!fs.existsSync(notifyDir)) fs.mkdirSync(notifyDir, { recursive: true });
    if (!fs.existsSync(notifyPath)) fs.writeFileSync(notifyPath, new Date().toISOString());

    watcher = fs.watch(notifyPath, (eventType) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[buffer-stream] ${mode} notification received (${eventType}), reading buffer`);
        sendBufferUpdate();
      }, 100);
    });

    watcher.on('error', (error) => {
      console.error(`[buffer-stream] Watcher error for ${mode}:`, error);
    });
  } catch (error) {
    console.error(`[buffer-stream] Failed to setup watcher for ${mode}:`, error);
  }

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
    signal?.removeEventListener('abort', close);
    close();
  }
}
