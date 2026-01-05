/**
 * API endpoint for streaming window session updates in real-time
 * Uses Server-Sent Events (SSE) for live updates
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  systemPaths,
  getAuthenticatedUser,
  AuthRequiredError,
  listUserWindows,
} from '@metahuman/core';

export const GET: APIRoute = ({ cookies, request }) => {
  // Check authentication
  let username: string;
  try {
    const user = getAuthenticatedUser(cookies);
    username = user.username;
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const windowsFile = path.join(systemPaths.run, 'windows.json');
      let isClosed = false;
      let watcher: fs.FSWatcher | null = null;

      const sendEvent = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          isClosed = true;
        }
      };

      const sendWindowUpdate = (type: string = 'update') => {
        if (isClosed) return;
        try {
          const windows = listUserWindows(username);
          sendEvent({
            type,
            windows: windows.map(w => ({
              windowId: w.windowId,
              isActive: w.isActive,
              lastActivity: w.lastActivity,
              title: w.title,
            })),
            windowCount: windows.length,
            multiWindow: windows.length > 1,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error('[window-session/stream] Error getting windows:', error);
        }
      };

      // Set up file watcher for windows.json
      try {
        const dir = path.dirname(windowsFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        watcher = fs.watch(dir, (eventType, filename) => {
          if (filename === 'windows.json' && !isClosed) {
            sendWindowUpdate('file-change');
          }
        });
      } catch {
        // File watching not available, that's okay
      }

      // Send initial state
      sendEvent({ type: 'connected' });
      sendWindowUpdate('initial');

      // Send heartbeat every 30 seconds
      const heartbeatInterval = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(`: heartbeat\n\n`);
        } catch {
          isClosed = true;
        }
      }, 30000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(heartbeatInterval);
        if (watcher) {
          watcher.close();
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
