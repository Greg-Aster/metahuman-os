import fs from 'node:fs';
import path from 'node:path';
import { appendEventToIndex } from './vector-index.js';
import { canWriteMemory, type EventType } from './memory-policy.js';
import type { CognitiveModeId } from './cognitive-mode.js';
import { systemPaths } from './paths.js';

interface QueueEvent {
  id: string;
  timestamp: string;
  content: string;
  tags?: string[];
  entities?: string[];
  path?: string;
  type?: string;
}

interface QueueItem {
  event: QueueEvent;
  retryCount?: number;
  lastError?: string;
}

interface QueueState {
  pending: QueueItem[];
  processing: boolean;
  stateFile?: string;
}

const QUEUE_FILENAME = 'index-queue.json';
const queues = new Map<string, QueueState>();
let hydrated = false;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistQueue(userId: string, queue: QueueState): void {
  if (!queue.stateFile) return;

  try {
    const dir = path.dirname(queue.stateFile);
    fs.mkdirSync(dir, { recursive: true });

    if (queue.pending.length === 0) {
      if (fs.existsSync(queue.stateFile)) {
        fs.unlinkSync(queue.stateFile);
      }
      return;
    }

    fs.writeFileSync(
      queue.stateFile,
      JSON.stringify({ userId, pending: queue.pending }, null, 2)
    );
  } catch (error) {
    console.warn('[vector-index-queue] Failed to persist queue:', error);
  }
}

async function processQueue(userId: string): Promise<void> {
  const queue = queues.get(userId);
  if (!queue || queue.processing) {
    return;
  }

  queue.processing = true;
  const MAX_RETRIES = 2;  // Reduced from 5 - we have smart error detection now

  while (queue.pending.length > 0) {
    const item = queue.pending[0];
    const retryCount = item.retryCount || 0;

    try {
      await appendEventToIndex({
        id: item.event.id,
        timestamp: item.event.timestamp,
        content: item.event.content,
        tags: item.event.tags,
        entities: item.event.entities,
        path: item.event.path,
      });

      // Success - remove item and persist
      queue.pending.shift();
      persistQueue(userId, queue);

      // Small delay to avoid hammering disk
      await delay(50);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      const errorCode = error?.code;

      // Check for unrecoverable errors - skip immediately without retry
      if (errorCode === 'TRUNCATION_EXHAUSTED') {
        console.warn(
          `[vector-index-queue] ⚠️  Skipping event ${item.event.id} - content too large even after aggressive truncation. ` +
          `Content length: ${item.event.content?.length || 0} chars.`
        );
        // Remove immediately - retrying won't help
        queue.pending.shift();
        persistQueue(userId, queue);
        continue;
      }

      // Check if this is a persistent failure (max retries reached)
      if (retryCount >= MAX_RETRIES) {
        console.error(
          `[vector-index-queue] ❌ Skipping event ${item.event.id} after ${retryCount} failed attempts. ` +
          `Content length: ${item.event.content?.length || 0} chars. Last error: ${errorMsg}`
        );
        // Remove the failing item to prevent infinite loop
        queue.pending.shift();
        persistQueue(userId, queue);
        continue;
      }

      // Increment retry count
      item.retryCount = retryCount + 1;
      item.lastError = errorMsg;

      console.warn(
        `[vector-index-queue] Failed to append event to index (attempt ${item.retryCount}/${MAX_RETRIES}): ${errorMsg}`
      );

      // Short backoff: 500ms, 1s (reduced from exponential 500ms→8s)
      const backoffDelay = 500 * (retryCount + 1);
      await delay(backoffDelay);
    }
  }

  queue.processing = false;
  persistQueue(userId, queue);
}

function hydrateQueuesFromDisk(): void {
  if (hydrated) return;
  hydrated = true;

  try {
    const profilesDir = systemPaths.profiles;
    if (!fs.existsSync(profilesDir)) return;

    const usernames = fs.readdirSync(profilesDir).filter(name => {
      const fullPath = path.join(profilesDir, name);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const username of usernames) {
      const stateDir = path.join(profilesDir, username, 'state');
      const queuePath = path.join(stateDir, QUEUE_FILENAME);
      if (!fs.existsSync(queuePath)) continue;

      try {
        const raw = fs.readFileSync(queuePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data?.userId || !Array.isArray(data.pending)) continue;

        const queue: QueueState = {
          pending: data.pending,
          processing: false,
          stateFile: queuePath,
        };

        queues.set(data.userId, queue);
        if (queue.pending.length > 0) {
          process.nextTick(() => {
            void processQueue(data.userId);
          });
        }
      } catch (error) {
        console.warn('[vector-index-queue] Failed to load queue file:', queuePath, error);
      }
    }
  } catch (error) {
    console.warn('[vector-index-queue] Failed to hydrate queues from disk:', error);
  }
}

hydrateQueuesFromDisk();

function flushQueues(): void {
  for (const [userId, queue] of queues.entries()) {
    persistQueue(userId, queue);
  }
}

process.once('SIGTERM', flushQueues);
process.once('SIGINT', flushQueues);

interface ScheduleOptions {
  statePath?: string;
}

export function scheduleIndexUpdate(
  userId: string,
  mode: CognitiveModeId,
  event: QueueEvent,
  options: ScheduleOptions = {}
): void {
  if (!userId) return;

  const eventType = (event.type || 'observation') as EventType;
  if (!canWriteMemory(mode, eventType)) return;

  hydrateQueuesFromDisk();

  const existing = queues.get(userId) ?? { pending: [], processing: false };
  if (options.statePath) {
    existing.stateFile = path.join(options.statePath, QUEUE_FILENAME);
  } else if (!existing.stateFile) {
    const fallbackDir = path.join(systemPaths.profiles, userId, 'state');
    existing.stateFile = path.join(fallbackDir, QUEUE_FILENAME);
  }

  existing.pending.push({ event });
  queues.set(userId, existing);
  persistQueue(userId, existing);

  if (!existing.processing) {
    void processQueue(userId);
  }
}
