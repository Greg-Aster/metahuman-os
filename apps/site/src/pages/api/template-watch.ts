/**
 * Server-Sent Events endpoint for template hot-reload
 * Watches cognitive graph template files and notifies clients when they change
 *
 * NOTE: This is a dev-time feature. In production, templates rarely change.
 */

import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';
import { ROOT } from '@metahuman/core';

// Template directory path - cognitive graphs are stored in etc/cognitive-graphs/
// Use ROOT from @metahuman/core to get the correct repo root in both dev and production
const TEMPLATES_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');

// Track active watchers
const watchers = new Map<string, fs.FSWatcher>();

/**
 * GET /api/template-watch
 * Establishes an SSE connection and streams template change events
 */
export const GET: APIRoute = async () => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  console.log(`[TemplateWatch] Client ${clientId} connected`);

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      sendEvent('connected', {
        message: 'Template watcher connected',
        clientId,
        timestamp: Date.now(),
      });

      // Check if templates directory exists before watching
      if (!fs.existsSync(TEMPLATES_DIR)) {
        console.warn(`[TemplateWatch] Templates directory not found: ${TEMPLATES_DIR}`);
        sendEvent('info', {
          message: 'Template watching disabled - directory not found',
          path: TEMPLATES_DIR,
        });
        return; // Don't attempt to watch non-existent directory
      }

      // Watch templates directory for changes
      try {
        const watcher = fs.watch(TEMPLATES_DIR, { recursive: true }, (eventType, filename) => {
          if (!filename || !filename.endsWith('.json')) {
            return;
          }

          const templateName = path.basename(filename, '.json');

          console.log(`[TemplateWatch] Template changed: ${templateName} (${eventType})`);

          sendEvent('template-changed', {
            templateName,
            eventType,
            timestamp: Date.now(),
          });
        });

        watchers.set(clientId, watcher);

        // Handle client disconnect
        const cleanup = () => {
          console.log(`[TemplateWatch] Client ${clientId} disconnected`);
          const watcher = watchers.get(clientId);
          if (watcher) {
            watcher.close();
            watchers.delete(clientId);
          }
        };

        // Cleanup on stream close/error
        controller.enqueue(encoder.encode(`: keepalive\n\n`));

        // Send keepalive every 30 seconds
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          } catch (e) {
            clearInterval(keepalive);
            cleanup();
          }
        }, 30000);

      } catch (error) {
        console.error('[TemplateWatch] Error setting up watcher:', error);
        sendEvent('error', {
          message: 'Failed to initialize template watcher',
          error: (error as Error).message,
        });
      }
    },

    cancel() {
      // Cleanup when stream is cancelled
      console.log(`[TemplateWatch] Stream cancelled for ${clientId}`);
      const watcher = watchers.get(clientId);
      if (watcher) {
        watcher.close();
        watchers.delete(clientId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering in nginx
    },
  });
};
