import assert from 'node:assert/strict';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentActionParserNode } from './action-parser.node.js';
import { environmentContextBuilderNode } from './context-builder.node.js';
import { environmentTaskStateNode } from './task-state.node.js';

const staleAutonomyObservation: EnvironmentObservation = {
  environmentId: 'robot-environment',
  adapter: 'robot-adapter',
  sessionId: 'robot-1',
  timestamp: '2026-08-24T21:29:29.153Z',
  capabilities: {
    actions: ['captureImage'],
    robotCommands: [],
    text: true,
    movement: false,
    visual: true,
    map: false,
  },
  feedback: [],
  metadata: {
    robotObserver: {
      cycleId: 'previous-boredom-cycle',
      step: 2,
      triggerSource: 'autonomy',
      graph: 'boredom-autonomy',
      requestedBy: 'boredom-movement',
    },
  },
};

const userContext = {
  userMessage: 'what do you see?',
  username: 'Ainekio',
};

test('a direct user turn overrides stale autonomous observation provenance', async () => {
  const prepared = await environmentTaskStateNode.execute({
    observation: staleAutonomyObservation,
    instruction: userContext.userMessage,
    userInstruction: userContext.userMessage,
    inputSource: 'user',
  }, userContext, { phase: 'prepare' });

  const context = await environmentContextBuilderNode.execute({
    observation: staleAutonomyObservation,
    instruction: prepared.instruction,
    taskState: prepared.taskState,
    routingAnalysis: prepared.routingAnalysis,
    userInstruction: userContext.userMessage,
    inputSource: 'user',
  }, userContext, { systemPrompt: 'Return strict Environment JSON.', recentHistoryLimit: 4 });
  const selectorEnvelope = JSON.parse(String(context.message));
  const requiredDecisionFields = (context.jsonSchema as any).properties.taskDecision.required;

  assert.equal(selectorEnvelope.inputSource, 'user');
  assert.equal(requiredDecisionFields.includes('objective'), false);

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need one fresh camera frame before I can answer.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Current visual evidence is required.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'information_gain',
      },
    }),
    observation: staleAutonomyObservation,
    sessionId: staleAutonomyObservation.sessionId,
    routingAnalysis: prepared.routingAnalysis,
    userInstruction: userContext.userMessage,
    inputSource: 'user',
  }, userContext, {});

  assert.equal(parsed.taskDecisionError, '');
  assert.equal(parsed.actions[0]?.type, 'captureImage');

  const reduced = await environmentTaskStateNode.execute({
    observation: staleAutonomyObservation,
    instruction: prepared.instruction,
    taskState: prepared.taskState,
    actions: parsed.actions,
    taskDecision: parsed.taskDecision,
    taskDecisionError: parsed.taskDecisionError,
    response: parsed.response,
    actionAdmission: parsed.actionAdmission,
    userInstruction: userContext.userMessage,
    inputSource: 'user',
  }, userContext, { phase: 'reduce' });

  assert.equal(reduced.actions[0]?.type, 'captureImage');
});

test('an explicit autonomous turn still requires an authored objective', async () => {
  const context = await environmentContextBuilderNode.execute({
    observation: staleAutonomyObservation,
    instruction: 'Choose one bounded autonomous response.',
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: false,
      needsMemory: false,
      isFollowUp: false,
    },
    userInstruction: '',
    inputSource: 'autonomy',
  }, {
    userMessage: 'Autonomous stimulus text.',
  }, { systemPrompt: 'Return strict Environment JSON.', recentHistoryLimit: 4 });
  const selectorEnvelope = JSON.parse(String(context.message));
  const requiredDecisionFields = (context.jsonSchema as any).properties.taskDecision.required;

  assert.equal(selectorEnvelope.inputSource, 'autonomy');
  assert.equal(requiredDecisionFields.includes('objective'), true);
});
