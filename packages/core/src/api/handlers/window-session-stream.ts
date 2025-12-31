/**
 * Window Session SSE Stream
 *
 * Pushes real-time window session updates to connected clients.
 * No polling - server pushes changes as they happen.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { listUserWindows, hasMultipleWindows } from '../../window-session.js';
import fs from 'fs';
import path from 'path';
import { systemPaths } from '../../path-builder.js';

// Track active SSE connections per user
const activeConnections = new Map<string, Set<(data: string) => void>>();

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
    // Send initial state
    const windows = listUserWindows(username);
    const initialData = JSON.stringify({
      type: 'initial',
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
    yield `data: ${initialData}\n\n`;

    // Set up connection tracking
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
          // File changed, broadcast update
          const windows = listUserWindows(username);
          const data = JSON.stringify({
            type: 'file-change',
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
          sendQueue.push(`data: ${data}\n\n`);
        }
      });
    } catch {
      // File watching not available, that's okay
    }

    try {
      // Keep connection alive and yield queued messages
      while (isConnected) {
        // Send heartbeat every 30s to keep connection alive
        yield `: heartbeat\n\n`;

        // Yield any queued messages
        while (sendQueue.length > 0) {
          const msg = sendQueue.shift()!;
          yield msg;
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
