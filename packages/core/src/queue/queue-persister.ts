/**
 * Atomic persistence for the single coordinator ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';
import type { PersistedQueueState, QueueState } from './types.js';
import { WorkCommitUncertainError } from './types.js';

const STATE_DIR = path.join(systemPaths.logs, 'run', 'queue');
const WORK_FILE = path.join(STATE_DIR, 'work-items.sqlite');
const LEGACY_FILE = path.join(STATE_DIR, 'work-items.json');
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

let ledger: Database.Database | undefined;

function database(): Database.Database {
  if (ledger) return ledger;
  ensureStateDir();
  const db = new Database(WORK_FILE);
  fs.chmodSync(WORK_FILE, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(`CREATE TABLE IF NOT EXISTS work_items (id TEXT PRIMARY KEY, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);`);
  ledger = db;
  return db;
}

/** One atomic ledger commit; unchanged task payloads do not get written again. */
export function saveQueueState(state: PersistedQueueState, changedTaskIds?: ReadonlySet<string>): void {
  const db = database();
  const { items = [], history = [], durableReceipts = [], ...metadata } = state;
  const tasks = new Map([...items, ...history, ...durableReceipts].map(task => [task.id, task]));
  const changed = [...tasks].filter(([id]) => !changedTaskIds || changedTaskIds.has(id))
    .map(([id, task]) => [id, JSON.stringify(task)] as const);
  const document = JSON.stringify({ ...metadata, version: STATE_VERSION,
    items: items.map(task => task.id), history: history.map(task => task.id),
    durableReceipts: durableReceipts.map(task => task.id) });
  try {
    db.transaction(() => {
      const previous = db.prepare('SELECT id FROM work_items').all() as Array<{ id: string }>;
      const put = db.prepare('INSERT INTO work_items VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document WHERE work_items.document <> excluded.document');
      const remove = db.prepare('DELETE FROM work_items WHERE id=?');
      for (const [id, value] of changed) put.run(id, value);
      for (const { id } of previous) if (!tasks.has(id)) remove.run(id);
      db.prepare('INSERT INTO work_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(document);
    }).immediate();
  } catch (error) {
    // A storage I/O error may leave commit durability uncertain. Retain the
    // existing owner's exact-candidate retry contract in that case.
    const code = (error as { code?: string }).code ?? '';
    if (code.startsWith('SQLITE_IOERR')) throw new WorkCommitUncertainError(`Coordinator commit durability is uncertain: ${(error as Error).message}`);
    throw error;
  }
}

export function persistQueueState(state: QueueState, changedTaskIds?: ReadonlySet<string>): void {
  saveQueueState(createPersistedState(state), changedTaskIds);
}

export function loadQueueState(): PersistedQueueState | null {
  if (!fs.existsSync(WORK_FILE) && !fs.existsSync(LEGACY_FILE)) return null;
  const db = database();
  if (!db.prepare('SELECT 1 FROM work_state WHERE id=1').get() && fs.existsSync(LEGACY_FILE)) {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM work_state WHERE id=1').get()) return;
      const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')) as PersistedQueueState;
      if (legacy.version !== STATE_VERSION) throw new Error(`Unsupported coordinator state version ${legacy.version}`);
      saveQueueState(legacy);
    }).immediate();
  }
  // The committed database is the sole owner. The old snapshot is retained as
  // an inert migration backup, never a second live persistence path.
  if (fs.existsSync(LEGACY_FILE)) db.transaction(() => {
    if (db.prepare('SELECT 1 FROM work_state WHERE id=1').get() && fs.existsSync(LEGACY_FILE)) {
      fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
    }
  }).immediate();
  return db.transaction(() => {
    const row = db.prepare('SELECT document FROM work_state WHERE id=1').get() as { document: string } | undefined;
    if (!row) return null;
    const metadata = JSON.parse(row.document);
    if (metadata.version !== STATE_VERSION) throw new Error(`Unsupported coordinator state version ${metadata.version}`);
    const tasks = new Map((db.prepare('SELECT id, document FROM work_items').all() as Array<{ id: string; document: string }>)
      .map(task => [task.id, JSON.parse(task.document)]));
    const resolve = (ids: string[]) => ids.map(id => {
      if (!tasks.has(id)) throw new Error(`Coordinator ledger is missing work ${id}`);
      return tasks.get(id);
    });
    return { ...metadata, items: resolve(metadata.items), history: resolve(metadata.history),
      durableReceipts: resolve(metadata.durableReceipts) };
  }).deferred();
}

export function clearQueueState(): void {
  ledger?.close();
  ledger = undefined;
  for (const file of [WORK_FILE, `${WORK_FILE}-wal`, `${WORK_FILE}-shm`, LEGACY_FILE, `${LEGACY_FILE}.tmp`]) {
    fs.rmSync(file, { force: true });
  }
}

export function createImmediateSaver(getState: () => QueueState): (changedTaskIds?: ReadonlySet<string>) => void {
  return changedTaskIds => persistQueueState(getState(), changedTaskIds);
}

export function shouldRestoreState(): boolean {
  return fs.existsSync(WORK_FILE) || fs.existsSync(LEGACY_FILE);
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
