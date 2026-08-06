import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  EnvironmentFeedback,
  EnvironmentObservation,
} from '@metahuman/core/environment-interface';
import { attachCorrelatedFeedback } from './feedback-correlation.js';

const feedback: EnvironmentFeedback = {
  id: 'result-1',
  timestamp: '2026-07-23T14:00:01.000Z',
  type: 'completed',
  message: 'done',
  actionId: 'action-1',
};

const visual = {
  id: 'post-action-frame-1',
  timestamp: '2026-07-23T14:00:02.000Z',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
  source: 'robot-camera',
  metadata: { actionId: 'action-1', correlationId: 'cycle-1' },
};

function observation(
  overrides: Partial<EnvironmentObservation> = {},
): EnvironmentObservation {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'ainekio-01',
    timestamp: '2026-07-23T14:00:02.000Z',
    capabilities: { actions: ['captureImage'], visual: true },
    visual,
    metadata: { actionId: 'action-1', correlationId: 'cycle-1' },
    ...overrides,
  };
}

test('does not duplicate feedback already carried by the correlated image', () => {
  const source = observation({ feedback: [feedback] });
  const merged = attachCorrelatedFeedback(source, feedback);
  assert.equal(merged, source);
  assert.equal(merged.feedback?.length, 1);
});

test('attaches a separately delivered result only to its matching action image', () => {
  const merged = attachCorrelatedFeedback(observation(), feedback);
  assert.equal(merged.feedback?.length, 1);
  assert.equal(merged.feedback?.[0]?.id, feedback.id);
  assert.equal(merged.visual, visual);
  assert.equal(merged.visual?.metadata?.actionId, feedback.actionId);
});

test('does not attach a pending result to an unrelated observation', () => {
  const source = observation({ metadata: { actionId: 'action-2' } });
  const merged = attachCorrelatedFeedback(source, feedback);
  assert.equal(merged, source);
  assert.equal(merged.feedback, undefined);
});
