import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';
import Database from 'better-sqlite3';
import type { PersistedQueueState } from './types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-ledger-'));
process.env.METAHUMAN_ROOT = root;
const { saveQueueState, loadQueueState, clearQueueState, getQueueStateDir } = await import('./queue-persister.js');
const { UnifiedQueueManager } = await import('./unified-queue-manager.js');
const { eventBus } = await import('../infrastructure/event-bus/client.js');
after(() => { clearQueueState(); eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
const state = (): PersistedQueueState => ({ version: 2, savedAt: 'saved', lastUpdated: 'updated',
  items: [{ id: 'one', state: 'queued', input: { text: 'first' } } as any],
  history: [{ id: 'two', state: 'completed', result: { value: 'retained' } } as any],
  durableReceipts: [{ id: 'three', state: 'completed', durable: { executionId: 'parent', effectId: 'effect' } } as any],
  bodyOwners: { robot: { bodyId: 'robot', executionId: 'parent', generation: 7 } }, inFlightRemote: [] });

test('imports the old ledger once, preserving receipts, ordering and body ownership', () => {
  clearQueueState();
  const original = state();
  const legacy = path.join(getQueueStateDir(), 'work-items.json');
  fs.writeFileSync(legacy, JSON.stringify(original));
  assert.deepEqual(loadQueueState(), original);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(`${legacy}.migrated`), true);
  original.items![0]!.state = 'completed';
  saveQueueState(original);
  assert.deepEqual(loadQueueState(), original);
});

test('updates only changed tasks and atomically rolls back a failed commit', () => {
  clearQueueState();
  const original = state();
  saveQueueState(original);
  const db = new Database(path.join(getQueueStateDir(), 'work-items.sqlite'));
  try {
    db.exec(`CREATE TABLE changed (id TEXT); CREATE TRIGGER count_updates AFTER UPDATE ON work_items
      BEGIN INSERT INTO changed VALUES (new.id); END;`);
    const next = structuredClone(original);
    next.items![0]!.state = 'leased';
    saveQueueState(next);
    assert.deepEqual(db.prepare('SELECT id FROM changed').all(), [{ id: 'one' }]);
    assert.deepEqual(loadQueueState(), next);
    db.exec(`CREATE TRIGGER fail_commit BEFORE UPDATE ON work_state
      BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END;`);
    const rejected = structuredClone(next);
    rejected.items![0]!.state = 'completed';
    assert.throws(() => saveQueueState(rejected), /fixture disk failure/);
    assert.deepEqual(loadQueueState(), next, 'A failed state commit cannot publish its task updates');
  } finally { db.close(); }
});

test('incremental commits do not serialize retained payloads and still retire removed records', () => {
  clearQueueState();
  const original = state();
  saveQueueState(original);
  const next = structuredClone(original);
  next.items![0]!.state = 'leased';
  Object.defineProperty(next.history![0]!, 'result', {
    enumerable: true, get() { throw new Error('An unchanged historical payload was visited'); },
  });
  saveQueueState(next, new Set(['one']));
  assert.equal(loadQueueState()!.items![0]!.state, 'leased');
  assert.deepEqual(loadQueueState()!.history![0]!.result, original.history![0]!.result);
  next.history = [];
  saveQueueState(next, new Set());
  assert.deepEqual(loadQueueState()!.history, []);
  const db = new Database(path.join(getQueueStateDir(), 'work-items.sqlite'), { readonly: true });
  try { assert.equal(db.prepare('SELECT id FROM work_items WHERE id=?').get('two'), undefined); }
  finally { db.close(); }
});

test('the coordinator persists changed lifecycle records and restores a rejected mutation', () => {
  clearQueueState();
  const manager = new UnifiedQueueManager();
  manager.setOnQueueChange(ids => saveQueueState({ ...manager.exportState(), version: 2, savedAt: 'fixture' }, ids));
  const task = manager.enqueue({ type: 'generic', handler: 'fixture', username: 'fixture', input: { text: 'evidence' } });
  const db = new Database(path.join(getQueueStateDir(), 'work-items.sqlite'));
  try {
    db.exec(`CREATE TRIGGER reject_lifecycle BEFORE UPDATE ON work_state
      BEGIN SELECT RAISE(ABORT, 'fixture rejected commit'); END;`);
    assert.throws(() => manager.claim(task.id), /fixture rejected commit/);
    assert.equal(manager.getTask(task.id)!.state, 'queued');
    assert.equal(loadQueueState()!.items![0]!.state, 'queued');
    db.exec('DROP TRIGGER reject_lifecycle');
    manager.claim(task.id);
    manager.appendOutput(task.id, 'progress');
    manager.attachExecution(task.id, 'execution');
    manager.wait(task.id, 'awaiting correlated evidence', new Date(0).toISOString());
    assert.equal(loadQueueState()!.items![0]!.state, 'waiting');
    manager.releaseWaiting();
    assert.equal(loadQueueState()!.items![0]!.state, 'queued');
    manager.claim(task.id);
    manager.complete(task.id, true, { observed: true });
    const saved = loadQueueState()!;
    assert.deepEqual(saved.items, []);
    assert.deepEqual(saved.history![0]!.output, ['progress']);
    assert.deepEqual(saved.history![0]!.graphExecutions, ['execution']);
    assert.deepEqual(saved.history![0]!.result, { observed: true });
  } finally { db.close(); }
});

test('a failed initial migration leaves the original ledger available for retry', () => {
  clearQueueState();
  const original = state();
  const legacy = path.join(getQueueStateDir(), 'work-items.json');
  fs.writeFileSync(legacy, JSON.stringify(original));
  const db = new Database(path.join(getQueueStateDir(), 'work-items.sqlite'));
  try {
    db.exec(`CREATE TABLE work_state (id INTEGER PRIMARY KEY, document TEXT NOT NULL);
      CREATE TRIGGER fail_import BEFORE INSERT ON work_state
      BEGIN SELECT RAISE(ABORT, 'fixture migration failure'); END;`);
    assert.throws(() => loadQueueState(), /fixture migration failure/);
    assert.deepEqual(JSON.parse(fs.readFileSync(legacy, 'utf8')), original);
    db.exec('DROP TRIGGER fail_import');
    assert.deepEqual(loadQueueState(), original);
    assert.equal(fs.existsSync(legacy), false);
  } finally { db.close(); }
});

test('readers retain a consistent snapshot while another connection commits', () => {
  clearQueueState();
  const original = state();
  saveQueueState(original);
  const writer = new Database(path.join(getQueueStateDir(), 'work-items.sqlite'));
  const prepare = Database.prototype.prepare;
  let committed = false;
  const intercept = mock.method(Database.prototype, 'prepare', function (this: Database.Database, sql: string) {
    const statement = prepare.call(this, sql);
    if (this !== writer && sql === 'SELECT document FROM work_state WHERE id=1') {
      const get = statement.get;
      statement.get = () => {
        const row = Reflect.apply(get, statement, []);
        if (!committed) {
          committed = true;
          writer.transaction(() => {
            writer.prepare('UPDATE work_items SET document=? WHERE id=?')
              .run(JSON.stringify({ ...original.items![0], state: 'leased' }), 'one');
            const metadata = JSON.parse((row as { document: string }).document);
            metadata.savedAt = 'newer';
            writer.prepare('UPDATE work_state SET document=? WHERE id=1').run(JSON.stringify(metadata));
          }).immediate();
        }
        return row;
      };
    }
    return statement;
  });
  try {
    assert.deepEqual(loadQueueState(), original, 'The old index and new task payload must never be mixed');
    assert.equal(committed, true);
    assert.equal(loadQueueState()!.items![0]!.state, 'leased');
  } finally { intercept.mock.restore(); writer.close(); }
});
