import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  parseTrainingConsoleLog,
  readTrainingHistory,
  readTrainingHistoryForUser,
} from './training-history.js';

const MODIFIED_AT = new Date('2026-01-01T00:10:00.000Z');

test('terminal lifecycle markers are authoritative', () => {
  const run = parseTrainingConsoleLog(
    'full-cycle-2026-01-01T00-00-00-000Z.log',
    [
      '[lora-trainer] TRAINING FAILED - Exit code 1',
      '[training-lifecycle] {"status":"completed","endedAt":"2026-01-01T00:05:00.000Z","pid":42,"username":"alice","exitCode":0}',
    ].join('\n'),
    MODIFIED_AT,
  );

  assert.equal(run.status, 'completed');
  assert.equal(run.pid, 42);
  assert.equal(run.username, 'alice');
  assert.equal(run.method, 'remote-lora');
  assert.equal(run.endTime, '2026-01-01T00:05:00.000Z');
});

test('failed lifecycle markers expose the process exit', () => {
  const run = parseTrainingConsoleLog(
    'fine-tune-cycle-2026-01-01T00-00-00-000Z.log',
    '[training-lifecycle] {"status":"failed","endedAt":"2026-01-01T00:01:00.000Z","exitCode":7}',
    MODIFIED_AT,
  );

  assert.equal(run.status, 'failed');
  assert.equal(run.method, 'fine-tune');
  assert.equal(run.error, 'Training process exited with code 7');
});

test('legacy launcher logs recognize complete full-cycle runs', () => {
  const run = parseTrainingConsoleLog(
    'full-cycle-2025-12-31T17-05-37-986Z.log',
    '✅ [full-cycle] Training complete for user: greggles',
    MODIFIED_AT,
  );

  assert.equal(run.status, 'completed');
  assert.equal(run.username, 'greggles');
});

test('legacy post-training failures remain failed', () => {
  const run = parseTrainingConsoleLog(
    'full-cycle-2025-12-19T22-44-48-492Z.log',
    [
      '[lora-trainer] Training exit code: 0',
      '[lora-trainer] An error occurred: adapter copy failed',
      '[full-cycle] Remote training failed, stopping early but summary written',
    ].join('\n'),
    MODIFIED_AT,
  );

  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'adapter copy failed');
});

test('legacy logs without a terminal outcome are visibly incomplete', () => {
  const run = parseTrainingConsoleLog(
    'full-cycle-local-2026-01-01T00-00-00-000Z.log',
    'Waiting for pod ssh gateway... (Attempt 74/120)',
    MODIFIED_AT,
  );

  assert.equal(run.status, 'incomplete');
  assert.equal(run.method, 'local-lora');
  assert.match(run.error || '', /without an explicit terminal outcome/);
});

test('malformed lifecycle markers fail history parsing', () => {
  assert.throws(
    () => parseTrainingConsoleLog(
      'full-cycle-2026-01-01T00-00-00-000Z.log',
      '[training-lifecycle] not-json',
      MODIFIED_AT,
    ),
    /Malformed training lifecycle marker/,
  );
});

test('history reads only canonical launcher logs and sorts newest first', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-history-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'full-cycle-2026-01-01T00-00-00-000Z.log'),
      '✅ [full-cycle] Training complete for user: alice',
    );
    fs.writeFileSync(
      path.join(directory, 'fine-tune-cycle-2026-01-02T00-00-00-000Z.log'),
      '[fine-tune-cycle] ===== PIPELINE FAILED =====\n[fine-tune-cycle] Error: bad dataset',
    );
    fs.writeFileSync(path.join(directory, 'unrelated.log'), 'not training history');

    const runs = readTrainingHistory(directory);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].method, 'fine-tune');
    assert.equal(runs[0].status, 'failed');
    assert.equal(runs[1].status, 'completed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('profile history excludes runs belonging to another profile', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-history-user-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'full-cycle-2026-01-01T00-00-00-000Z.log'),
      '[training-lifecycle] {"status":"completed","endedAt":"2026-01-01T00:05:00.000Z","username":"alice"}',
    );
    fs.writeFileSync(
      path.join(directory, 'full-cycle-local-2026-01-02T00-00-00-000Z.log'),
      '[training-lifecycle] {"status":"completed","endedAt":"2026-01-02T00:05:00.000Z","username":"bob"}',
    );

    const runs = readTrainingHistoryForUser('alice', directory);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].username, 'alice');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
