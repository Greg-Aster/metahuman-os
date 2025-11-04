/**
 * API endpoint for streaming audit logs in real-time
 * Uses Server-Sent Events (SSE) for live updates
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';

export const GET: APIRoute = async () => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Get today's audit log file
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(paths.logs, 'audit', `${today}.ndjson`);

      // Track last position
      let lastPosition = 0;

      // Function to read new lines
      const readNewLines = () => {
        if (!fs.existsSync(auditFile)) {
          return;
        }

        const stats = fs.statSync(auditFile);
        if (stats.size <= lastPosition) {
          return; // No new data
        }

        // Read from last position
        const stream = fs.createReadStream(auditFile, {
          start: lastPosition,
          encoding: 'utf8',
        });

        let buffer = '';

        stream.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                const message = `data: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoder.encode(message));
              } catch (e) {
                // Skip malformed lines
              }
            }
          }
        });

        stream.on('end', () => {
          lastPosition = stats.size;
        });
      };

      // Send initial connection message
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Read existing logs
      readNewLines();

      // Poll for new logs every 500ms
      const interval = setInterval(readNewLines, 500);

      // Heartbeat to keep connections alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {}
      }, 15000);

      // Cleanup on close
      return () => {
        clearInterval(interval);
        clearInterval(heartbeat);
      };
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
