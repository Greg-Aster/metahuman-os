import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { badRequestResponse, streamResponse } from '../types.js';
import { getBufferNotificationPath } from '../../conversation-buffer.js';
import { getProfilePaths } from '../../path-builder.js';

type BufferMode = 'conversation' | 'inner' | 'system';

function isBufferMode(value: string | undefined): value is BufferMode {
  return value === 'conversation' || value === 'inner' || value === 'system';
}

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const handleBufferStream: UnifiedHandler = async (req) => {
  const mode = req.query?.mode;
  if (!isBufferMode(mode)) {
    return badRequestResponse('mode query param required (conversation|inner|system)');
  }

  if (!req.user.isAuthenticated) {
    return streamResponse((async function* () {
      yield sse({ type: 'error', error: 'Not authenticated. Please refresh the page and log in.' });
    })());
  }

  const { bufferPath, notifyPath } = resolveBufferPaths(req.user.username, req.user.role, req.sessionId, mode);
  const response = streamResponse(streamBufferUpdates(req.signal, mode, bufferPath, notifyPath));
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Accel-Buffering': 'no',
    },
  };
};

function resolveBufferPaths(username: string, role: string, sessionId: string | undefined, mode: BufferMode) {
  if (role === 'guest') {
    const safeSessionId = sessionId?.substring(0, 16) || 'default';
    const guestTempDir = path.join(os.tmpdir(), 'metahuman-guest', safeSessionId);
    if (!fs.existsSync(guestTempDir)) fs.mkdirSync(guestTempDir, { recursive: true });

    return {
      bufferPath: path.join(guestTempDir, `conversation-buffer-${mode}.json`),
      notifyPath: path.join(guestTempDir, `.buffer-notify-${mode}`),
    };
  }

  const profilePaths = getProfilePaths(username);
  return {
    bufferPath: path.join(profilePaths.state, `conversation-buffer-${mode}.json`),
    notifyPath: getBufferNotificationPath(username, mode),
  };
}

async function* streamBufferUpdates(
  signal: AbortSignal | undefined,
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
      if (!fs.existsSync(bufferPath)) {
        push(sse({ type: 'update', messages: [], mode }));
        return;
      }

      const buffer = JSON.parse(fs.readFileSync(bufferPath, 'utf-8'));
      const messages = (buffer.messages || [])
        .filter((msg: any) => mode === 'system' ? !msg.meta?.summaryMarker : msg.role !== 'system' && !msg.meta?.summaryMarker)
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
