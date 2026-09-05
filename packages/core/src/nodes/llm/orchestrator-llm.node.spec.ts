import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENVIRONMENT_INTENT_JSON_SCHEMA,
  parseEnvironmentIntentRouting,
  resolveOrchestratorActionRequirement,
} from './orchestrator-llm.node.js';

test('Environment intent routing gives the LLM an independent task-lifecycle decision', () => {
  assert.equal(ENVIRONMENT_INTENT_JSON_SCHEMA.required.includes('needsTaskLifecycle'), true);
  assert.equal(
    ENVIRONMENT_INTENT_JSON_SCHEMA.properties.needsTaskLifecycle.type,
    'boolean',
  );

  const routing = parseEnvironmentIntentRouting(JSON.stringify({
    needsResponse: true,
    needsConversationHistory: true,
    needsMemory: false,
    needsRobotStatus: true,
    needsEnvironment: true,
    needsVision: true,
    needsAction: true,
    needsTaskLifecycle: true,
  }));
  assert.equal(routing.needsTaskLifecycle, true);
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
