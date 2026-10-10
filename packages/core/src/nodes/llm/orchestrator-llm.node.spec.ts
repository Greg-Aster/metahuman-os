import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA,
  parseEnvironmentIntentRouting,
  resolveOrchestratorActionRequirement,
} from './orchestrator-llm.node.js';

test('Environment intent selects context and routes without owning the later objective decision', () => {
  const routing = parseEnvironmentIntentRouting(JSON.stringify({
    needsResponse: true, needsAction: true,
    taskContext: ['environment', 'vision'],
    conversationContext: ['conversationHistory', 'robotStatus'],
  }));
  assert.equal(routing.needsAction, true);
  assert.deepEqual(ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA.required, Object.keys(routing));
  assert.equal('needsTaskLifecycle' in ENVIRONMENT_REQUEST_INTENT_JSON_SCHEMA.properties, false);
});

test('Environment complexity never changes the advisory action hint', () => {
  assert.equal(resolveOrchestratorActionRequirement({
    declaredNeedsAction: false,
    actionType: 'none',
    complexity: 1,
    cognitiveMode: 'environment',
  }), false);
});

test('non-Environment orchestrators retain complexity escalation', () => {
  assert.equal(resolveOrchestratorActionRequirement({
    declaredNeedsAction: false,
    actionType: 'none',
    complexity: 0.9,
    cognitiveMode: 'dual',
  }), true);
});

test('explicit Environment action decisions remain available as advisory hints', () => {
  assert.equal(resolveOrchestratorActionRequirement({
    declaredNeedsAction: true,
    actionType: 'robot_movement',
    complexity: 0.2,
    cognitiveMode: 'environment',
  }), true);
});

test('Environment routing preserves model-selected recall query and record types', () => {
  const input = { needsResponse: true, needsAction: false, taskContext: [],
    conversationContext: ['persona.personality', 'memory', 'conversationHistory'],
    memoryQuery: 'Most recent recorded dream, with its date', memoryTypes: ['dream'] };
  assert.deepEqual(parseEnvironmentIntentRouting(JSON.stringify(input)), input);
  const { taskContext: _task, ...missing } = input;
  assert.throws(() => parseEnvironmentIntentRouting(JSON.stringify(missing)), /valid context entries in taskContext/);
  assert.throws(() => parseEnvironmentIntentRouting(JSON.stringify({ ...input, taskContext: ['unknown'] })), /valid context entries/);
  assert.throws(() => parseEnvironmentIntentRouting(JSON.stringify({ ...input, memoryTypes: [123] })), /Invalid memory types/);
});
