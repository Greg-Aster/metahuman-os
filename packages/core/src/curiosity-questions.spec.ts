import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CuriosityQuestionNotFoundError,
  CuriosityQuestionResolutionConflictError,
  CuriosityQuestionStore,
} from './curiosity-questions.js';
import { parseCuriosityConfig } from './config.js';

function temporaryStore(): { root: string; store: CuriosityQuestionStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-curiosity-questions-'));
  return {
    root,
    store: new CuriosityQuestionStore(username => path.join(root, username, 'state')),
  };
}

test('creates an atomic profile-isolated pending record and counts it', async () => {
  const { root, store } = temporaryStore();
  const record = await store.create('alice', {
    id: 'cur-q-one',
    question: 'What should we explore next?',
    askedAt: '2026-08-25T12:00:00.000Z',
    seedMemories: ['evt-one', 'evt-one'],
  });

  assert.equal(record.status, 'pending');
  assert.deepEqual(record.seedMemories, ['evt-one']);
  assert.equal(await store.countPending('alice'), 1);
  assert.equal(await store.countPending('bob'), 0);
  assert.equal((await store.get('alice', 'cur-q-one'))?.question, 'What should we explore next?');
  assert.equal(await store.get('bob', 'cur-q-one'), null);
  await assert.rejects(
    () => store.create('../alice', { question: 'Can this escape the profile root?' }),
    /path-safe profile identifier/,
  );
  const pending = path.join(root, 'alice', 'state', 'curiosity', 'questions', 'pending');
  assert.deepEqual(fs.readdirSync(pending), ['cur-q-one.json']);
  assert.equal(fs.readdirSync(pending).some(name => name.endsWith('.tmp')), false);
});

test('stable creation reuses the first durable question across retries', async () => {
  const { store } = temporaryStore();
  const first = await store.createOrGet('alice', {
    id: 'cur-q-task-one',
    question: 'What should we explore first?',
    askedAt: '2026-08-25T12:00:00.000Z',
    seedMemories: ['evt-one'],
  });
  const retry = await store.createOrGet('alice', {
    id: 'cur-q-task-one',
    question: 'A retry must not replace the first question.',
    askedAt: '2026-08-25T12:01:00.000Z',
    seedMemories: ['evt-two'],
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.record, first.record);
  assert.equal(await store.countPending('alice'), 1);
});

test('concurrent stable creation publishes exactly one durable question', async () => {
  const { store } = temporaryStore();
  const results = await Promise.all([
    store.createOrGet('alice', {
      id: 'cur-q-task-concurrent',
      question: 'Which question wins the race?',
      seedMemories: ['evt-one'],
    }),
    store.createOrGet('alice', {
      id: 'cur-q-task-concurrent',
      question: 'This competing question must not overwrite the winner.',
      seedMemories: ['evt-two'],
    }),
  ]);

  assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
  assert.deepEqual(results[0].record, results[1].record);
  assert.equal(await store.countPending('alice'), 1);
});

test('answer resolution is durable, removes the pending record, and is idempotent', async () => {
  const { root, store } = temporaryStore();
  await store.create('alice', {
    id: 'cur-q-answer',
    question: 'What changed?',
    askedAt: '2026-08-25T12:00:00.000Z',
  });

  const first = await store.resolve('alice', 'cur-q-answer', 'answered', '2026-08-25T12:05:00.000Z');
  assert.equal(first.changed, true);
  assert.equal(first.record.status, 'answered');
  assert.equal(first.record.answeredAt, '2026-08-25T12:05:00.000Z');
  assert.equal(await store.countPending('alice'), 0);
  assert.equal(fs.existsSync(path.join(root, 'alice', 'state', 'curiosity', 'questions', 'pending', 'cur-q-answer.json')), false);

  const second = await store.resolve('alice', 'cur-q-answer', 'answered', '2026-08-25T12:10:00.000Z');
  assert.equal(second.changed, false);
  assert.equal(second.record.answeredAt, first.record.answeredAt);
});

test('skip resolution is distinct and missing questions fail explicitly', async () => {
  const { store } = temporaryStore();
  await store.create('alice', {
    id: 'cur-q-skip',
    question: 'Should this be skipped?',
    askedAt: '2026-08-25T12:00:00.000Z',
  });
  const skipped = await store.resolve('alice', 'cur-q-skip', 'skipped', '2026-08-25T12:01:00.000Z');
  assert.equal(skipped.record.status, 'skipped');
  assert.equal(skipped.record.skippedAt, '2026-08-25T12:01:00.000Z');
  await assert.rejects(
    () => store.resolve('bob', 'cur-q-skip', 'skipped'),
    CuriosityQuestionNotFoundError,
  );
});

test('competing answer and skip resolutions publish exactly one durable result', async () => {
  const { store } = temporaryStore();
  await store.create('alice', {
    id: 'cur-q-race',
    question: 'Which resolution wins?',
    askedAt: '2026-08-25T12:00:00.000Z',
  });

  const results = await Promise.allSettled([
    store.resolve('alice', 'cur-q-race', 'answered', '2026-08-25T12:01:00.000Z'),
    store.resolve('alice', 'cur-q-race', 'skipped', '2026-08-25T12:02:00.000Z'),
  ]);
  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.changed, true);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof CuriosityQuestionResolutionConflictError);
  assert.equal((await store.get('alice', 'cur-q-race'))?.status, fulfilled[0].value.record.status);
  assert.equal(await store.countPending('alice'), 0);
});

test('strictly validates new curiosity config while normalizing the legacy profile shape', () => {
  const legacy = parseCuriosityConfig({
    maxOpenQuestions: 3,
    researchMode: 'local',
    minTrustLevel: 'observe',
    questionIntervalSeconds: 900,
  }, { allowLegacy: true });
  assert.deepEqual(legacy, {
    maxOpenQuestions: 3,
    researchMode: 'local',
    innerQuestionMode: 'local',
    minTrustLevel: 'observe',
  });
  assert.throws(
    () => parseCuriosityConfig({ ...legacy, questionIntervalSeconds: 900 }),
    /Unknown curiosity configuration field/,
  );
  assert.throws(
    () => parseCuriosityConfig({ ...legacy, maxOpenQuestons: 4 }, { allowLegacy: true }),
    /Unknown curiosity configuration field: maxOpenQuestons/,
  );
  assert.throws(
    () => parseCuriosityConfig({ ...legacy, maxOpenQuestions: 6 }),
    /between 0 and 5/,
  );
});
