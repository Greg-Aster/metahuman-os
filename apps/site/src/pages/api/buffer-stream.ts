/**
 * Conversation Buffer Stream API
 *
 * Uses Server-Sent Events (SSE) with fs.watch to push buffer updates
 * to the client without polling. When agents or chat write to the buffer,
 * connected clients receive instant updates.
 *
 * Query params:
 *   - mode: 'conversation' | 'inner' (required)
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

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
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
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

      // Watch for file changes - debounce to avoid multiple rapid updates
      try {
        // Ensure state directory exists for watching
        const stateDir = path.dirname(bufferPath);
        if (!fs.existsSync(stateDir)) {
          fs.mkdirSync(stateDir, { recursive: true });
        }

        watcher = fs.watch(stateDir, (eventType, filename) => {
          if (filename === bufferFilename) {
            // Debounce: wait 500ms after last change before sending update
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              console.log(`[buffer-stream] ${mode} buffer changed, sending update`);
              sendBufferUpdate();
            }, 500);
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
