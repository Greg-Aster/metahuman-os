/**
 * Conversation Buffer Stream API
 *
 * Uses Server-Sent Events (SSE) with fs.watch on LOCAL notification files.
 * The actual buffer lives on encrypted storage (LUKS/NFS/FUSE), but we watch
 * a small notification file on local disk where fs.watch() works reliably.
 *
 * Flow:
 * 1. Buffer is written to encrypted storage
 * 2. touchBufferNotification() writes to local disk
 * 3. This API watches the local notification file
 * 4. When notification changes, re-read buffer from encrypted storage
 *
 * Query params:
 *   - mode: 'conversation' | 'inner' (required)
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, getProfilePaths, getBufferNotificationPath } from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  // Get mode from query params
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(JSON.stringify({ error: 'mode query param required (conversation|inner)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get user for profile path resolution
  let username: string | null = null;
  try {
    const user = getAuthenticatedUser(cookies);
    username = user.username;
  } catch {
    // Return SSE error event instead of JSON so EventSource can handle it
    // This prevents silent failures when auth cookie is missing/invalid
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: 'Not authenticated. Please refresh the page and log in.' })}\n\n`);
        controller.close();
      },
    });
    return new Response(errorStream, {
      status: 200, // Must be 200 for EventSource to receive the message
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  const profilePaths = getProfilePaths(username);
  const bufferFilename = `conversation-buffer-${mode}.json`;
  const bufferPath = path.join(profilePaths.state, bufferFilename);

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

      const sendBufferUpdate = () => {
        if (isClosed) return;
        try {
          if (!fs.existsSync(bufferPath)) {
            sendEvent('update', { messages: [], mode });
            return;
          }

          const raw = fs.readFileSync(bufferPath, 'utf-8');
          const buffer = JSON.parse(raw);
          const messages = (buffer.messages || [])
            .filter((msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker)
            .map((msg: any) => ({
              role: msg.role,
              content: msg.content,
              timestamp: msg.timestamp || Date.now(),
              meta: msg.meta,
            }));

          sendEvent('update', { messages, mode, lastUpdated: buffer.lastUpdated });
        } catch (error) {
          console.error(`[buffer-stream] Error reading ${mode} buffer:`, error);
        }
      };

      // Send initial state
      sendEvent('connected', { mode, bufferPath });
      sendBufferUpdate();

      // Watch LOCAL notification file (works on all filesystems including LUKS/NFS)
      // The notification file is touched whenever the buffer is written
      const notifyPath = getBufferNotificationPath(username!, mode as 'conversation' | 'inner');
      const notifyDir = path.dirname(notifyPath);
      const notifyFilename = path.basename(notifyPath);

      try {
        // Ensure notification directory exists
        if (!fs.existsSync(notifyDir)) {
          fs.mkdirSync(notifyDir, { recursive: true });
        }

        watcher = fs.watch(notifyDir, (eventType, filename) => {
          if (filename === notifyFilename) {
            // Debounce: wait 300ms after notification before reading buffer
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              console.log(`[buffer-stream] ${mode} notification received, reading buffer`);
              sendBufferUpdate();
            }, 300);
          }
        });

        watcher.on('error', (error) => {
          console.error(`[buffer-stream] Watcher error for ${mode}:`, error);
        });
      } catch (error) {
        console.error(`[buffer-stream] Failed to setup watcher for ${mode}:`, error);
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
