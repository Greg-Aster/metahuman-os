import assert from 'node:assert/strict';
import test from 'node:test';
import { OrchestratorLLMNode, resolveOrchestratorActionRequirement } from './orchestrator-llm.node.js';

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

test('a strict persisted Environment route returns without model inference', async () => {
  const route = {
    needsMemory: false,
    memoryTier: 'hot',
    memoryQuery: '',
    memoryTypes: [],
    needsEnvironment: true,
    needsVision: false,
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
    complexity: 0.2,
    responseStyle: 'conversational',
    responseLength: 'brief',
    isFollowUp: true,
    emotionalTone: 'neutral',
  };
  const result = await OrchestratorLLMNode.execute({
    message: 'This input must not reach a model.',
    precomputedAnalysis: route,
  }, { cognitiveMode: 'environment' }, {});

  assert.deepEqual(result.analysis, route);
  assert.equal(result.needsAction, true);
});
