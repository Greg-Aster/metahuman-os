import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeDesireMetrics, type Desire, type DesireOutcomeReview } from '../../agency/types.js';
import { VerdictRouterNode } from './verdict-router.node.js';

const desire = {
  id: 'desire-test',
  title: 'Test desire',
  description: 'Exercise the verdict router contract',
  reason: 'Verify named graph routing',
  metrics: initializeDesireMetrics(),
  status: 'executing',
  currentStage: 'executing',
  source: 'task',
  risk: 'low',
  strength: 0.8,
  baseWeight: 1,
  threshold: 0.7,
  decayRate: 0.01,
  lastReviewedAt: '2026-08-24T00:00:00.000Z',
  reinforcements: 0,
  runCount: 0,
  requiredTrustLevel: 'suggest',
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
} satisfies Desire;

const review = {
  id: 'outcome-test',
  verdict: 'completed',
  reasoning: 'The goal was met',
  successScore: 1,
  lessonsLearned: [],
  reviewedAt: '2026-08-24T00:00:00.000Z',
  notifyUser: false,
} satisfies DesireOutcomeReview;

test('routes graph-provided named slot input', async () => {
  const result = await VerdictRouterNode.execute({
    slot_0: { desire, outcomeReview: review, verdict: review.verdict },
  }, {});

  assert.equal(result.selectedRoute, 0);
  assert.equal(result.verdict, 'completed');
  assert.equal(result.output0.desire, desire);
  assert.equal(result.output1, null);
  assert.equal(result.output2, null);
});

test('routes milestone continuation back to planning without duplicating advancement state', async () => {
  const longRunningDesire = {
    ...desire,
    goalType: 'long_running',
  } satisfies Desire;
  const continuationReview = {
    ...review,
    verdict: 'continue',
    milestoneAdvance: true,
    completionCriteriaMet: false,
  } satisfies DesireOutcomeReview;

  const result = await VerdictRouterNode.execute({
    slot_0: {
      desire: longRunningDesire,
      outcomeReview: continuationReview,
      verdict: continuationReview.verdict,
    },
  }, {});

  assert.equal(result.selectedRoute, 1);
  assert.equal(result.milestoneAdvanced, true);
  assert.equal(result.output1.desire, longRunningDesire);
});
