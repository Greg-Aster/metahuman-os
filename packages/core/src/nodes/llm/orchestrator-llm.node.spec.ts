import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENVIRONMENT_INTENT_JSON_SCHEMA,
  environmentIntentSchema,
  parseEnvironmentIntentRouting,
  resolveOrchestratorActionRequirement,
} from './orchestrator-llm.node.js';

test('intent schema advertises transfer destinations only from the current active executions', () => {
  const idle = environmentIntentSchema([]);
  assert.equal(idle.additionalProperties, false);
  assert.equal('executionDisposition' in idle.properties, false);
  assert.equal('targetExecutionId' in idle.properties, false);
  assert.deepEqual(idle.required, ENVIRONMENT_INTENT_JSON_SCHEMA.required);

  const active = environmentIntentSchema([{ executionId: 'active-job' }]);
  assert.ok('targetExecutionId' in active.properties);
  assert.ok('executionDisposition' in active.properties);
  assert.deepEqual(active.properties.targetExecutionId?.enum, ['', 'active-job']);
  assert.deepEqual(active.properties.executionDisposition?.enum, ['new', 'steer', 'cancel']);
  assert.ok(active.required.includes('targetExecutionId'));
});

test('Environment intent selects context and routes without owning the later objective decision', () => {
  const routing = parseEnvironmentIntentRouting(JSON.stringify({
    needsResponse: true,
    needsConversationHistory: true,
    needsMemory: false,
    needsRobotStatus: true,
    needsEnvironment: true,
    needsVision: true,
    needsAction: true,
  }));
  assert.equal(routing.needsAction, true);
  assert.deepEqual(ENVIRONMENT_INTENT_JSON_SCHEMA.required, Object.keys(routing));
  assert.equal('needsTaskLifecycle' in ENVIRONMENT_INTENT_JSON_SCHEMA.properties, false);
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
  const input = { needsResponse: true, needsConversationHistory: true, needsMemory: true,
    needsRobotStatus: false, needsEnvironment: false, needsVision: false, needsAction: false,
    memoryQuery: 'Most recent recorded dream, with its date', memoryTypes: ['dream'] };
  assert.deepEqual(parseEnvironmentIntentRouting(JSON.stringify(input)), input);
  assert.throws(() => parseEnvironmentIntentRouting(JSON.stringify({ ...input, memoryTypes: [123] })), /Invalid memory types/);
});
