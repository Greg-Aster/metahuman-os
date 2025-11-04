/**
 * API endpoint for streaming audit logs in real-time
 * Uses Server-Sent Events (SSE) for live updates
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';

export const GET: APIRoute = ({ request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(paths.logs, 'audit', `${today}.ndjson`);

      let lastPosition = 0;
      let fileExists = fs.existsSync(auditFile);

      const sendEvent = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      const readNewLines = () => {
        if (!fileExists) {
          fileExists = fs.existsSync(auditFile);
          if (!fileExists) return; // Still doesn't exist
        }

        try {
            const stats = fs.statSync(auditFile);
            if (stats.size <= lastPosition) {
              return; // No new data
            }

            const stream = fs.createReadStream(auditFile, {
              start: lastPosition,
              encoding: 'utf8',
            });

            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // Keep incomplete line

              for (const line of lines) {
                if (line.trim()) {
                  try {
                    sendEvent(JSON.parse(line));
                  } catch (e) { /* ignore malformed json */ }
                }
              }
            });

            stream.on('end', () => {
              lastPosition = stats.size;
            });
        } catch (e) {
            // File might have been deleted or is otherwise inaccessible
            fileExists = false;
            lastPosition = 0;
        }
      };

      sendEvent({ type: 'connected' });
      readNewLines();

      // Poll for new lines
      const pollInterval = setInterval(readNewLines, 1000);

      // Heartbeat to keep connections alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`: ping\n\n`); // SSE comment line as heartbeat
        } catch {}
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
