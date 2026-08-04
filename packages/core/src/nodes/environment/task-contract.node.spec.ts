import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { environmentTaskContractNode } from './task-contract.node.js';
import { environmentTaskValidatorNode } from './task-validator.node.js';

function observation(
  options: { terminal?: boolean; originatingInstruction?: string } = {},
): EnvironmentObservation {
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

test('a valid Environment task decision owns a new action contract over router fallback', async () => {
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
  assert.equal(result.reconciled, false);
  assert.equal(result.taskDecision.outcome, 'act');
  assert.equal(result.taskDecision.objectiveComplete, false);
  assert.equal(result.taskDecision.reason, 'Execute the currently admitted physical step.');
  assert.equal(result.taskDecision.continuationPolicy, 'none');
  assert.equal(result.taskDecision.requiredCompletionBasis, 'action_result');
  assert.equal(result.contract.continuationPolicy, 'none');
  assert.equal(result.contract.requiredCompletionBasis, 'action_result');
  assert.equal(result.taskDecision.taskContractSource, 'environment_decision');
  assert.deepEqual(result.taskDecision.taskContractConflict, {
    model: {
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    routed: {
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  });
});

test('bounded objectives use the router evidence classification without changing model-owned continuation', async () => {
  const result = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Execute the next physical step in the bounded objective.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
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
  assert.equal(result.taskDecision.continuationPolicy, 'bounded');
  assert.equal(result.taskDecision.requiredCompletionBasis, 'visual_observation');
  assert.equal(result.taskDecision.taskContractSource, 'bounded_router_evidence');
  assert.equal(result.taskDecision.taskContractConflict.model.requiredCompletionBasis, 'action_result');
  assert.equal(result.taskDecision.taskContractConflict.routed.requiredCompletionBasis, 'visual_observation');
});

test('the router supplies a fallback contract when the Environment decision omitted one', async () => {
  const result = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Execute the admitted action.',
      objectiveComplete: false,
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
  assert.equal(result.taskDecision.continuationPolicy, 'bounded');
  assert.equal(result.taskDecision.requiredCompletionBasis, 'visual_observation');
  assert.equal(result.taskDecision.taskContractSource, 'router_fallback');
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
  assert.deepEqual(result.taskDecision, {
    ...taskDecision,
    taskContractSource: 'environment_decision',
  });
});

test('a no-action visual route cannot replace a direct response contract', async () => {
  const taskDecision = {
    outcome: 'complete',
    reason: 'The current correlated image supports a direct answer.',
    objectiveComplete: true,
    continuationPolicy: 'none',
    requiredCompletionBasis: 'response',
    completionBasis: 'response',
    completionEvidence: 'The requested description is present in the response.',
  };
  const result = await environmentTaskContractNode.execute({
    taskDecision,
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: true,
      actionType: 'none',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
    observation: observation(),
  }, {});

  assert.equal(result.reconciled, false);
  assert.deepEqual(result.taskDecision, {
    ...taskDecision,
    taskContractSource: 'environment_decision',
  });
  assert.equal(result.contract.requiredCompletionBasis, 'response');
});

test('a validator-persisted contract remains authoritative on a later no-action pass', async () => {
  const objective = 'Continue until the requested visual condition is present.';
  const currentObservation = observation();
  currentObservation.metadata = {
    ...currentObservation.metadata,
    taskValidatorCommand: {
      version: 3,
      objective,
      instruction: 'Inspect the current view for the requested condition.',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  };
  const result = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'The current response describes the state.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'response',
      completionBasis: 'response',
      completionEvidence: 'The response describes the state.',
    },
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: true,
      actionType: 'none',
      actionParams: {},
    },
    observation: currentObservation,
  }, {});

  assert.equal(result.reconciled, true);
  assert.equal(result.contract.objective, objective);
  assert.equal(result.contract.currentInstruction, 'Inspect the current view for the requested condition.');
  assert.equal(result.taskDecision.continuationPolicy, 'bounded');
  assert.equal(result.taskDecision.requiredCompletionBasis, 'visual_observation');
  assert.equal(result.taskDecision.taskContractSource, 'persisted');
});

test('a direct visual description remains a visible response after contract reconciliation', async () => {
  const response = 'I see a dim room with a shelving unit in front of the camera.';
  const currentObservation = observation();
  currentObservation.visual = {
    id: 'visual-1',
    timestamp: '2026-08-03T18:00:00.000Z',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    source: 'robot-camera',
    metadata: { correlationId: 'cycle-1' },
  };
  const reconciled = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'The correlated image can be described directly.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'response',
      completionBasis: 'response',
      completionEvidence: 'The description is present in the response.',
    },
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: true,
      actionType: 'none',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
    observation: currentObservation,
  }, {});
  const validated = await environmentTaskValidatorNode.execute({
    response,
    taskDecision: reconciled.taskDecision,
    instruction: 'Tell me what you see.',
    observation: currentObservation,
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: true,
      actionType: 'none',
    },
  }, { operatorMode: 'semi' });

  assert.equal(validated.complete, true);
  assert.equal(validated.response, response);
  assert.equal(validated.decision.requiredCompletionBasis, 'response');
  assert.equal(validated.decision.responseSuppressed, false);
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
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
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

  const terminalObservation = observation({
    terminal: true,
    originatingInstruction: initial.taskInstruction,
  });
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
    observation: terminalObservation,
  }, {});
  const terminal = await environmentTaskValidatorNode.execute({
    response: 'The physical step completed.',
    taskDecision: terminalContract.taskDecision,
    instruction: objective,
    observation: terminalObservation,
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

test('exact terminal feedback completes a one-shot motion even when a completion image is available', async () => {
  const objective = 'Do one advertised robot motion.';
  const initialContract = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Run the single requested motion.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    routingAnalysis: {
      needsAction: true,
      needsVision: true,
      actionType: 'robot_movement',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
  }, {});
  const initial = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'stand' }],
    taskDecision: initialContract.taskDecision,
    instruction: objective,
    observation: observation(),
  }, { operatorMode: 'semi' });

  assert.equal(initial.decision.continuationPolicy, 'none');
  assert.equal(initial.decision.requiredCompletionBasis, 'action_result');

  const terminalObservation = observation({
    terminal: true,
    originatingInstruction: initial.taskInstruction,
  });
  terminalObservation.visual = {
    id: 'visual-1',
    timestamp: '2026-08-03T18:00:01.000Z',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    source: 'robot-camera',
    metadata: { correlationId: 'cycle-1', actionId: 'action-1' },
  };
  const terminalContract = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'The exact correlated action completed.',
      objectiveComplete: true,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'action_result',
      completionEvidence: 'done',
    },
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: true,
      needsVision: true,
      actionType: 'none',
      actionParams: {},
    },
    observation: terminalObservation,
  }, {});
  const terminal = await environmentTaskValidatorNode.execute({
    response: 'The requested motion is complete.',
    taskDecision: terminalContract.taskDecision,
    instruction: objective,
    observation: terminalObservation,
  }, { operatorMode: 'semi' });

  assert.equal(terminal.complete, true);
  assert.equal(terminal.outcome, 'complete');
  assert.equal(terminal.response, 'The requested motion is complete.');
  assert.equal(terminal.shouldRefine, false);
  assert.equal(terminal.decision.completionBasis, 'action_result');
  assert.equal(terminal.decision.evidenceAssessment, null);
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
  assert.equal(hasEdge('10', 'observation', 'task-contract', 'observation'), true);
  assert.equal(hasEdge('task-contract', 'taskDecision', 'visual-evidence-assessor', 'taskDecision'), true);
  assert.equal(hasEdge('task-contract', 'taskDecision', 'task-validator', 'taskDecision'), true);
  assert.equal(hasEdge('6', 'taskDecision', 'task-validator', 'taskDecision'), false);
});
