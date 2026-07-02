import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler, UnifiedRequest } from '../types.js';
import { streamResponse } from '../types.js';
import {
  getTTSNotificationPath,
  popTTSQueue,
} from '../../nodes/output/tts.node.js';

function data(type: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

async function* ttsQueueEvents(req: UnifiedRequest): AsyncIterable<string> {
  const username = req.user.username;
  const notifyPath = getTTSNotificationPath(username);
  const notifyDir = path.dirname(notifyPath);
  const notifyFilename = path.basename(notifyPath);
  const queue: string[] = [];
  const connectionStartedAt = Date.now();
  const staleThresholdMs = 10000;
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  let closed = false;

  const push = (chunk: string): void => {
    queue.push(chunk);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const close = (): void => {
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (wake) {
      wake();
      wake = null;
    }
  };

  const checkQueue = (): void => {
    if (closed) return;

    try {
      const items = popTTSQueue(username);
      if (items.length === 0) {
        return;
      }

      const freshItems = items.filter((item) => {
        if (!item?.timestamp) return true;
        return item.timestamp >= (connectionStartedAt - staleThresholdMs);
      });
      const dropped = items.length - freshItems.length;
      if (dropped > 0) {
        console.log(`[tts-queue-stream] Dropped ${dropped} stale TTS items for ${username}`);
      }
      if (freshItems.length > 0) {
        push(data('tts', { items: freshItems }));
        console.log(`[tts-queue-stream] Sending ${freshItems.length} TTS items to ${username}`);
      }
    } catch (error) {
      console.error('[tts-queue-stream] Error checking queue:', error);
    }
  };

  req.signal?.addEventListener('abort', close, { once: true });

  try {
    push(data('connected', { username }));
    checkQueue();

    if (!fs.existsSync(notifyDir)) {
      fs.mkdirSync(notifyDir, { recursive: true });
    }

    watcher = fs.watch(notifyDir, (_eventType, filename) => {
      if (filename === notifyFilename) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkQueue, 100);
      }
    });

    watcher.on('error', (error) => {
      console.error('[tts-queue-stream] Watcher error:', error);
    });

    while (!closed) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (closed) break;

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } catch (error) {
    console.error('[tts-queue-stream] Failed to setup watcher:', error);
  } finally {
    req.signal?.removeEventListener('abort', close);
    close();
  }
}

export const handleTtsQueueStream: UnifiedHandler = async (req) => {
  if (!req.user.isAuthenticated) {
    return streamResponse((async function* unauthenticated() {
      yield data('error', { error: 'Not authenticated' });
    })());
  }

  return streamResponse(ttsQueueEvents(req));
};
