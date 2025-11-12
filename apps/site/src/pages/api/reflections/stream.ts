/**
 * API endpoint for streaming reflections in real-time
 * Uses Server-Sent Events (SSE) for live updates
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, ROOT } from '@metahuman/core';

export const GET: APIRoute = ({ request }) => {
  const stream = new ReadableStream({
    async start(controller) {
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(paths.logs, 'audit', `${today}.ndjson`);
      const boredomConfigPath = path.join(ROOT, 'etc', 'boredom.json');

      let lastPosition = 0;
      let fileExists = fs.existsSync(auditFile);

      const sendEvent = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      const isShowInChatEnabled = () => {
        try {
          const configData = fs.readFileSync(boredomConfigPath, 'utf-8');
          const config = JSON.parse(configData);
          return config.showInChat !== undefined ? config.showInChat : true;
        } catch {
          return true; // Default to enabled
        }
      };

      const readNewLines = () => {
        if (!fileExists) {
          fileExists = fs.existsSync(auditFile);
          if (!fileExists) return;
        }

        // Check if chat display is enabled
        if (!isShowInChatEnabled()) return;

        try {
          const stats = fs.statSync(auditFile);
          if (stats.size <= lastPosition) {
            return;
          }

          const stream = fs.createReadStream(auditFile, {
            start: lastPosition,
            encoding: 'utf8',
          });

          let buffer = '';
          stream.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const entry = JSON.parse(line);

                  // Send reflection events
                  if (
                    entry.actor === 'reflector' &&
                    entry.category === 'decision' &&
                    entry.message === 'Reflector generated new insight' &&
                    entry.metadata?.reflection
                  ) {
                    sendEvent({
                      type: 'reflection',
                      reflection: entry.metadata.reflection,
                      timestamp: entry.timestamp,
                    });
                  }

                  // Send dream events
                  if (
                    entry.actor === 'dreamer' &&
                    entry.category === 'decision' &&
                    entry.message === 'Dreamer generated new dream' &&
                    entry.metadata?.dream
                  ) {
                    sendEvent({
                      type: 'dream',
                      dream: entry.metadata.dream,
                      timestamp: entry.timestamp,
                    });
                  }

                  // Send curiosity question events
                  if (
                    entry.actor === 'curiosity-service' &&
                    entry.event === 'chat_assistant' &&
                    entry.details?.curiosityQuestionId &&
                    entry.details?.content
                  ) {
                    sendEvent({
                      type: 'curiosity',
                      question: entry.details.content,
                      questionId: entry.details.curiosityQuestionId,
                      timestamp: entry.timestamp,
                    });
                  }
                } catch (e) {
                  /* ignore malformed json */
                }
              }
            }
          });

          stream.on('end', () => {
            lastPosition = stats.size;
          });
        } catch (e) {
          fileExists = false;
          lastPosition = 0;
        }
      };

      sendEvent({ type: 'connected' });
      readNewLines();

      const interval = setInterval(readNewLines, 1000);

      // Heartbeat to keep connections alive through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`: ping\n\n`);
        } catch {}
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
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
