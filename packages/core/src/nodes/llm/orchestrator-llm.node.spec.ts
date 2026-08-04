import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOrchestratorActionRequirement } from './orchestrator-llm.node.js';

test('Environment complexity never becomes physical-action authority', () => {
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

test('explicit Environment action decisions remain authorized', () => {
  assert.equal(resolveOrchestratorActionRequirement({
    declaredNeedsAction: true,
    actionType: 'robot_movement',
    complexity: 0.2,
    cognitiveMode: 'environment',
  }), true);
});
