import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { environmentTaskContractNode } from './task-contract.node.js';
import { environmentTaskValidatorNode } from './task-validator.node.js';

function observation(options: { terminal?: boolean; originatingInstruction?: string } = {}) {
  return {
    environmentId: 'robot-environment',
    adapter: 'robot-adapter',
    sessionId: 'robot-1',
    timestamp: '2026-08-03T18:00:00.000Z',
    capabilities: {
      actions: ['robotCommand', 'captureImage'],
      robotCommands: ['stand'],
      text: true,
      movement: true,
      visual: true,
      map: false,
    },
    feedback: options.terminal
      ? [{
          id: 'feedback-1',
          timestamp: '2026-08-03T18:00:01.000Z',
          type: 'completed',
          message: 'done',
          actionId: 'action-1',
          data: { command: 'stand' },
        }]
      : [],
    metadata: {
      ...(options.originatingInstruction
        ? { originatingInstruction: options.originatingInstruction }
        : {}),
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: options.terminal ? 2 : 1,
        maxSteps: 4,
        triggerSource: 'user',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };
}

test('task contract keeps result claims but replaces one-step evidence with the independent bounded contract', async () => {
  const result = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Execute the currently admitted physical step.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
  }, {});

  assert.equal(result.valid, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.taskDecision.outcome, 'act');
  assert.equal(result.taskDecision.objectiveComplete, false);
  assert.equal(result.taskDecision.reason, 'Execute the currently admitted physical step.');
  assert.equal(result.taskDecision.continuationPolicy, 'bounded');
  assert.equal(result.taskDecision.requiredCompletionBasis, 'visual_observation');
});

test('task contract preserves the Environment decision when routing has no valid contract', async () => {
  const taskDecision = {
    outcome: 'complete',
    reason: 'The current state supports the direct response.',
    objectiveComplete: true,
    continuationPolicy: 'none',
    requiredCompletionBasis: 'response',
    completionBasis: 'response',
    completionEvidence: 'The requested result is present in the response.',
  };
  const result = await environmentTaskContractNode.execute({
    taskDecision,
    routingAnalysis: { needsAction: false, actionType: 'none', actionParams: {} },
  }, {});

  assert.equal(result.valid, true);
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.taskDecision, taskDecision);
});

test('controller completion finishes one step but cannot close a sensor-bounded objective', async () => {
  const objective = 'Maintain the requested activity subject to a later visual completion condition.';
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  };
  const initialContract = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Execute the current physical step.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    routingAnalysis,
  }, {});
  const initial = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'stand' }],
    taskDecision: initialContract.taskDecision,
    instruction: objective,
    observation: observation(),
  }, { operatorMode: 'semi' });

  assert.equal(initial.decision.continuationPolicy, 'bounded');
  assert.equal(initial.decision.requiredCompletionBasis, 'visual_observation');

  const terminalContract = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'The controller completed the physical step.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      completionBasis: 'action_result',
      completionEvidence: 'done',
    },
    routingAnalysis: {
      ...routingAnalysis,
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
  }, {});
  const terminal = await environmentTaskValidatorNode.execute({
    response: 'The physical step completed.',
    taskDecision: terminalContract.taskDecision,
    instruction: objective,
    observation: observation({
      terminal: true,
      originatingInstruction: initial.taskInstruction,
    }),
  }, { operatorMode: 'semi' });

  assert.equal(terminal.complete, false);
  assert.equal(terminal.outcome, 'continue');
  assert.equal(terminal.decision.completionVerified, false);
  assert.equal(terminal.decision.requiredCompletionBasis, 'visual_observation');
  assert.equal(terminal.decision.terminalFeedback, 'completed');
  assert.equal(terminal.decision.refinementRequested, true);
  assert.equal(terminal.shouldRefine, true);
  assert.equal(terminal.refinementRequest.requiredCompletionBasis, 'visual_observation');
});

test('Environment graph reconciles task contracts before visual assessment and validation', () => {
  const graph = JSON.parse(fs.readFileSync(
    new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
    'utf8',
  ));
  const hasEdge = (source: string, sourceHandle: string, target: string, targetHandle: string) => (
    graph.edges.some((edge: Record<string, unknown>) => (
      edge.source === source
      && edge.sourceHandle === sourceHandle
      && edge.target === target
      && edge.targetHandle === targetHandle
    ))
  );

  assert(graph.nodes.some((node: Record<string, any>) => node.data?.nodeType === 'environment_task_contract'));
  assert.equal(hasEdge('6', 'taskDecision', 'task-contract', 'taskDecision'), true);
  assert.equal(hasEdge('context-router', 'analysis', 'task-contract', 'routingAnalysis'), true);
  assert.equal(hasEdge('task-contract', 'taskDecision', 'visual-evidence-assessor', 'taskDecision'), true);
  assert.equal(hasEdge('task-contract', 'taskDecision', 'task-validator', 'taskDecision'), true);
  assert.equal(hasEdge('6', 'taskDecision', 'task-validator', 'taskDecision'), false);
});
