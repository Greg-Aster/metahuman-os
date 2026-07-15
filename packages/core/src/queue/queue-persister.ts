/**
 * Atomic persistence for the single coordinator ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';
import type { PersistedQueueState, QueueState } from './types.js';

const STATE_DIR = path.join(systemPaths.logs, 'run', 'queue');
const WORK_FILE = path.join(STATE_DIR, 'work-items.json');
const STATE_VERSION = 2;
const SAVE_DEBOUNCE_MS = 250;

function ensureStateDir(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

export function getQueueStateDir(): string {
  ensureStateDir();
  return STATE_DIR;
}

export function createPersistedState(state: QueueState): PersistedQueueState {
  return {
    ...state,
    savedAt: new Date().toISOString(),
    version: STATE_VERSION,
  };
}

export function saveQueueState(state: PersistedQueueState): void {
  ensureStateDir();
  const tempFile = `${WORK_FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify({ ...state, version: STATE_VERSION }, null, 2));
    fs.renameSync(tempFile, WORK_FILE);
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      // Preserve the original persistence error.
    }
    throw new Error(`Failed to persist coordinator state: ${(error as Error).message}`);
  }
}

export function persistQueueState(state: QueueState): void {
  saveQueueState(createPersistedState(state));
}

function parseState(file: string): PersistedQueueState | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedQueueState;
}

export function loadQueueState(): PersistedQueueState | null {
  try {
    const current = parseState(WORK_FILE);
    if (current) {
      if (current.version !== STATE_VERSION) {
        console.warn(`[queue-persister] Unsupported coordinator state version ${current.version}`);
        return null;
      }
      return current;
    }
    return null;
  } catch (error) {
    console.error('[queue-persister] Failed to load coordinator state:', error);
    return null;
  }
}

export function clearQueueState(): void {
  for (const file of [
    WORK_FILE,
    `${WORK_FILE}.tmp`,
  ]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.error(`[queue-persister] Failed to remove ${path.basename(file)}:`, error);
    }
  }
}

export function createDebouncedSaver(
  getState: () => QueueState,
  onError?: (error: Error) => void,
  debounceMs = SAVE_DEBOUNCE_MS,
): () => void {
  let timeoutId: NodeJS.Timeout | null = null;
  let pending = false;
  return () => {
    pending = true;
    if (timeoutId) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!pending) return;
      pending = false;
      try {
        persistQueueState(getState());
      } catch (error) {
        onError?.(error as Error);
      }
    }, debounceMs);
    timeoutId.unref?.();
  };
}

export function createImmediateSaver(getState: () => QueueState): () => void {
  return () => persistQueueState(getState());
}

export function shouldRestoreState(): boolean {
  return fs.existsSync(WORK_FILE);
}

export function auditRecovery(tasksRestored: number, inFlightRestored: number, crashedTaskId?: string): void {
  audit({
    level: 'info',
    category: 'system',
    event: 'queue_state_recovered',
    actor: 'queue_persister',
    details: { tasksRestored, inFlightRestored, crashedTaskId },
  });
}
