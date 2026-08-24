import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGoalTier,
  matchesGoal,
  normalizeGoals,
} from './goal-manager.node.js';

test('accepts only canonical goal tiers', () => {
  assert.equal(getGoalTier('midTerm'), 'midTerm');
  assert.equal(getGoalTier('unknown'), 'shortTerm');
  assert.equal(getGoalTier(null), 'shortTerm');
});

test('normalizes legacy goal strings and rejects malformed entries', () => {
  assert.deepEqual(normalizeGoals([
    'Legacy goal',
    { id: 'goal-1', goal: 'Canonical goal', status: 'planning' },
    { status: 'active' },
    '',
  ]), [
    { goal: 'Legacy goal', status: 'active' },
    { id: 'goal-1', goal: 'Canonical goal', status: 'planning' },
  ]);
});

test('matches goal mutations by stable ID or exact goal name', () => {
  const goal = { id: 'goal-1', goal: 'Canonical goal', status: 'active' };

  assert.equal(matchesGoal(goal, { id: 'goal-1' }), true);
  assert.equal(matchesGoal(goal, { goal: 'Canonical goal' }), true);
  assert.equal(matchesGoal(goal, { id: 'goal-2', goal: 'Other goal' }), false);
});
