/**
 * Atomic persistence for the single coordinator ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';
import type { PersistedQueueState, QueueState } from './types.js';
import { WorkCommitUncertainError } from './types.js';

const STATE_DIR = path.join(systemPaths.logs, 'run', 'queue');
const WORK_FILE = path.join(STATE_DIR, 'work-items.json');
const STATE_VERSION = 2;

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
  let published = false;
  try {
    fs.writeFileSync(tempFile, JSON.stringify({ ...state, version: STATE_VERSION }, null, 2), { mode: 0o600, flush: true });
    fs.renameSync(tempFile, WORK_FILE);
    published = true;
    const directory = fs.openSync(STATE_DIR, 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch (error) {
    if (published) throw new WorkCommitUncertainError(`Coordinator commit published but durability is uncertain: ${(error as Error).message}`);
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
  const current = parseState(WORK_FILE);
  if (current && current.version !== STATE_VERSION) {
    throw new Error(`Unsupported coordinator state version ${current.version}`);
  }
  return current;
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
