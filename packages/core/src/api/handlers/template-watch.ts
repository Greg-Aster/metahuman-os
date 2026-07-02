import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { streamResponse } from '../types.js';
import { ROOT } from '../../path-builder.js';

const TEMPLATES_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* watchTemplates(signal?: AbortSignal): AsyncIterable<string> {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const queue: string[] = [];
  let watcher: fs.FSWatcher | null = null;
  let keepalive: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  let closed = false;

  const push = (chunk: string): void => {
    queue.push(chunk);
    if (wake) {
      wake();
      wake = null;
    }
  };

  const close = (): void => {
    closed = true;
    if (keepalive) {
      clearInterval(keepalive);
      keepalive = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (wake) {
      wake();
      wake = null;
    }
  };

  signal?.addEventListener('abort', close, { once: true });

  try {
    console.log(`[TemplateWatch] Client ${clientId} connected`);
    push(sse('connected', {
      message: 'Template watcher connected',
      clientId,
      timestamp: Date.now(),
    }));

    if (!fs.existsSync(TEMPLATES_DIR)) {
      console.warn(`[TemplateWatch] Templates directory not found: ${TEMPLATES_DIR}`);
      push(sse('info', {
        message: 'Template watching disabled - directory not found',
        path: TEMPLATES_DIR,
      }));
    } else {
      watcher = fs.watch(TEMPLATES_DIR, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) {
          return;
        }

        const templateName = path.basename(filename, '.json');
        console.log(`[TemplateWatch] Template changed: ${templateName} (${eventType})`);
        push(sse('template-changed', {
          templateName,
          eventType,
          timestamp: Date.now(),
        }));
      });
    }

    keepalive = setInterval(() => {
      push(': keepalive\n\n');
    }, 30000);
    push(': keepalive\n\n');

    while (!closed) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }

      if (closed) {
        break;
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } catch (error) {
    console.error('[TemplateWatch] Error setting up watcher:', error);
    yield sse('error', {
      message: 'Failed to initialize template watcher',
      error: (error as Error).message,
    });
  } finally {
    signal?.removeEventListener('abort', close);
    close();
    console.log(`[TemplateWatch] Client ${clientId} disconnected`);
  }
}

export const handleTemplateWatch: UnifiedHandler = async (req) => {
  return streamResponse(watchTemplates(req.signal));
};
