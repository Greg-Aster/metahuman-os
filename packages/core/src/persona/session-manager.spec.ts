import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySessionLifecycleTimestamps,
  getPersonaSessionStoragePaths,
  isCompletedPersonaSession,
  type Session,
} from './session-manager.js';

const session = (status: Session['status']): Session => ({
  sessionId: 'session-test',
  userId: 'user-test',
  username: 'tester',
  status,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  questions: [],
  answers: [],
  categoryCoverage: {
    values: 0,
    goals: 0,
    style: 0,
    biography: 0,
    current_focus: 0,
  },
});

test('uses one session file and artifact layout', () => {
  assert.deepEqual(getPersonaSessionStoragePaths('/profiles/tester/persona/therapy', 'session-test'), {
    session: '/profiles/tester/persona/therapy/session-test.json',
    artifacts: '/profiles/tester/persona/therapy/session-test',
  });
});

test('records timestamps for canonical terminal lifecycle states', () => {
  const completed = session('completed');
  applySessionLifecycleTimestamps(completed, '2026-08-24T01:00:00.000Z');
  assert.equal(completed.completedAt, '2026-08-24T01:00:00.000Z');

  const finalized = { ...completed, status: 'finalized' as const };
  applySessionLifecycleTimestamps(finalized, '2026-08-24T02:00:00.000Z');
  assert.equal(finalized.completedAt, '2026-08-24T01:00:00.000Z');
  assert.equal(finalized.finalizedAt, '2026-08-24T02:00:00.000Z');

  const applied = { ...finalized, status: 'applied' as const };
  applySessionLifecycleTimestamps(applied, '2026-08-24T03:00:00.000Z');
  assert.equal(applied.finalizedAt, '2026-08-24T02:00:00.000Z');
  assert.equal(applied.appliedAt, '2026-08-24T03:00:00.000Z');
});

test('counts completed lifecycle states consistently', () => {
  assert.equal(isCompletedPersonaSession('active'), false);
  assert.equal(isCompletedPersonaSession('completed'), true);
  assert.equal(isCompletedPersonaSession('finalized'), true);
  assert.equal(isCompletedPersonaSession('applied'), true);
  assert.equal(isCompletedPersonaSession('aborted'), false);
});
