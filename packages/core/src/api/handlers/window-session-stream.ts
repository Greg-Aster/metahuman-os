/**
 * Window Session SSE Stream
 *
 * Pushes real-time window session updates to connected clients.
 * No polling - server pushes changes as they happen.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { listUserWindows } from '../../window-session.js';
import fs from 'fs';
import path from 'path';
import { systemPaths } from '../../path-builder.js';

// Track active SSE connections per user
const activeConnections = new Map<string, Set<(data: string) => void>>();

function listCurrentUserWindows(user: UnifiedRequest['user']) {
  const windows = new Map<string, ReturnType<typeof listUserWindows>[number]>();
  for (const window of listUserWindows(user.userId)) {
    windows.set(window.windowId, window);
  }
  for (const window of listUserWindows(user.username)) {
    windows.set(window.windowId, window);
  }
  return [...windows.values()];
}

function windowUpdateEvent(user: UnifiedRequest['user'], type: string): string {
  const windows = listCurrentUserWindows(user);
  return `data: ${JSON.stringify({
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
  })}\n\n`;
}

/**
 * Broadcast window update to all connected clients for a user
 */
export function broadcastWindowUpdate(username: string): void {
  const connections = activeConnections.get(username);
  if (!connections || connections.size === 0) return;

  const windows = listUserWindows(username);
  const data = JSON.stringify({
    type: 'window-update',
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

  for (const send of connections) {
    try {
      send(`data: ${data}\n\n`);
    } catch {
      // Connection may be closed, will be cleaned up
    }
  }
}

/**
 * GET /api/window-session/stream - SSE stream for window updates
 */
export async function handleWindowSessionStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const username = user.username;

  // Create SSE stream
  async function* generateStream(): AsyncIterable<string> {
    let isConnected = true;
    const sendQueue: string[] = [];

    const sendFn = (data: string) => {
      if (isConnected) {
        sendQueue.push(data);
      }
    };

    // Register this connection
    if (!activeConnections.has(username)) {
      activeConnections.set(username, new Set());
    }
    activeConnections.get(username)!.add(sendFn);

    // Send initial state using the same event sequence as the Astro route.
    yield `data: ${JSON.stringify({ type: 'connected' })}\n\n`;
    yield windowUpdateEvent(user, 'initial');

    // Also watch the windows.json file for changes from other processes
    const windowsFile = path.join(systemPaths.run, 'windows.json');
    let watcher: fs.FSWatcher | null = null;

    try {
      // Ensure directory exists
      const dir = path.dirname(windowsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Watch for file changes (from other windows registering/closing)
      watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === 'windows.json' && isConnected) {
          sendQueue.push(windowUpdateEvent(user, 'file-change'));
        }
      });
    } catch {
      // File watching not available, that's okay
    }

    try {
      let lastHeartbeat = Date.now();

      // Keep connection alive and yield queued messages
      while (isConnected) {
        // Yield any queued messages
        while (sendQueue.length > 0) {
          const msg = sendQueue.shift()!;
          yield msg;
        }

        // Send heartbeat every 30s to keep connection alive
        if (Date.now() - lastHeartbeat >= 30000) {
          yield `: heartbeat\n\n`;
          lastHeartbeat = Date.now();
        }

        if (req.signal?.aborted) {
          isConnected = false;
          break;
        }

        // Wait before next check (non-blocking)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      // Cleanup
      isConnected = false;
      activeConnections.get(username)?.delete(sendFn);
      if (activeConnections.get(username)?.size === 0) {
        activeConnections.delete(username);
      }
      if (watcher) {
        watcher.close();
      }
    }
  }

  return {
    status: 200,
    stream: generateStream(),
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  };
}
