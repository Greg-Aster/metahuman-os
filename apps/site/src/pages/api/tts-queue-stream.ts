/**
 * TTS Queue Stream API
 *
 * Server-Sent Events (SSE) endpoint that watches for TTS queue updates.
 * When text is queued for TTS (via the TTS node in cognitive graphs),
 * this stream notifies the client so it can play the audio.
 *
 * The client's TTS toggles (ttsEnabled, boredomTtsEnabled) control
 * whether the queued items are actually spoken.
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAuthenticatedUser,
  AuthRequiredError,
  popTTSQueue,
  getTTSNotificationPath,
} from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  // Authenticate user
  let user;
  try {
    user = getAuthenticatedUser(cookies);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: 'Not authenticated' })}\n\n`);
          controller.close();
        },
      });
      return new Response(errorStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }
    throw error;
  }

  const username = user.username;
  const notifyPath = getTTSNotificationPath(username);
  const notifyDir = path.dirname(notifyPath);
  const notifyFilename = path.basename(notifyPath);

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let watcher: fs.FSWatcher | null = null;
      let debounceTimer: NodeJS.Timeout | null = null;

      const sendEvent = (type: string, data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        } catch {
          isClosed = true;
        }
      };

      const checkQueue = () => {
        if (isClosed) return;
        try {
          // Pop items from queue (returns and removes them)
          const items = popTTSQueue(username);
          if (items.length > 0) {
            sendEvent('tts', { items });
            console.log(`[tts-queue-stream] Sending ${items.length} TTS items to ${username}`);
          }
        } catch (error) {
          console.error('[tts-queue-stream] Error checking queue:', error);
        }
      };

      // Send connected event
      sendEvent('connected', { username });

      // Check queue immediately on connect (in case items were queued before stream connected)
      checkQueue();

      // Watch for notification file changes
      try {
        if (!fs.existsSync(notifyDir)) {
          fs.mkdirSync(notifyDir, { recursive: true });
        }

        watcher = fs.watch(notifyDir, (eventType, filename) => {
          if (filename === notifyFilename) {
            // Debounce: wait 100ms after notification before checking queue
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              checkQueue();
            }, 100);
          }
        });

        watcher.on('error', (error) => {
          console.error('[tts-queue-stream] Watcher error:', error);
        });
      } catch (error) {
        console.error('[tts-queue-stream] Failed to setup watcher:', error);
      }

      // Cleanup on connection close
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (watcher) {
          watcher.close();
          watcher = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
