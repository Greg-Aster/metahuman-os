import assert from 'node:assert/strict';
import test from 'node:test';

import type { Desire } from './types.js';
import {
  needsClarifyingQuestions,
  parseDesireQuestionsResponse,
} from './desire-questions.js';

function desire(overrides: Partial<Desire> = {}): Desire {
  return {
    id: 'desire-test',
    title: 'Prepare a field test',
    description: 'Prepare and document a bounded field test with measurable acceptance criteria.',
    reason: 'Validate the current implementation.',
    metrics: {} as Desire['metrics'],
    source: 'task',
    strength: 0.8,
    baseWeight: 1,
    threshold: 0.7,
    decayRate: 0.01,
    lastReviewedAt: '2026-08-25T00:00:00.000Z',
    reinforcements: 1,
    runCount: 1,
    risk: 'low',
    requiredTrustLevel: 'suggest',
    status: 'planning',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

test('question policy does not compete with pending or completed question rounds', () => {
  assert.deepEqual(needsClarifyingQuestions(desire()), {
    needs: false,
    reason: 'Desire is clear and low-risk',
  });

  assert.deepEqual(needsClarifyingQuestions(desire({ risk: 'high' })), {
    needs: true,
    reason: 'Risk level is high',
  });

  const pending = desire({
    clarifyingQuestions: {
      phase: 'before_planning',
      questions: [{ id: 'q-existing', text: 'When?', type: 'free_text', required: true }],
      answers: [],
    },
  });
  assert.equal(needsClarifyingQuestions(pending).needs, false);

  const answered = desire({
    clarifyingQuestions: {
      phase: 'before_planning',
      questions: [],
      answers: [{ questionId: 'q-existing', answer: 'Tomorrow', answeredAt: '2026-08-25T01:00:00.000Z' }],
    },
  });
  assert.equal(needsClarifyingQuestions(answered).needs, false);
});

test('question response parser accepts only the explicit model contract', () => {
  const questions = parseDesireQuestionsResponse(`Result:
[
  {"text":" When should this start? ","type":"free_text","required":true},
  {"text":"Which environment?","type":"choice","required":false,"options":[" Lab ","Field"]}
]`);

  assert.equal(questions.length, 2);
  assert.equal(questions[0].text, 'When should this start?');
  assert.match(questions[0].id, /^q-[0-9a-f]{8}$/);
  assert.deepEqual(questions[1].options, ['Lab', 'Field']);

  assert.throws(
    () => parseDesireQuestionsResponse('No structured questions were returned.'),
    /did not contain a JSON array/,
  );
  assert.throws(
    () => parseDesireQuestionsResponse('[{"text":"When?","type":"free_text"}]'),
    /must declare whether it is required/,
  );
  assert.throws(
    () => parseDesireQuestionsResponse('[{"text":"Where?","type":"choice","required":true,"options":["Only one"]}]'),
    /at least two options/,
  );
  assert.throws(
    () => parseDesireQuestionsResponse('[{"text":"When?","type":"unsupported","required":true}]'),
    /unsupported type/,
  );
});
