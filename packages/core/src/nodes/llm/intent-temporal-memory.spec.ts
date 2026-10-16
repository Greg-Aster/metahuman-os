import assert from 'node:assert/strict';
import test from 'node:test';
import { ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA, parseEnvironmentIntentRouting } from './orchestrator-llm.node.js';

const routing = {
  needsResponse: true, needsAction: false, needsToolUse: false, taskPlanner: 'specialist',
  taskContext: [], conversationContext: ['memory'],
};

test('Intent preserves optional temporal memory selections without requiring a semantic query or session ID', () => {
  const selection = { ...routing, memoryTypes: ['dream'], memoryOrder: 'newest', memorySleepCycle: 'latest',
    memoryTimeRange: { from: '2026-10-13T00:00:00-07:00', before: '2026-10-15T00:00:00Z' } };
  assert.deepEqual(parseEnvironmentIntentRouting(JSON.stringify(selection)), selection);
  assert.deepEqual(parseEnvironmentIntentRouting(JSON.stringify(routing)), routing);
  assert.equal(ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA.required.includes('memoryOrder' as any), false);
  assert.deepEqual(ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA.properties.memorySleepCycle.enum, ['latest']);
});

test('Intent rejects temporal selections outside the approved contract', () => {
  for (const selection of [
    { memoryOrder: 'oldest' }, { memorySleepCycle: 'invented-session-id' },
    { memoryTimeRange: 'yesterday' }, { memoryTimeRange: { from: '2026-10-14T00:00:00' } },
    { memoryTimeRange: { before: 'not-a-timestamp' } }, { memoryTimeRange: { until: '2026-10-14T00:00:00Z' } },
  ]) assert.throws(() => parseEnvironmentIntentRouting(JSON.stringify({ ...routing, ...selection })), /Invalid memory/);
});
