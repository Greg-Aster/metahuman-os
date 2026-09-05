import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySessionLifecycleTimestamps,
  applyAnswerToSession,
  applyQuestionToSession,
  getPersonaSessionStoragePaths,
  isCompletedPersonaSession,
  loadSession,
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

test('keeps question and answer retries idempotent without creating parallel turns', () => {
  const current = session('active');
  const firstQuestion = {
    id: 'q1',
    prompt: 'What principles guide your choices?',
    category: 'values' as const,
  };
  assert.equal(applyQuestionToSession(current, firstQuestion).created, true);
  assert.equal(applyQuestionToSession(current, firstQuestion).created, false);
  assert.throws(
    () => applyQuestionToSession(current, { ...firstQuestion, prompt: 'A conflicting retry' }),
    /conflicts/,
  );
  assert.deepEqual(
    applyQuestionToSession(current, { id: 'q2', prompt: 'What is next?', category: 'goals' }),
    { question: firstQuestion, created: false },
  );

  const limits = { minLength: 3, maxLength: 100 };
  const firstAnswer = applyAnswerToSession(
    current,
    'q1',
    '  Autonomy and care.  ',
    limits,
    '2026-09-04T00:00:00.000Z',
  );
  assert.equal(firstAnswer.created, true);
  assert.equal(firstAnswer.answer.content, 'Autonomy and care.');
  assert.equal(current.categoryCoverage.values, 50);
  assert.equal(applyAnswerToSession(
    current,
    'q1',
    'Autonomy and care.',
    limits,
    '2026-09-04T00:01:00.000Z',
  ).created, false);
  assert.throws(
    () => applyAnswerToSession(current, 'q1', 'A different answer.', limits, '2026-09-04T00:02:00.000Z'),
    /already been recorded/,
  );
  assert.equal(
    applyQuestionToSession(current, { id: 'q2', prompt: 'What is next?', category: 'goals' }).created,
    true,
  );
});

test('validates answer limits and permits an exact completed-session retry only', () => {
  const current = session('active');
  applyQuestionToSession(current, {
    id: 'q1',
    prompt: 'What principles guide your choices?',
    category: 'values',
  });
  const limits = { minLength: 3, maxLength: 10 };
  assert.throws(
    () => applyAnswerToSession(current, 'q1', 'x', limits, '2026-09-04T00:00:00.000Z'),
    /between 3 and 10/,
  );
  applyAnswerToSession(current, 'q1', 'Care', limits, '2026-09-04T00:00:00.000Z');
  current.status = 'completed';
  assert.equal(
    applyAnswerToSession(current, 'q1', 'Care', limits, '2026-09-04T00:01:00.000Z').created,
    false,
  );
  current.questions.push({ id: 'q2', prompt: 'What is next?', category: 'goals' });
  assert.throws(
    () => applyAnswerToSession(current, 'q2', 'Later', limits, '2026-09-04T00:02:00.000Z'),
    /not active/,
  );
});

test('rejects unsafe session identifiers before resolving storage paths', async () => {
  await assert.rejects(loadSession('tester', '../other-profile'), /Invalid persona interview session ID/);
});
