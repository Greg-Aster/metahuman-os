import type { APIRoute } from 'astro';
import { paths } from '@metahuman/core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Server-Sent Events endpoint for real-time LLM activity
 * Streams llm_call events from audit logs as they happen
 */
export const GET: APIRoute = async () => {
  const encoder = new TextEncoder();

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      let lastPosition = 0;
      let intervalId: NodeJS.Timeout;
      let isClosed = false;
      const pendingTimeouts = new Set<NodeJS.Timeout>();

      // Get today's audit log file
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(paths.logs, 'audit', `${today}.ndjson`);

      // Track active LLM calls (role -> start time)
      const activeCallsMap = new Map<string, number>();

      // Safe enqueue that checks if controller is still open
      const safeEnqueue = (data: Uint8Array) => {
        if (!isClosed) {
          try {
            controller.enqueue(data);
          } catch (error) {
            // Controller was closed, ignore
            isClosed = true;
          }
        }
      };

      // Function to check for new audit entries
      const checkForUpdates = () => {
        try {
          if (!fs.existsSync(auditFile)) {
            return;
          }

          const stats = fs.statSync(auditFile);
          if (stats.size <= lastPosition) {
            return; // No new data
          }

          // Read only new data
          const fd = fs.openSync(auditFile, 'r');
          const buffer = Buffer.alloc(stats.size - lastPosition);
          fs.readSync(fd, buffer, 0, buffer.length, lastPosition);
          fs.closeSync(fd);

          lastPosition = stats.size;

          // Parse new lines
          const lines = buffer.toString('utf-8').split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);

              // Only care about llm_call events
              if (entry.event !== 'llm_call') {
                continue;
              }

              const role = entry.details?.role;
              if (!role) continue;

              // Check if this is a start or end event
              // We'll consider it a start if we haven't seen it recently
              const now = Date.now();
              const lastSeen = activeCallsMap.get(role) || 0;

              // If last seen was more than 100ms ago, this is a new call
              if (now - lastSeen > 100) {
                // Send "start" event
                activeCallsMap.set(role, now);
                const startData = JSON.stringify({
                  type: 'start',
                  role,
                  modelId: entry.details?.modelId,
                  model: entry.details?.model,
                  timestamp: entry.timestamp,
                });
                safeEnqueue(encoder.encode(`data: ${startData}\n\n`));

                // Schedule "end" event after estimated duration
                // Use latencyMs if available, otherwise default to 2s
                const duration = entry.details?.latencyMs || 2000;
                const timeoutId = setTimeout(() => {
                  const endData = JSON.stringify({
                    type: 'end',
                    role,
                    modelId: entry.details?.modelId,
                    latencyMs: duration,
                    timestamp: new Date().toISOString(),
                  });
                  safeEnqueue(encoder.encode(`data: ${endData}\n\n`));
                  activeCallsMap.delete(role);
                  pendingTimeouts.delete(timeoutId);
                }, duration);
                pendingTimeouts.add(timeoutId);
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        } catch (error) {
          console.error('Error reading audit log:', error);
        }
      };

      // Send initial connection message
      safeEnqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      // Check for updates every 250ms
      intervalId = setInterval(checkForUpdates, 250);

      // Cleanup on close
      return () => {
        isClosed = true;
        if (intervalId) {
          clearInterval(intervalId);
        }
        // Clear all pending timeouts
        for (const timeoutId of pendingTimeouts) {
          clearTimeout(timeoutId);
        }
        pendingTimeouts.clear();
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
