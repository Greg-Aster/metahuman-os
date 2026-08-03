import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import type { TaskInput } from '../../queue/index.js';
import { environmentActionParserNode } from './action-parser.node.js';
import { environmentInstructionInterpreterNode } from './instruction-interpreter.node.js';
import { environmentTaskValidatorNode, type EnvironmentWorkflowCommand } from './task-validator.node.js';
import { environmentWorkflowCommandNode } from './workflow-command.node.js';

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

const environmentGraph = JSON.parse(fs.readFileSync(
  new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
  'utf8',
)) as {
  nodes: Array<{ id: string; data: { nodeType: string } }>;
  edges: Array<{ source: string; sourceHandle: string; target: string; targetHandle: string }>;
};

function graphEdge(source: string, sourceHandle: string, target: string, targetHandle: string): boolean {
  return environmentGraph.edges.some(edge => (
    edge.source === source
    && edge.sourceHandle === sourceHandle
    && edge.target === target
    && edge.targetHandle === targetHandle
  ));
}

function observation(
  options: {
    source?: 'user' | 'autonomy';
    step?: number;
    maxSteps?: number;
    terminalCommand?: string;
    objective?: string;
    visual?: boolean;
  } = {},
): EnvironmentObservation {
  const source = options.source ?? 'user';
  const step = options.step ?? 2;
  const maxSteps = options.maxSteps ?? 3;
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-03T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage', 'robotCommand', 'sendText'],
      robotCommands: ['walk', 'left', 'right', 'stand', 'rest', 'stop'],
      text: true,
      movement: true,
      visual: true,
      map: false,
    },
    feedback: options.terminalCommand
      ? [{
          id: 'feedback-1',
          timestamp: '2026-08-03T12:00:00.000Z',
          type: 'completed',
          message: 'done',
          actionId: 'action-1',
          data: { command: options.terminalCommand },
        }]
      : [],
    visual: options.visual
      ? {
          id: 'visual-1',
          timestamp: '2026-08-03T12:00:00.000Z',
          mimeType: 'image/jpeg',
          dataUrl: TEST_JPEG,
          source: 'robot-camera',
          metadata: {
            correlationId: 'cycle-1',
            actionId: 'action-1',
          },
        }
      : undefined,
    metadata: {
      originatingInstruction: options.objective ?? 'Complete the objective subject to its stated criterion.',
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step,
        maxSteps,
        triggerSource: source,
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };
}

test('action parser preserves a structured task decision while terminal feedback blocks same-pass actions', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The ball is not visible yet.',
      actions: [{ type: 'robotCommand', command: 'left' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'continue',
        reason: 'A different view is needed.',
        objectiveComplete: false,
        nextInstruction: 'Turn left to inspect a different part of the room.',
        continuationType: 'advance',
      },
    }),
    instruction: 'Complete the objective subject to its stated criterion.',
    observation: observation({ terminalCommand: 'walk' }),
    sessionId: 'robot-1',
  }, {});

  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.taskDecision.outcome, 'continue');
  assert.equal(parsed.taskDecision.nextInstruction, 'Turn left to inspect a different part of the room.');
  assert.equal(parsed.taskDecision.continuationType, 'advance');
});

test('completion feedback keeps the original objective authoritative without directly reissuing an action', async () => {
  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: observation({
      objective: 'Maintain the requested activity subject to its termination criterion.',
      terminalCommand: 'walk',
      visual: true,
    }),
  }, {});

  assert.match(interpreted.instruction, /only one step/i);
  assert.match(interpreted.instruction, /does not by itself mean the original objective/i);
  assert.match(interpreted.instruction, /still authoritative for completion validation/i);
  assert.doesNotMatch(interpreted.instruction, /context only/i);
});

test('parser preserves candidate actions while validator enforces Semi and Full source policy', async () => {
  const inputs = {
    response: JSON.stringify({
      response: 'I can turn left.',
      actions: [{ type: 'robotCommand', command: 'left' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Inspect the adjacent area.',
        objectiveComplete: false,
      },
    }),
    instruction: 'Inspect the adjacent area.',
    observation: observation({ source: 'autonomy' }),
    sessionId: 'robot-1',
    routingAnalysis: { needsAction: true, actionType: 'robot_movement' },
  };
  const parsed = await environmentActionParserNode.execute(inputs, { operatorMode: 'semi' });
  assert.equal(parsed.actions.length, 1);

  const semi = await environmentTaskValidatorNode.execute({
    ...parsed,
    instruction: inputs.instruction,
    observation: inputs.observation,
  }, { operatorMode: 'semi' });
  assert.deepEqual(semi.actions, []);
  assert.equal(semi.decision.blockedReason, 'current_action_blocked_semi_autonomy');

  const full = await environmentTaskValidatorNode.execute({
    ...parsed,
    instruction: inputs.instruction,
    observation: inputs.observation,
  }, { operatorMode: 'full' });
  assert.equal(full.actions.length, 1);
  assert.equal(full.actions[0].command, 'left');

  const contradictoryParsed = await environmentActionParserNode.execute({
    ...inputs,
    response: JSON.stringify({
      response: 'The task is complete.',
      actions: [{ type: 'robotCommand', command: 'left' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'The objective is already satisfied.',
        objectiveComplete: true,
      },
    }),
  }, { operatorMode: 'full' });
  assert.equal(contradictoryParsed.actions.length, 1);

  const contradictory = await environmentTaskValidatorNode.execute({
    ...contradictoryParsed,
    instruction: inputs.instruction,
    observation: inputs.observation,
  }, { operatorMode: 'full' });
  assert.equal(contradictory.actions.length, 1);
  assert.equal(contradictory.complete, false);
  assert.equal(contradictory.outcome, 'act');
  assert.equal(contradictory.shouldQueue, false);
});

test('Environment Mode routes current work through the validator before bridge admission', () => {
  const validator = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_task_validator');
  const command = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_workflow_command');
  const parser = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_action_parser');
  const bridge = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_send_action');
  assert(validator);
  assert(command);
  assert(parser);
  assert(bridge);
  assert.equal(graphEdge(parser.id, 'taskDecision', validator.id, 'taskDecision'), true);
  assert.equal(graphEdge(validator.id, 'workflowCommand', command.id, 'command'), true);
  assert.equal(graphEdge(parser.id, 'actions', bridge.id, 'actions'), false);
  assert.equal(graphEdge(validator.id, 'actions', bridge.id, 'actions'), true);
  assert.equal(graphEdge(validator.id, 'response', bridge.id, 'response'), true);
  assert.equal(graphEdge(validator.id, 'movementRequest', 'movement-generator', 'movementRequest'), true);
});

test('a premature action-result claim cannot suppress an authorized one-shot command', async () => {
  const currentObservation = observation({ source: 'user', step: 1, maxSteps: 8, objective: 'Please rest.' });
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will rest now.',
      actions: [{ type: 'robotCommand', command: 'rest' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'The rest command has been executed.',
        objectiveComplete: true,
        completionBasis: 'action_result',
        completionEvidence: 'The rest command has been executed.',
      },
    }),
    instruction: 'Please rest.',
    observation: currentObservation,
    sessionId: currentObservation.sessionId,
    routingAnalysis: { needsAction: true, actionType: 'robot_movement' },
  }, {});
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].command, 'rest');

  const validated = await environmentTaskValidatorNode.execute({
    ...parsed,
    instruction: 'Please rest.',
    observation: currentObservation,
  }, { operatorMode: 'semi' });
  assert.equal(validated.actions.length, 1);
  assert.equal(validated.actions[0].command, 'rest');
  assert.equal(validated.complete, false);
  assert.equal(validated.outcome, 'act');
  assert.equal(validated.shouldQueue, false);
  assert.equal(validated.decision.stepComplete, false);
  assert.equal(validated.decision.blockedReason, 'objective_completion_unverified');
});

test('fresh external completion evidence suppresses a contradictory candidate action', async () => {
  const currentObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 8,
    objective: 'Continue until the external completion criterion is visible.',
    visual: true,
  });
  const result = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'left' }],
    response: 'The completion criterion is now visible.',
    taskDecision: {
      outcome: 'complete',
      reason: 'The current correlated view satisfies the objective.',
      objectiveComplete: true,
      completionBasis: 'visual_observation',
      completionEvidence: 'The fresh correlated visual contains the completion criterion.',
    },
    observation: currentObservation,
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, true);
  assert.deepEqual(result.actions, []);
  assert.equal(result.shouldQueue, false);
});

test('semi mode converts an incomplete user task into one bounded workflow command', async () => {
  const result = await environmentTaskValidatorNode.execute({
    actions: [],
    movementRequest: null,
    response: 'The current step did not satisfy the objective.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      nextInstruction: 'Perform the next distinct step and evaluate its evidence.',
      continuationType: 'advance',
    },
    instruction: 'Complete the objective subject to its stated criterion.',
    observation: observation({ source: 'user', terminalCommand: 'walk' }),
  }, { operatorMode: 'semi' });

  assert.equal(result.shouldQueue, true);
  assert.equal(result.nextInstruction, 'Perform the next distinct step and evaluate its evidence.');
  assert.equal(result.workflowCommand.kind, 'environment_workflow_command');
  assert.equal(result.workflowCommand.objective, 'Complete the objective subject to its stated criterion.');
  assert.equal(result.workflowCommand.source, 'user');
  assert.equal(result.workflowCommand.advanceCycle, false);
  assert.deepEqual(result.actions, []);
});

test('validator verifies generic completion evidence without inspecting objective wording', async () => {
  const objective = 'Maintain the requested activity subject to its termination criterion.';
  const unsupported = await environmentTaskValidatorNode.execute({
    response: 'The current step finished.',
    taskDecision: {
      outcome: 'report',
      reason: 'The current step finished.',
      objectiveComplete: true,
      completionBasis: 'visual_observation',
      completionEvidence: 'The termination criterion is present in the current observation.',
    },
    observation: observation({ source: 'user', terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(unsupported.complete, false);
  assert.equal(unsupported.outcome, 'continue');
  assert.equal(unsupported.decision.blockedReason, 'objective_completion_unverified');

  const supported = await environmentTaskValidatorNode.execute({
    response: 'The objective is complete.',
    taskDecision: {
      outcome: 'complete',
      reason: 'Current correlated evidence satisfies the objective.',
      objectiveComplete: true,
      completionBasis: 'visual_observation',
      completionEvidence: 'The current correlated visual contains the required completion evidence.',
    },
    observation: observation({ source: 'user', terminalCommand: 'walk', objective, visual: true }),
  }, { operatorMode: 'semi' });

  assert.equal(supported.complete, true);
  assert.equal(supported.decision.completionVerified, true);
  assert.equal(supported.shouldQueue, false);
});

test('semi queues a bounded continuation after a completed response with no robot action', async () => {
  const objective = 'Produce one bounded item per turn; termination is governed by the objective criterion.';
  const inputs = {
    response: 'Here is the current requested item.',
    taskDecision: {
      outcome: 'continue',
      reason: 'The objective criterion is not satisfied.',
      objectiveComplete: false,
      nextInstruction: 'Produce the next bounded item and evaluate current completion evidence.',
      continuationType: 'advance',
    },
    instruction: objective,
    observation: observation({ source: 'user', step: 1, maxSteps: 3, objective }),
  };
  const semi = await environmentTaskValidatorNode.execute(inputs, { operatorMode: 'semi' });
  assert.equal(semi.decision.stepComplete, true);
  assert.equal(semi.shouldQueue, true);
  assert.equal(semi.workflowCommand.step, 1);
  assert.equal(semi.workflowCommand.advanceCycle, true);

  const reactive = await environmentTaskValidatorNode.execute(inputs, { operatorMode: 'reactive' });
  assert.equal(reactive.shouldQueue, false);
  assert.equal(reactive.decision.blockedReason, 'mode_reactive_source_user');
});

test('an incomplete user objective cannot stall when optional continuation refinements are omitted', async () => {
  const objective = 'Continue the requested activity until its completion criterion is satisfied.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective criterion is not satisfied.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective criterion.',
      objectiveComplete: false,
      nextInstruction: 'Assign the next step to a different actor.',
    },
    observation: observation({ source: 'user', step: 1, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(result.shouldQueue, true);
  assert.equal(result.nextInstruction, objective);
  assert.equal(result.workflowCommand.objective, objective);
  assert.equal(result.workflowCommand.instruction, objective);
  assert.equal(result.workflowCommand.advanceCycle, false);
  assert.equal(result.decision.continuationType, 'advance');
  assert.equal(result.decision.continuationDerived, true);
  assert.equal(result.decision.blockedReason, '');
});

test('an unsupported response-only completion cannot create a no-progress retry loop', async () => {
  const objective = 'Complete the embodied objective subject to its external criterion.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'I cannot perform the condition described in the objective.',
    taskDecision: {
      outcome: 'complete',
      reason: 'The response explains why the task cannot continue.',
      objectiveComplete: true,
      completionBasis: 'response',
      completionEvidence: 'The explanation is present in the response.',
    },
    observation: {
      ...observation({ source: 'user', step: 3, maxSteps: 8, objective }),
      metadata: {
        ...observation({ source: 'user', step: 3, maxSteps: 8, objective }).metadata,
        taskValidatorCommand: {
          objective,
          instruction: objective,
          source: 'user',
          step: 3,
          maxSteps: 8,
          requireExternalCompletionEvidence: true,
        },
      },
    },
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, false);
  assert.equal(result.shouldQueue, false);
  assert.equal(result.nextInstruction, '');
  assert.equal(result.decision.stepComplete, false);
  assert.equal(result.decision.blockedReason, 'objective_completion_unverified');
});

test('semi permits an explicitly declared user-owned repeat while preserving the hard step bound', async () => {
  const objective = 'Maintain the requested activity subject to its termination criterion.';
  const repeated = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective remains incomplete.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      nextInstruction: 'Repeat the completed step once, then evaluate the new completion evidence.',
      continuationType: 'repeat',
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(repeated.shouldQueue, true);
  assert.equal(repeated.decision.blockedReason, '');

  const bounded = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective remains incomplete.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      nextInstruction: 'Repeat the completed step once, then evaluate the new completion evidence.',
      continuationType: 'repeat',
    },
    observation: observation({ source: 'user', step: 3, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(bounded.shouldQueue, false);
  assert.equal(bounded.decision.blockedReason, 'step_limit');
});

test('validator blocks unauthorized repeats, reactive continuations, and semi autonomous actions', async () => {
  const repeated = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Try again.',
      objectiveComplete: false,
      nextInstruction: 'Repeat the completed step.',
      continuationType: 'repeat',
    },
    observation: observation({ source: 'autonomy', terminalCommand: 'walk' }),
  }, { operatorMode: 'full' });
  assert.equal(repeated.shouldQueue, false);
  assert.equal(repeated.decision.blockedReason, 'repeat_not_authorized');

  const reactive = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Look elsewhere.',
      objectiveComplete: false,
      nextInstruction: 'Turn left to inspect a different part of the room.',
      continuationType: 'advance',
    },
    observation: observation({ source: 'user', terminalCommand: 'walk' }),
  }, { operatorMode: 'reactive' });
  assert.equal(reactive.shouldQueue, false);
  assert.equal(reactive.decision.blockedReason, 'mode_reactive_source_user');

  const autonomous = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'left' }],
    taskDecision: {
      outcome: 'act',
      reason: 'Something may be nearby.',
      objectiveComplete: false,
    },
    observation: observation({ source: 'autonomy' }),
  }, { operatorMode: 'semi' });
  assert.deepEqual(autonomous.actions, []);
  assert.equal(autonomous.decision.blockedReason, 'current_action_blocked_semi_autonomy');
});

test('full mode may queue an autonomous continuation but still honors the bounded cycle', async () => {
  const admitted = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'observe',
      reason: 'The object moved out of view.',
      objectiveComplete: false,
      nextInstruction: 'Turn right to inspect the adjacent area.',
      continuationType: 'advance',
    },
    observation: observation({ source: 'autonomy', step: 2, maxSteps: 3, terminalCommand: 'left' }),
  }, { operatorMode: 'full' });
  assert.equal(admitted.shouldQueue, true);
  assert.equal(admitted.workflowCommand.source, 'autonomy');

  const bounded = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'More work remains.',
      objectiveComplete: false,
      nextInstruction: 'Turn right to inspect the adjacent area.',
      continuationType: 'advance',
    },
    observation: observation({ source: 'autonomy', step: 3, maxSteps: 3, terminalCommand: 'left' }),
  }, { operatorMode: 'full' });
  assert.equal(bounded.shouldQueue, false);
  assert.equal(bounded.decision.blockedReason, 'step_limit');
});

test('Environment Workflow Command admits the validated instruction to the coordinator queue', async () => {
  const command: EnvironmentWorkflowCommand = {
    kind: 'environment_workflow_command',
    objective: 'Complete the objective subject to its stated criterion.',
    instruction: 'Turn left to inspect a different part of the room.',
    reason: 'The ball is not visible in the current view.',
    source: 'user',
    mode: 'semi',
    graph: 'environment',
    cycleId: 'cycle-1',
    step: 2,
    maxSteps: 3,
  };
  const queuedInputs: TaskInput[] = [];
  const result = await environmentWorkflowCommandNode.execute({
    command,
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk', visual: true }),
  }, {
    username: 'greggles',
    operatorMode: 'semi',
    environmentWorkflowNow: '2026-08-03T12:00:01.000Z',
    enqueueEnvironmentWorkflow: (input: TaskInput) => {
      queuedInputs.push(input);
      return { id: 'queued-task-1' };
    },
  }, { graph: 'environment' });

  assert.equal(result.queued, true);
  assert.equal(result.taskId, 'queued-task-1');
  assert.equal(queuedInputs.length, 1);
  const queued = queuedInputs[0]!;
  assert.equal(queued.type, 'environment_observation');
  assert.equal(queued.handler, 'environment.observation');
  assert.equal(queued.source, 'user');
  assert.match(String(queued.input.observation.metadata.originatingInstruction), /^Objective: Complete the objective subject to its stated criterion\./);
  assert.match(String(queued.input.observation.metadata.originatingInstruction), /step 3 of 3/);
  assert.deepEqual(queued.input.observation.feedback, []);
  assert.equal(queued.input.observation.metadata.robotObserver.step, 3);
});

test('an action-result continuation retains its cycle step until the next action is admitted', async () => {
  const queuedInputs: TaskInput[] = [];
  const result = await environmentWorkflowCommandNode.execute({
    command: {
      kind: 'environment_workflow_command',
      objective: 'Continue the objective until its criterion is satisfied.',
      instruction: 'Assign the next step to a different actor.',
      reason: 'The objective remains incomplete.',
      source: 'user',
      mode: 'semi',
      graph: 'environment',
      cycleId: 'cycle-1',
      step: 2,
      maxSteps: 3,
      advanceCycle: false,
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk', visual: true }),
  }, {
    username: 'greggles',
    operatorMode: 'semi',
    environmentWorkflowNow: '2026-08-03T12:00:01.000Z',
    enqueueEnvironmentWorkflow: (input: TaskInput) => {
      queuedInputs.push(input);
      return { id: 'queued-task-action-continuation' };
    },
  });

  assert.equal(result.queued, true);
  assert.equal(queuedInputs[0]!.input.observation.metadata.robotObserver.step, 2);
  assert.equal(result.result.step, 2);
  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: queuedInputs[0]!.input.observation,
  }, { userMessage: '' });
  assert.equal(interpreted.instruction, 'Continue the objective until its criterion is satisfied.');
});

test('a queued Semi instruction can execute once and a completed objective stops the chain', async () => {
  const validatorResult = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective criterion.',
      objectiveComplete: false,
      nextInstruction: 'Turn left to inspect a different part of the room.',
      continuationType: 'advance',
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk' }),
  }, { operatorMode: 'semi' });
  const queuedInputs: TaskInput[] = [];
  await environmentWorkflowCommandNode.execute({
    command: validatorResult.workflowCommand,
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk' }),
  }, {
    username: 'greggles',
    operatorMode: 'semi',
    environmentWorkflowNow: '2026-08-03T12:00:01.000Z',
    enqueueEnvironmentWorkflow: (input: TaskInput) => {
      queuedInputs.push(input);
      return { id: 'queued-task-2' };
    },
  });
  const queuedObservation = queuedInputs[0]!.input.observation as EnvironmentObservation;
  const parsedStep = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will inspect the left side.',
      actions: [{ type: 'robotCommand', command: 'left' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'This is the queued objective-bound step.',
        objectiveComplete: false,
      },
    }),
    instruction: queuedObservation.metadata?.originatingInstruction,
    observation: queuedObservation,
    sessionId: queuedObservation.sessionId,
    routingAnalysis: { needsAction: true, actionType: 'robot_movement' },
  }, { operatorMode: 'semi', cognitiveMode: 'environment' });
  assert.equal(parsedStep.actions[0].command, 'left');

  const completedObservation: EnvironmentObservation = {
    ...queuedObservation,
    feedback: [{
      id: 'feedback-2',
      timestamp: '2026-08-03T12:00:02.000Z',
      type: 'completed',
      message: 'done',
      actionId: 'action-2',
      data: { command: 'left' },
    }],
    metadata: {
      originatingInstruction: queuedObservation.metadata?.originatingInstruction,
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 3,
        maxSteps: 3,
        triggerSource: 'user',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
    visual: {
      id: 'visual-2',
      timestamp: '2026-08-03T12:00:02.000Z',
      mimeType: 'image/jpeg',
      dataUrl: TEST_JPEG,
      source: 'robot-camera',
      metadata: { correlationId: 'cycle-1', actionId: 'action-2' },
    },
  };
  const completed = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'Current evidence satisfies the objective criterion.',
      objectiveComplete: true,
      completionBasis: 'visual_observation',
      completionEvidence: 'The fresh correlated visual contains the required evidence.',
    },
    observation: completedObservation,
  }, { operatorMode: 'semi' });
  assert.equal(completed.complete, true);
  assert.equal(completed.shouldQueue, false);
  assert.equal(completed.decision.objective, 'Complete the objective subject to its stated criterion.');
});

test('Environment Workflow Command rechecks mode before queue admission', async () => {
  let enqueueCalls = 0;
  const result = await environmentWorkflowCommandNode.execute({
    command: {
      kind: 'environment_workflow_command',
      objective: 'Complete the objective subject to its stated criterion.',
      instruction: 'Turn left.',
      reason: 'The current view is incomplete.',
      source: 'user',
      mode: 'semi',
      graph: 'environment',
      cycleId: 'cycle-1',
      step: 2,
      maxSteps: 3,
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3 }),
  }, {
    username: 'greggles',
    operatorMode: 'reactive',
    enqueueEnvironmentWorkflow: () => {
      enqueueCalls += 1;
      return { id: 'must-not-queue' };
    },
  });

  assert.equal(result.queued, false);
  assert.equal(result.status, 'mode_reactive_source_user');
  assert.equal(enqueueCalls, 0);
});
