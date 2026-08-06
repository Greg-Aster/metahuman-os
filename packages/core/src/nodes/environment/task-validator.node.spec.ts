import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import type { EnvironmentObservation } from '../../environment-interface/index.js';
import type { TaskInput } from '../../queue/index.js';
import { environmentActionParserNode } from './action-parser.node.js';
import { environmentContextBuilderNode } from './context-builder.node.js';
import { environmentInstructionInterpreterNode } from './instruction-interpreter.node.js';
import { environmentTaskContractNode } from './task-contract.node.js';
import { environmentTaskRefinerNode } from './task-refiner.node.js';
import { environmentTaskValidatorNode } from './task-validator.node.js';
import {
  environmentVisualEvidenceAssessorNode,
  type EnvironmentVisualEvidenceAssessment,
} from './visual-evidence-assessor.node.js';
import {
  environmentWorkflowCommandNode,
  type EnvironmentWorkflowCommand,
} from './workflow-command.node.js';

const TEST_JPEG = 'data:image/jpeg;base64,/9j/2gAA/9k=';

const environmentGraph = JSON.parse(fs.readFileSync(
  new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url),
  'utf8',
)) as {
  nodes: Array<{
    id: string;
    data: { nodeType: string; properties?: Record<string, unknown> };
  }>;
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

function supportedVisualAssessment(frameId = 'visual-1'): EnvironmentVisualEvidenceAssessment {
  return {
    assessed: true,
    valid: true,
    verdict: 'supported',
    frameId,
    frameTimestamp: '2026-08-03T12:00:00.000Z',
    reason: 'The required condition is clearly present in the exact correlated frame.',
    response: '',
    error: '',
  };
}

test('action parser keeps completion state but leaves refinement prompting to the later graph stage', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The ball is not visible yet.',
      actions: [{ type: 'robotCommand', command: 'left' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'continue',
        reason: 'A different view is needed.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
      },
    }),
    instruction: 'Complete the objective subject to its stated criterion.',
    observation: observation({ terminalCommand: 'walk' }),
    sessionId: 'robot-1',
  }, {});

  assert.deepEqual(parsed.actions, []);
  assert.equal(parsed.taskDecision.outcome, 'continue');
  assert.equal('nextInstruction' in parsed.taskDecision, false);
  assert.equal('continuationType' in parsed.taskDecision, false);
  assert.equal(parsed.taskDecision.continuationPolicy, 'bounded');
});

test('completion feedback keeps the original objective authoritative without directly reissuing an action', async () => {
  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: observation({
      objective: 'Maintain the requested activity subject to its termination criterion.',
      terminalCommand: 'walk',
      visual: true,
    }),
  }, {});

  assert.match(interpreted.instruction, /Robot action completed: done/i);
  assert.match(interpreted.instruction, /still authoritative for completion validation/i);
  assert.doesNotMatch(interpreted.instruction, /nextInstruction/i);
  assert.doesNotMatch(interpreted.instruction, /context only/i);
});

test('validator preserves graph-authored actions without reapplying Active Operator source policy', async () => {
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
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'body_local' },
    },
  };
  const parsed = await environmentActionParserNode.execute(inputs, { operatorMode: 'semi' });
  assert.equal(parsed.actions.length, 1);

  const semi = await environmentTaskValidatorNode.execute({
    ...parsed,
    instruction: inputs.instruction,
    observation: inputs.observation,
  }, { operatorMode: 'semi' });
  assert.equal(semi.actions.length, 1);
  assert.equal(semi.actions[0].command, 'left');
  assert.equal(semi.decision.blockedReason, '');

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
  assert.equal(contradictory.shouldRefine, false);
});

test('Environment Mode routes current work through the validator before bridge admission', () => {
  const validator = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_task_validator');
  const command = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_workflow_command');
  const parser = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_action_parser');
  const taskContract = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_task_contract');
  const bridge = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_send_action');
  const evidenceAssessor = environmentGraph.nodes.find(
    node => node.data.nodeType === 'environment_visual_evidence_assessor',
  );
  const refiner = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_task_refiner');
  const conversationBuffers = environmentGraph.nodes.filter(
    node => node.data.nodeType === 'conversation_buffer',
  );
  const refinementBuffer = conversationBuffers[0];
  assert(validator);
  assert(command);
  assert(parser);
  assert(taskContract);
  assert(bridge);
  assert(evidenceAssessor);
  assert(refiner);
  assert(refinementBuffer);
  assert.equal(conversationBuffers.length, 1);
  const bridgeAllowedActions = bridge.data.properties?.allowedActions;
  assert(Array.isArray(bridgeAllowedActions));
  assert.equal(bridgeAllowedActions.includes('inspect'), true);
  assert.equal(bridgeAllowedActions.includes('visualApproach'), true);
  assert.equal(graphEdge(parser.id, 'taskDecision', taskContract.id, 'taskDecision'), true);
  assert.equal(graphEdge(taskContract.id, 'taskDecision', validator.id, 'taskDecision'), true);
  assert.equal(graphEdge(parser.id, 'actionAdmission', validator.id, 'actionAdmission'), true);
  assert.equal(graphEdge('context-router', 'analysis', validator.id, 'routingAnalysis'), true);
  assert.equal(graphEdge(validator.id, 'refinementRequest', refiner.id, 'request'), true);
  assert.equal(graphEdge(validator.id, 'workflowCommand', command.id, 'command'), false);
  assert.equal(graphEdge(refiner.id, 'conversationEntry', refinementBuffer.id, 'entry'), true);
  assert.equal(graphEdge(refiner.id, 'workflowCommand', refinementBuffer.id, 'passthrough'), true);
  assert.equal(graphEdge(refinementBuffer.id, 'passthrough', command.id, 'command'), true);
  assert.equal(graphEdge(validator.id, 'taskInstruction', bridge.id, 'taskInstruction'), true);
  assert.equal(graphEdge(parser.id, 'actions', bridge.id, 'actions'), false);
  assert.equal(graphEdge(validator.id, 'actions', bridge.id, 'actions'), true);
  assert.equal(graphEdge(validator.id, 'response', bridge.id, 'response'), true);
  assert.equal(graphEdge(parser.id, 'movementRequest', 'movement-generator', 'movementRequest'), true);
  assert.equal(graphEdge('movement-generator', 'actions', validator.id, 'generatedActions'), true);
  assert.equal(graphEdge('movement-generator', 'response', validator.id, 'generatedResponse'), true);
  assert.equal(graphEdge('movement-generator', 'controlResult', validator.id, 'motionControlResult'), true);
  assert.equal(graphEdge('movement-generator', 'actions', bridge.id, 'generatedActions'), false);
  assert.equal(graphEdge(taskContract.id, 'taskDecision', evidenceAssessor.id, 'taskDecision'), true);
  assert.equal(graphEdge('10', 'observation', evidenceAssessor.id, 'observation'), true);
  assert.equal(graphEdge('11', 'images', evidenceAssessor.id, 'images'), true);
  assert.equal(graphEdge('11', 'frames', evidenceAssessor.id, 'frames'), true);
  assert.equal(graphEdge(evidenceAssessor.id, 'assessment', validator.id, 'evidenceAssessment'), true);

  const contextRouter = environmentGraph.nodes.find(node => node.id === 'context-router');
  const contextBuilder = environmentGraph.nodes.find(node => node.data.nodeType === 'environment_context_builder');
  const contextRouterPrompt = [
    contextRouter?.data.properties?.systemPrompt,
    contextRouter?.data.properties?.userPromptTemplate,
  ].join('\n');
  assert.match(contextRouterPrompt, /future-tense commitment as outstanding work/i);
  assert.match(contextRouterPrompt, /evidence that could actually prove the objective/i);
  assert.match(contextRouterPrompt, /action_result proves only that the admitted command ran/i);
  assert.match(String(contextBuilder?.data.properties?.systemPrompt), /outstanding, unexecuted objective/i);
  assert.match(String(contextBuilder?.data.properties?.systemPrompt), /Do not copy the Task instruction verbatim/i);
  assert.match(String(contextBuilder?.data.properties?.systemPrompt), /Before correlated terminal feedback/i);
  assert.match(String(contextBuilder?.data.properties?.systemPrompt), /robotMotionPlan proves only that a bounded joint trajectory can execute/i);
  assert.doesNotMatch(String(contextBuilder?.data.properties?.systemPrompt), /AINEKIO NAMED|turn_left_45|"command":"walk"/i);
  assert.match(String(contextBuilder?.data.properties?.systemPrompt), /Task Refiner LLM writes the next prompt/i);
  assert.match(String(evidenceAssessor.data.properties?.systemPrompt), /after a completed action step or an explicit completion claim/i);
  assert.match(String(evidenceAssessor.data.properties?.systemPrompt), /Preserve the original actors, ownership, sensor, and stopping condition/i);
  assert.match(String(refiner.data.properties?.systemPrompt), /existing Environment Task Validator/i);
  assert.match(String(refiner.data.properties?.systemPrompt), /existing Conversation Buffer/i);
  assert.match(String(refiner.data.properties?.systemPrompt), /actor roles, ownership, sensor, stopping condition/i);
});

test('an initial router guess cannot become the Environment completion contract', async () => {
  const instruction = 'Report the current value already present in environment state.';
  const result = await environmentContextBuilderNode.execute({
    instruction,
    observation: {
      ...observation({ source: 'user', objective: instruction }),
      state: { currentValue: 12.4 },
    },
    routingAnalysis: {
      needsAction: true,
      actionType: 'environment_action',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
  }, {}, { systemPrompt: '', recentHistoryLimit: 4 });

  const systemMessage = result.messages[0]?.content;
  assert.equal(typeof systemMessage, 'string');
  assert.doesNotMatch(String(systemMessage), /Task completion contract/i);
  assert.doesNotMatch(String(systemMessage), /Required evidence basis.*visual_observation/i);
});

test('Environment context admits execution contracts from the Robot Operator typed decision owner', async () => {
  const instruction = 'I want Environment Mode to carry out this physical intention.';
  const delegatedObservation = observation({
    source: 'autonomy',
    step: 1,
    maxSteps: 8,
    objective: instruction,
  });
  delegatedObservation.metadata = {
    ...delegatedObservation.metadata,
    robotOperatorDecision: {
      observed: 'The current stimulus supports a physical intention.',
      instruction,
      requiresAction: true,
      reason: 'The chosen intention requires an environmental change.',
    },
  };

  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: delegatedObservation,
  }, {});
  assert.match(interpreted.routingRequest, /"delegatedActionRequirement":true/);

  const context = await environmentContextBuilderNode.execute({
    instruction,
    observation: interpreted.observation,
    routingAnalysis: {
      needsAction: false,
      needsEnvironment: false,
      needsVision: false,
      actionType: 'none',
    },
  }, {}, { systemPrompt: 'EXECUTION GROUNDING CONTRACT', recentHistoryLimit: 4 });

  assert.equal(context.context.contextAdmission.actionContracts, true);
  assert.match(context.message, /Response contract:/);
  assert.match(context.message, /Available actions:/);
});

test('validator replaces a false action promise when required work has no admitted action', async () => {
  const result = await environmentTaskValidatorNode.execute({
    response: 'I am moving closer to the shelving unit now.',
    taskDecision: {
      outcome: 'act',
      reason: 'A closer view would help inspect the shelving unit.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    instruction: 'I want to move closer to the shelving unit to inspect it.',
    observation: observation({
      source: 'user',
      step: 1,
      maxSteps: 8,
      objective: 'I want to move closer to the shelving unit to inspect it.',
    }),
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
    },
  }, { operatorMode: 'semi' });

  assert.deepEqual(result.actions, []);
  assert.equal(result.movementRequest, null);
  assert.equal(result.response, 'I understood this as an action, but no executable robot command was produced.');
  assert.equal(result.shouldRefine, false);
  assert.equal(result.decision.actionRequired, true);
  assert.equal(result.decision.responseSuppressed, false);
  assert.equal(result.decision.blockedReason, 'required_action_missing');
});

test('validator returns an explicit diagnostic when a user action produces no command or response', async () => {
  const result = await environmentTaskValidatorNode.execute({
    response: '',
    taskDecision: {
      outcome: 'act',
      reason: 'The request requires a robot action.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    instruction: 'Turn right 90 degrees.',
    observation: observation({
      source: 'user',
      step: 1,
      maxSteps: 8,
      objective: 'Turn right 90 degrees.',
    }),
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
    },
  }, { operatorMode: 'semi' });

  assert.deepEqual(result.actions, []);
  assert.equal(
    result.response,
    'I understood this as an action, but no executable robot command was produced.',
  );
  assert.equal(result.decision.responseSuppressed, false);
  assert.equal(result.decision.blockedReason, 'required_action_missing');
});

test('an advisory action route cannot replace a missing Environment LLM action decision', async () => {
  const result = await environmentTaskValidatorNode.execute({
    response: 'I will perform a motion now.',
    actions: [],
    movementRequest: null,
    instruction: 'Please do a motion of any kind.',
    observation: observation({
      source: 'user',
      step: 1,
      maxSteps: 8,
      objective: 'Please do a motion of any kind.',
    }),
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'body_local' },
    },
  }, { operatorMode: 'semi' });

  assert.deepEqual(result.actions, []);
  assert.equal(result.response, 'I will perform a motion now.');
  assert.equal(result.decision.actionRequired, false);
  assert.equal(result.decision.blockedReason, '');
});

test('an advisory no-action route cannot veto an Environment LLM-selected advertised command', async () => {
  const instruction = 'I want Environment Mode to carry out this physical intention.';
  const delegatedObservation = observation({
    source: 'autonomy',
    step: 1,
    maxSteps: 8,
    objective: instruction,
  });
  delegatedObservation.metadata = {
    ...delegatedObservation.metadata,
    robotOperatorDecision: {
      observed: 'The current stimulus supports a physical intention.',
      instruction,
      requiresAction: true,
      reason: 'The chosen intention requires an environmental change.',
    },
  };

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I am moving closer now.',
      actions: [{ type: 'robotCommand', command: 'walk', units: 1 }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'The delegated physical intention requires one supported step.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
      },
    }),
    instruction,
    observation: delegatedObservation,
    sessionId: delegatedObservation.sessionId,
    routingAnalysis: {
      needsAction: false,
      actionType: 'none',
    },
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.command, 'walk');
  assert.equal(parsed.actionAdmission.admitted, true);
  assert.equal(parsed.actionAdmission.reason, '');

  const validated = await environmentTaskValidatorNode.execute({
    ...parsed,
    instruction,
    observation: delegatedObservation,
    routingAnalysis: {
      needsAction: false,
      actionType: 'none',
    },
  }, { operatorMode: 'semi' });

  assert.equal(validated.actions.length, 1);
  assert.equal(validated.decision.actionRequired, true);
  assert.equal(validated.decision.admittedActionCount, 1);
  assert.equal(validated.decision.blockedReason, '');
  assert.equal(validated.outcome, 'act');
  assert.equal(validated.response, 'I am moving closer now.');
});

test('target-relative objective dispatches the LLM-selected advertised command and preserves its visual completion contract', async () => {
  const instruction = 'Move closer to the current scene target for a better view.';
  const delegatedObservation = observation({
    source: 'autonomy',
    step: 1,
    maxSteps: 4,
    objective: instruction,
  });
  delegatedObservation.capabilities.actions.push('robotMotionPlan');
  delegatedObservation.capabilities.motionClasses = ['body_local', 'open_loop_displacement'];
  delegatedObservation.capabilities.navigation = false;
  delegatedObservation.metadata = {
    ...delegatedObservation.metadata,
    robotOperatorDecision: {
      observed: 'A scene target is present in the current image.',
      instruction,
      requiresAction: true,
      reason: 'A closer view could provide additional evidence.',
    },
  };
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      motionClass: 'target_relative',
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will move closer for a better view.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: { description: 'walk toward the current scene target' },
      taskDecision: {
        outcome: 'act',
        reason: 'The objective requires a closer viewpoint.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        motionClass: 'target_relative',
      },
    }),
    instruction,
    observation: delegatedObservation,
    sessionId: delegatedObservation.sessionId,
    routingAnalysis,
  }, {});
  const contracted = await environmentTaskContractNode.execute({
    taskDecision: parsed.taskDecision,
    routingAnalysis,
    observation: delegatedObservation,
  }, {});
  assert.equal(contracted.taskDecision.continuationPolicy, 'bounded');
  assert.equal(contracted.taskDecision.requiredCompletionBasis, 'visual_observation');
  const validated = await environmentTaskValidatorNode.execute({
    ...parsed,
    taskDecision: contracted.taskDecision,
    instruction,
    observation: delegatedObservation,
    routingAnalysis,
  }, { operatorMode: 'full' });

  assert.equal(validated.actions.length, 1);
  assert.equal(validated.actions[0]?.type, 'robotCommand');
  assert.equal(validated.actions[0]?.command, 'walk');
  assert.equal(validated.movementRequest, null);
  assert.equal(validated.outcome, 'act');
  assert.equal(validated.shouldRefine, false);
  assert.equal(validated.refinementRequest, null);
  assert.equal(validated.decision.continuationPolicy, 'bounded');
  assert.equal(validated.decision.requiredCompletionBasis, 'visual_observation');
  assert.equal(validated.decision.motionClass, 'target_relative');
  assert.equal(validated.decision.blockedReason, '');
  assert.equal(validated.response, 'I will move closer for a better view.');
});

test('a duplicate generated motion plan becomes a terminal stuck lifecycle result', async () => {
  const motionControl = {
    version: 1 as const,
    cycleId: 'cycle-1',
    planIds: ['plan-a', 'plan-a'],
    lastPlanId: 'plan-a',
    consecutiveIdentical: 2,
  };
  const result = await environmentTaskValidatorNode.execute({
    actions: [],
    generatedActions: [],
    movementRequest: { description: 'body-local motion', motionClass: 'body_local' },
    generatedResponse: 'Motion stopped because the generated plan repeats the previous physical attempt without new progress evidence.',
    motionControlResult: {
      status: 'stuck',
      reason: 'duplicate_motion_plan',
      planId: 'plan-a',
      state: motionControl,
    },
    taskDecision: {
      outcome: 'act',
      reason: 'Attempt the body-local motion.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
    },
    instruction: 'Attempt one body-local motion.',
    observation: observation({ source: 'autonomy', step: 2, maxSteps: 4 }),
  }, { operatorMode: 'full' });

  assert.equal(result.actions.length, 0);
  assert.equal(result.outcome, 'request_user');
  assert.equal(result.shouldRefine, false);
  assert.equal(result.refinementRequest, null);
  assert.equal(result.decision.blockedReason, 'duplicate_motion_plan');
  assert.deepEqual(result.decision.motionControl, motionControl);
  assert.match(result.response, /repeats the previous physical attempt/i);
});

test('adapter-owned visual no-progress is terminal and cannot reopen locomotion refinement', async () => {
  const current = observation({ source: 'autonomy', step: 2, maxSteps: 4, terminalCommand: 'visualApproach' });
  current.feedback = [{
    id: 'visual-approach-stuck',
    timestamp: current.timestamp,
    type: 'failed',
    message: 'The target remained visible but did not make measurable progress.',
    actionId: 'visual-approach-1',
    data: {
      activeViewProgress: {
        version: 1,
        skill: 'visualApproach',
        targetId: 'target-1',
        frameId: 'frame-3',
        timestamp: current.timestamp,
        status: 'stuck',
        step: 3,
        confidence: 0.79,
        progress: 0.25,
        box: { x: 0.35, y: 0.2, width: 0.23, height: 0.3 },
        pathConfidence: 0.76,
        obstruction: 0.04,
        reason: 'no_progress_limit',
      },
    },
  }];
  const result = await environmentTaskValidatorNode.execute({
    actions: [],
    movementRequest: null,
    response: '',
    taskDecision: {
      outcome: 'continue',
      reason: 'The target has not been reached.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    observation: current,
  }, { operatorMode: 'full' });

  assert.equal(result.outcome, 'request_user');
  assert.equal(result.shouldRefine, false);
  assert.equal(result.refinementRequest, null);
  assert.equal(result.decision.blockedReason, 'active_view_stuck');
  assert.equal(result.decision.activeViewProgress.status, 'stuck');
  assert.match(result.response, /did not make measurable progress/i);
});

test('an earlier Robot Operator response preference cannot veto the Environment LLM current action', async () => {
  const instruction = 'I want to respond conversationally to the current stimulus.';
  const delegatedObservation = observation({
    source: 'autonomy',
    step: 1,
    maxSteps: 8,
    objective: instruction,
  });
  delegatedObservation.metadata = {
    ...delegatedObservation.metadata,
    robotOperatorDecision: {
      observed: 'The current stimulus supports a conversational response.',
      instruction,
      requiresAction: false,
      reason: 'The chosen intention requires only a response.',
    },
  };

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I have a conversational response to the current stimulus.',
      actions: [{ type: 'robotCommand', command: 'walk', units: 1 }],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'The response is supplied.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        completionBasis: 'response',
        completionEvidence: 'The requested response is present.',
      },
    }),
    instruction,
    observation: delegatedObservation,
    sessionId: delegatedObservation.sessionId,
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
    },
  }, {});

  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0]?.command, 'walk');
  assert.equal(parsed.response, 'I have a conversational response to the current stimulus.');
});

test('a response-only state answer is not suppressed by an advisory routing false positive', async () => {
  const instruction = 'Report the current value already present in environment state.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'The current value is 12.4 units.',
    taskDecision: {
      outcome: 'complete',
      reason: 'The current environment state contains the requested value.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'response',
      completionBasis: 'response',
      completionEvidence: 'The requested value is present in the response.',
    },
    instruction,
    observation: observation({
      source: 'user',
      step: 1,
      maxSteps: 8,
      objective: instruction,
    }),
    routingAnalysis: {
      needsAction: true,
      actionType: 'environment_action',
      actionParams: {
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
      },
    },
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, true);
  assert.equal(result.response, 'The current value is 12.4 units.');
  assert.equal(result.decision.actionRequired, false);
  assert.equal(result.decision.requiredCompletionBasis, 'response');
  assert.equal(result.decision.responseSuppressed, false);
  assert.equal(result.decision.blockedReason, '');
});

test('validator reports an unsupported completion claim instead of failing silently', async () => {
  const result = await environmentTaskValidatorNode.execute({
    response: 'I have moved closer to the shelving unit.',
    taskDecision: {
      outcome: 'complete',
      reason: 'The movement is complete.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      completionBasis: 'action_result',
      completionEvidence: 'I moved closer.',
    },
    instruction: 'I want to move closer to the shelving unit.',
    observation: observation({
      source: 'user',
      step: 1,
      maxSteps: 8,
      objective: 'I want to move closer to the shelving unit.',
    }),
    routingAnalysis: {
      needsAction: false,
      actionType: 'none',
    },
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, false);
  assert.equal(result.response, 'I have moved closer to the shelving unit.');
  assert.equal(result.decision.responseSuppressed, false);
  assert.equal(result.decision.blockedReason, 'objective_completion_unverified');
});

test('validator keeps an admitted Robot Operator response visible for observability', async () => {
  const instruction = 'I want to move closer to inspect the shelving unit.';
  const delegatedObservation = observation({
    source: 'user',
    step: 1,
    maxSteps: 8,
    objective: instruction,
  });
  delegatedObservation.metadata = {
    ...delegatedObservation.metadata,
    robotOperatorDecision: {
      observed: 'The current stimulus supports the selected intention.',
      instruction,
      requiresAction: true,
      reason: 'A closer view would provide useful information.',
    },
  };

  const result = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', units: 1 }],
    response: instruction,
    taskDecision: {
      outcome: 'act',
      reason: 'Move one bounded step closer.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
    },
    instruction,
    observation: delegatedObservation,
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
    },
  }, { operatorMode: 'semi' });

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].command, 'walk');
  assert.equal(result.response, instruction);
  assert.equal(result.decision.operatorIntentionEcho, true);
  assert.equal(result.decision.responseSuppressed, false);
  assert.equal(result.decision.blockedReason, 'operator_intention_echo');
});

test('visual evidence assessor independently binds a rejection to the exact correlated frame', async () => {
  const currentObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 8,
    terminalCommand: 'walk',
    objective: 'Continue the activity until its visual completion condition is satisfied.',
    visual: true,
  });
  const earlierCycleFrame = {
    ...currentObservation.visual!,
    id: 'visual-earlier-step',
    timestamp: '2026-08-03T11:59:59.000Z',
    metadata: {
      correlationId: 'cycle-1',
      actionId: 'action-earlier',
    },
  };
  currentObservation.visuals = [earlierCycleFrame, currentObservation.visual!];
  let calls = 0;
  const result = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision: {
      outcome: 'complete',
      reason: 'The visual condition is satisfied.',
      objectiveComplete: true,
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'visual_observation',
      completionEvidence: 'The required condition is visible.',
    },
    instruction: 'Continue the activity until its visual completion condition is satisfied.',
    observation: currentObservation,
    images: [
      { type: 'image_url', image_url: { url: TEST_JPEG } },
      { type: 'image_url', image_url: { url: TEST_JPEG } },
    ],
    frames: [earlierCycleFrame, currentObservation.visual],
  }, {
    username: 'Ainekio',
    cognitiveMode: 'environment',
    evaluateEnvironmentVisualEvidence: async ({ frame }: { frame: { id: string } }) => {
      calls += 1;
      assert.equal(frame.id, 'visual-1');
      return {
        verdict: 'unsupported',
        reason: 'The required condition is absent from the frame.',
      };
    },
  }, {
    role: 'orchestrator',
    systemPrompt: 'Independently assess the exact correlated visual evidence.',
    maxTokens: 512,
    temperature: 0,
  });

  assert.equal(calls, 1);
  assert.equal(result.assessment.verdict, 'unsupported');
  assert.equal(result.assessment.frameId, 'visual-1');
  assert.equal('continuationType' in result.assessment, false);
  assert.equal('nextInstruction' in result.assessment, false);
});

test('visual evidence assessor skips when there is neither a claim nor a completed visual-bounded step', async () => {
  let calls = 0;
  const result = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'The objective remains incomplete.',
      objectiveComplete: false,
      completionBasis: 'none',
    },
    observation: observation({ visual: true }),
  }, {
    evaluateEnvironmentVisualEvidence: async () => {
      calls += 1;
      return {};
    },
  }, {
    systemPrompt: 'Assess visual evidence.',
  });

  assert.equal(calls, 0);
  assert.equal(result.assessment.verdict, 'not_required');
});

test('the required visual basis invokes assessment even when the completion claim mislabeled its basis', async () => {
  const currentObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 4,
    terminalCommand: 'walk',
    objective: 'Complete the objective when its distinct visual condition is present.',
    visual: true,
  });
  let calls = 0;
  const taskDecision = {
    outcome: 'complete' as const,
    reason: 'The objective is complete.',
    objectiveComplete: true,
    continuationPolicy: 'bounded' as const,
    requiredCompletionBasis: 'visual_observation' as const,
    completionBasis: 'action_result' as const,
    completionEvidence: 'The physical action completed.',
  };
  const assessed = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision,
    instruction: 'Complete the objective when its distinct visual condition is present.',
    observation: currentObservation,
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [currentObservation.visual],
  }, {
    evaluateEnvironmentVisualEvidence: async () => {
      calls += 1;
      return {
        verdict: 'supported',
        reason: 'The distinct completion condition is present in the exact correlated frame.',
      };
    },
  }, {
    systemPrompt: 'Independently assess the exact correlated visual evidence.',
  });
  const validated = await environmentTaskValidatorNode.execute({
    response: 'The objective is complete.',
    taskDecision,
    evidenceAssessment: assessed.assessment,
    instruction: 'Complete the objective when its distinct visual condition is present.',
    observation: currentObservation,
  }, { operatorMode: 'semi' });

  assert.equal(calls, 1);
  assert.equal(assessed.assessment.verdict, 'supported');
  assert.equal(validated.complete, true);
  assert.equal(validated.shouldRefine, false);
  assert.equal(validated.decision.completionBasis, 'visual_observation');
  assert.equal(validated.decision.completionEvidence, assessed.assessment.reason);
});

test('a completed bounded step closes from the Environment LLM-selected exact visual evidence', async () => {
  const objective = 'Perform the requested motion until the robot sees the user-owned stopping signal, then stop.';
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
  };
  const contracted = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'act',
      reason: 'Start the current physical step.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    routingAnalysis,
  }, {});
  assert.equal(contracted.taskDecision.taskContractSource, 'environment_decision');
  assert.equal(contracted.taskDecision.requiredCompletionBasis, 'visual_observation');

  const initial = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk' }],
    taskDecision: contracted.taskDecision,
    instruction: objective,
    observation: observation({ source: 'user', step: 1, maxSteps: 8, objective }),
    routingAnalysis,
  }, { operatorMode: 'semi' });

  const completedObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 8,
    terminalCommand: 'walk',
    objective,
    visual: true,
  });
  completedObservation.metadata = {
    ...completedObservation.metadata,
    originatingInstruction: initial.taskInstruction,
  };
  const completedContract = await environmentTaskContractNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'The physical step completed, but the stopping condition was not recognized.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      completionBasis: 'action_result',
      completionEvidence: 'done',
    },
    routingAnalysis,
    observation: completedObservation,
  }, {});
  const assessed = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision: completedContract.taskDecision,
    instruction: objective,
    observation: completedObservation,
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [completedObservation.visual],
    routingAnalysis,
  }, {
    evaluateEnvironmentVisualEvidence: async () => ({
      verdict: 'supported',
      reason: 'The user-owned stopping signal is clearly visible in the exact correlated frame.',
      response: 'I can see your stopping signal, so the task is complete.',
    }),
  }, {
    systemPrompt: 'Assess the original visual stopping condition in the exact correlated frame.',
  });
  const validated = await environmentTaskValidatorNode.execute({
    response: 'The stopping condition was not visible, so another attempt is needed.',
    taskDecision: completedContract.taskDecision,
    evidenceAssessment: assessed.assessment,
    instruction: objective,
    observation: completedObservation,
    routingAnalysis,
  }, { operatorMode: 'semi' });

  assert.equal(assessed.assessed, true);
  assert.equal(assessed.assessment.verdict, 'supported');
  assert.equal(validated.complete, true);
  assert.equal(validated.outcome, 'complete');
  assert.equal(validated.shouldRefine, false);
  assert.equal(validated.refinementRequest, null);
  assert.equal(validated.response, 'I can see your stopping signal, so the task is complete.');
  assert.equal(validated.decision.completionBasis, 'visual_observation');
  assert.equal(validated.decision.taskContractSource, 'persisted');
  assert.equal(validated.decision.blockedReason, '');
});

test('an unsupported exact frame after a bounded completed step continues through refinement', async () => {
  const objective = 'Continue the requested activity until its visual stopping condition is present.';
  const currentObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 4,
    terminalCommand: 'walk',
    objective,
    visual: true,
  });
  const taskDecision = {
    outcome: 'continue' as const,
    reason: 'The objective remains incomplete.',
    objectiveComplete: false,
    continuationPolicy: 'bounded' as const,
    requiredCompletionBasis: 'visual_observation' as const,
  };
  const assessed = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision,
    instruction: objective,
    observation: currentObservation,
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [currentObservation.visual],
  }, {
    evaluateEnvironmentVisualEvidence: async () => ({
      verdict: 'unsupported',
      reason: 'The stopping condition is absent from the exact correlated frame.',
      response: 'The stopping condition is not visible yet.',
    }),
  }, { systemPrompt: 'Assess the exact correlated visual evidence.' });
  const validated = await environmentTaskValidatorNode.execute({
    taskDecision,
    evidenceAssessment: assessed.assessment,
    instruction: objective,
    observation: currentObservation,
  }, { operatorMode: 'semi' });

  assert.equal(assessed.assessed, true);
  assert.equal(validated.complete, false);
  assert.equal(validated.shouldRefine, true);
  assert.equal(validated.decision.blockedReason, 'visual_completion_unverified');
  assert.equal(validated.refinementRequest.result.visualEvidence.verdict, 'unsupported');
});

test('a premature action-result claim cannot suppress an authorized one-shot command', async () => {
  const currentObservation = observation({ source: 'user', step: 1, maxSteps: 8, objective: 'Please rest.' });
  const routingAnalysis = {
    needsAction: true,
    actionType: 'robot_movement',
    actionParams: {
      continuationPolicy: 'bounded' as const,
      requiredCompletionBasis: 'visual_observation' as const,
      motionClass: 'body_local' as const,
    },
  };
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will rest now.',
      actions: [{ type: 'robotCommand', command: 'rest' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'complete',
        reason: 'The rest command has been executed.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        completionBasis: 'action_result',
        completionEvidence: 'The rest command has been executed.',
        motionClass: 'body_local',
      },
    }),
    instruction: 'Please rest.',
    observation: currentObservation,
    sessionId: currentObservation.sessionId,
    routingAnalysis,
  }, {});
  assert.equal(parsed.actions.length, 1);
  assert.equal(parsed.actions[0].command, 'rest');
  assert.equal(parsed.taskDecision.objectiveComplete, false);
  assert.equal(parsed.taskDecision.continuationPolicy, 'none');
  assert.equal(parsed.taskDecision.requiredCompletionBasis, 'action_result');

  const contracted = await environmentTaskContractNode.execute({
    taskDecision: parsed.taskDecision,
    routingAnalysis,
    observation: currentObservation,
  }, {});
  assert.equal(contracted.taskDecision.requiredCompletionBasis, 'action_result');
  assert.equal(contracted.taskDecision.motionClass, 'body_local');

  const validated = await environmentTaskValidatorNode.execute({
    ...parsed,
    taskDecision: contracted.taskDecision,
    instruction: 'Please rest.',
    observation: currentObservation,
  }, { operatorMode: 'semi' });
  assert.equal(validated.actions.length, 1);
  assert.equal(validated.actions[0].command, 'rest');
  assert.equal(validated.complete, false);
  assert.equal(validated.outcome, 'act');
  assert.equal(validated.shouldRefine, false);
  assert.equal(validated.decision.stepComplete, false);
  assert.equal(validated.decision.blockedReason, '');

  const completed = await environmentTaskValidatorNode.execute({
    response: 'The action completed, but I do not recognize that the objective is done.',
    taskDecision: {
      outcome: 'continue',
      reason: 'The objective still appears incomplete.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
    },
    observation: observation({
      source: 'user',
      step: 2,
      maxSteps: 8,
      terminalCommand: 'rest',
      objective: validated.taskInstruction,
    }),
  }, { operatorMode: 'semi' });
  assert.equal(completed.complete, true);
  assert.equal(completed.outcome, 'complete');
  assert.equal(completed.shouldRefine, false);
  assert.equal(completed.decision.completionBasis, 'action_result');
  assert.equal(completed.decision.completionEvidence, 'done');

  const failedObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 8,
    terminalCommand: 'rest',
    objective: validated.taskInstruction,
  });
  failedObservation.feedback![0]!.type = 'failed';
  failedObservation.feedback![0]!.message = 'controller reported failure';
  const failed = await environmentTaskValidatorNode.execute({
    response: 'The robot did not complete the action.',
    taskDecision: {
      outcome: 'continue',
      reason: 'The controller reported a failed action result.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
    },
    observation: failedObservation,
  }, { operatorMode: 'semi' });
  assert.equal(failed.complete, false);
  assert.equal(failed.shouldRefine, true);
  assert.equal(failed.decision.terminalFeedback, 'failed');
  assert.equal(failed.refinementRequest.result.terminalFeedback.type, 'failed');
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
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'visual_observation',
      completionEvidence: 'The fresh correlated visual contains the completion criterion.',
    },
    evidenceAssessment: supportedVisualAssessment(),
    observation: currentObservation,
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, true);
  assert.deepEqual(result.actions, []);
  assert.equal(result.shouldRefine, false);
});

test('the existing validator converts an incomplete result into one bounded refinement request', async () => {
  const result = await environmentTaskValidatorNode.execute({
    actions: [],
    movementRequest: null,
    response: 'The current step did not satisfy the objective.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    instruction: 'Complete the objective subject to its stated criterion.',
    observation: observation({ source: 'user', terminalCommand: 'walk' }),
  }, { operatorMode: 'semi' });

  assert.equal(result.shouldRefine, true);
  assert.equal(result.refinementRequest.kind, 'environment_task_refinement_request');
  assert.equal(result.refinementRequest.continuationPolicy, 'bounded');
  assert.equal(result.refinementRequest.objective, 'Complete the objective subject to its stated criterion.');
  assert.equal(result.refinementRequest.source, 'user');
  assert.equal(result.refinementRequest.step, 2);
  assert.equal(result.refinementRequest.maxSteps, 3);
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
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'visual_observation',
      completionEvidence: 'The termination criterion is present in the current observation.',
    },
    observation: observation({ source: 'user', terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(unsupported.complete, false);
  assert.equal(unsupported.outcome, 'continue');
  assert.equal(unsupported.decision.blockedReason, 'visual_completion_unverified');

  const supported = await environmentTaskValidatorNode.execute({
    response: 'The objective is complete.',
    taskDecision: {
      outcome: 'complete',
      reason: 'Current correlated evidence satisfies the objective.',
      objectiveComplete: true,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'visual_observation',
      completionEvidence: 'The current correlated visual contains the required completion evidence.',
    },
    evidenceAssessment: supportedVisualAssessment(),
    observation: observation({ source: 'user', terminalCommand: 'walk', objective, visual: true }),
  }, { operatorMode: 'semi' });

  assert.equal(supported.complete, true);
  assert.equal(supported.decision.completionVerified, true);
  assert.equal(supported.shouldRefine, false);
});

test('an independently rejected visual completion claim opens refinement with a visible correction', async () => {
  const objective = 'Maintain the requested activity until its visual completion condition is satisfied.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'The visual completion condition is satisfied.',
    taskDecision: {
      outcome: 'complete',
      reason: 'The condition is visible.',
      objectiveComplete: true,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      completionBasis: 'visual_observation',
      completionEvidence: 'The condition appears in the frame.',
    },
    evidenceAssessment: {
      assessed: true,
      valid: true,
      verdict: 'unsupported',
      frameId: 'visual-1',
      frameTimestamp: '2026-08-03T12:00:00.000Z',
      reason: 'The required condition is absent from the exact correlated frame.',
      response: 'The completion condition is not visible yet.',
      error: '',
    } satisfies EnvironmentVisualEvidenceAssessment,
    observation: observation({
      source: 'user',
      step: 2,
      maxSteps: 4,
      terminalCommand: 'walk',
      objective,
      visual: true,
    }),
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, false);
  assert.equal(result.shouldRefine, true);
  assert.equal(result.response, 'The completion condition is not visible yet.');
  assert.equal(result.refinementRequest.continuationPolicy, 'bounded');
  assert.equal(result.refinementRequest.result.visualEvidence.verdict, 'unsupported');
  assert.equal(result.decision.blockedReason, 'visual_completion_unverified');
  assert.equal(result.decision.evidenceAssessment.verdict, 'unsupported');
});

test('a completed response can open bounded refinement without a robot action', async () => {
  const objective = 'Produce one bounded item per turn; termination is governed by the objective criterion.';
  const inputs = {
    response: 'Here is the current requested item.',
    taskDecision: {
      outcome: 'continue',
      reason: 'The objective criterion is not satisfied.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    instruction: objective,
    observation: observation({ source: 'user', step: 1, maxSteps: 3, objective }),
  };
  const semi = await environmentTaskValidatorNode.execute(inputs, { operatorMode: 'semi' });
  assert.equal(semi.decision.stepComplete, true);
  assert.equal(semi.shouldRefine, true);
  assert.equal(semi.refinementRequest.step, 1);

  const reactive = await environmentTaskValidatorNode.execute(inputs, { operatorMode: 'reactive' });
  assert.equal(reactive.shouldRefine, true);
  assert.equal(reactive.decision.blockedReason, '');
});

test('a completed action defaults to one-shot completion and never replays its objective', async () => {
  const objective = 'Continue the requested activity until its completion criterion is satisfied.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective criterion is not satisfied.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective criterion.',
      objectiveComplete: false,
    },
    observation: observation({ source: 'user', step: 1, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, true);
  assert.equal(result.outcome, 'complete');
  assert.equal(result.shouldRefine, false);
  assert.equal(result.refinementRequest, null);
  assert.equal(result.decision.continuationPolicy, 'none');
  assert.equal(result.decision.completionBasis, 'action_result');
  assert.equal(result.decision.completionEvidence, 'done');
  assert.equal(result.decision.blockedReason, '');
  assert.equal(result.decision.kind, 'environment_task_lifecycle');
  assert.equal(result.decision.owner, 'environment-task-validator');
  assert.equal(result.decision.cycleId, 'cycle-1');
  assert.equal(result.decision.step, 1);
  assert.equal(result.decision.maxSteps, 3);
});

test('a post-movement image, not command execution alone, decides an external spatial objective', async () => {
  const objective = 'Move closer to the object until it appears closer in the robot camera.';
  const initial = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk' }],
    taskDecision: {
      outcome: 'act',
      reason: 'Walk once, then evaluate the external object in the returned image.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
    },
    instruction: objective,
    observation: observation({ source: 'user', step: 1, maxSteps: 4, objective }),
  }, { operatorMode: 'semi' });

  assert.equal(initial.decision.continuationPolicy, 'bounded');
  assert.equal(initial.decision.requiredCompletionBasis, 'visual_observation');

  const terminalObservation = {
    ...observation({ source: 'user', step: 2, maxSteps: 4, terminalCommand: 'walk', objective, visual: true }),
    metadata: {
      ...observation({ source: 'user', step: 2, maxSteps: 4, terminalCommand: 'walk', objective, visual: true }).metadata,
      originatingInstruction: initial.taskInstruction,
    },
  };
  const interpreted = await environmentInstructionInterpreterNode.execute({
    observation: terminalObservation,
  }, { userMessage: '' });
  assert.match(interpreted.instruction, /Required whole-objective completion basis: visual_observation/);
  assert.match(interpreted.instruction, new RegExp(objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(interpreted.instruction, /EnvironmentTaskContract:/);

  const terminalClaim = {
    outcome: 'complete' as const,
    reason: 'The physical action returned done.',
    objectiveComplete: true,
    continuationPolicy: 'none' as const,
    requiredCompletionBasis: 'action_result' as const,
    completionBasis: 'action_result' as const,
    completionEvidence: 'done',
  };
  const terminalContract = await environmentTaskContractNode.execute({
    taskDecision: terminalClaim,
    observation: terminalObservation,
  }, {});

  assert.equal(terminalContract.taskDecision.requiredCompletionBasis, 'visual_observation');

  const visualAssessment = await environmentVisualEvidenceAssessorNode.execute({
    taskDecision: terminalContract.taskDecision,
    instruction: objective,
    observation: terminalObservation,
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [terminalObservation.visual],
  }, {
    evaluateEnvironmentVisualEvidence: async () => ({
      verdict: 'unsupported',
      reason: 'The object does not appear closer in the exact correlated post-action frame.',
    }),
  }, { systemPrompt: 'Assess the external objective in the exact correlated post-action image.' });
  const unsupported = await environmentTaskValidatorNode.execute({
    response: 'The physical step finished and the whole objective is complete.',
    taskDecision: terminalContract.taskDecision,
    evidenceAssessment: visualAssessment.assessment,
    observation: terminalObservation,
  }, { operatorMode: 'semi' });

  assert.equal(visualAssessment.assessed, true);
  assert.equal(visualAssessment.assessment.verdict, 'unsupported');
  assert.equal(unsupported.complete, false);
  assert.equal(unsupported.shouldRefine, true);
  assert.equal(unsupported.decision.continuationPolicy, 'bounded');
  assert.equal(unsupported.decision.requiredCompletionBasis, 'visual_observation');
  assert.equal(unsupported.decision.blockedReason, 'visual_completion_unverified');

  const continuing = await environmentTaskValidatorNode.execute({
    response: 'The physical step is complete, but the required evidence is not available.',
    taskDecision: {
      outcome: 'observe',
      reason: 'A fresh observation is required to evaluate the completion condition.',
      objectiveComplete: false,
      continuationPolicy: 'none',
    },
    observation: terminalObservation,
  }, { operatorMode: 'semi' });

  assert.equal(continuing.shouldRefine, true);
  assert.equal(continuing.refinementRequest.requiredCompletionBasis, 'visual_observation');
});

test('bounded incomplete work opens refinement without a prewritten successor instruction', async () => {
  const objective = 'Continue the requested activity until its completion criterion is satisfied.';
  const result = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective criterion is not satisfied.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective criterion.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'user', step: 1, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(result.complete, false);
  assert.equal(result.shouldRefine, true);
  assert.equal(result.refinementRequest.kind, 'environment_task_refinement_request');
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
  assert.equal(result.shouldRefine, false);
  assert.equal(result.refinementRequest, null);
  assert.equal(result.decision.stepComplete, false);
  assert.equal(result.decision.blockedReason, 'objective_completion_unverified');
});

test('the existing validator opens refinement until the hard step bound', async () => {
  const objective = 'Maintain the requested activity subject to its termination criterion.';
  const repeated = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective remains incomplete.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(repeated.shouldRefine, true);
  assert.equal(repeated.decision.blockedReason, '');

  const bounded = await environmentTaskValidatorNode.execute({
    response: 'The current step completed, but the objective remains incomplete.',
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'user', step: 3, maxSteps: 3, terminalCommand: 'walk', objective }),
  }, { operatorMode: 'semi' });

  assert.equal(bounded.shouldRefine, false);
  assert.equal(bounded.decision.blockedReason, 'step_limit');
});

test('validator follows bounded graph decisions independently of trigger mode and source', async () => {
  const repeated = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Try again.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'autonomy', terminalCommand: 'walk' }),
  }, { operatorMode: 'full' });
  assert.equal(repeated.shouldRefine, true);
  assert.equal(repeated.decision.blockedReason, '');

  const reactive = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Look elsewhere.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'user', terminalCommand: 'walk' }),
  }, { operatorMode: 'reactive' });
  assert.equal(reactive.shouldRefine, true);
  assert.equal(reactive.decision.blockedReason, '');

  const autonomous = await environmentTaskValidatorNode.execute({
    actions: [{ type: 'robotCommand', command: 'left' }],
    taskDecision: {
      outcome: 'act',
      reason: 'Something may be nearby.',
      objectiveComplete: false,
    },
    observation: observation({ source: 'autonomy' }),
  }, { operatorMode: 'semi' });
  assert.equal(autonomous.actions.length, 1);
  assert.equal(autonomous.actions[0].command, 'left');
  assert.equal(autonomous.decision.blockedReason, '');
});

test('autonomous work may enter refinement but still honors the bounded cycle', async () => {
  const admitted = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'observe',
      reason: 'The object moved out of view.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'autonomy', step: 2, maxSteps: 3, terminalCommand: 'left' }),
  }, { operatorMode: 'full' });
  assert.equal(admitted.shouldRefine, true);
  assert.equal(admitted.refinementRequest.source, 'autonomy');

  const bounded = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'More work remains.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'autonomy', step: 3, maxSteps: 3, terminalCommand: 'left' }),
  }, { operatorMode: 'full' });
  assert.equal(bounded.shouldRefine, false);
  assert.equal(bounded.decision.blockedReason, 'step_limit');
});

test('Environment Task Refiner authors the next prompt only after the existing validator requests it', async () => {
  const currentObservation = observation({
    source: 'user',
    step: 2,
    maxSteps: 8,
    terminalCommand: 'walk',
    objective: 'Inspect the area until the target can be identified.',
    visual: true,
  });
  const validated = await environmentTaskValidatorNode.execute({
    response: 'The target is not identifiable in the current view.',
    taskDecision: {
      outcome: 'continue',
      reason: 'The current view is too distant to identify the target.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'target_relative',
    },
    observation: currentObservation,
  }, { operatorMode: 'semi' });
  assert.equal(validated.shouldRefine, true);

  let calls = 0;
  const refined = await environmentTaskRefinerNode.execute({
    request: validated.refinementRequest,
    observation: currentObservation,
    images: [{ type: 'image_url', image_url: { url: TEST_JPEG } }],
    frames: [currentObservation.visual],
    conversationHistory: [
      { role: 'user', content: 'Please identify the target.' },
      { role: 'assistant', content: 'I need a clearer view.' },
    ],
    personaText: 'Persona: careful and pragmatic.',
  }, {
    username: 'greggles',
    cognitiveMode: 'environment',
    refineEnvironmentTask: async ({ messages }: { messages: unknown[] }) => {
      calls += 1;
      assert.match(JSON.stringify(messages), /current view is too distant/i);
      assert.match(JSON.stringify(messages), /careful and pragmatic/i);
      assert.match(JSON.stringify(messages), /Objective and evidence contract/i);
      assert.match(JSON.stringify(messages), /Original objective: Inspect the area until the target can be identified/i);
      assert.match(JSON.stringify(messages), /Previous attempt motion class: target_relative/i);
      assert.match(JSON.stringify(messages), /not a constraint on the next approach/i);
      assert.match(JSON.stringify(messages), /Never rewrite it as an explicit user instruction or user_input requirement/i);
      return {
        instruction: 'Obtain a closer, well-lit view of the target and inspect identifying details.',
        message: 'The first view was too distant to identify the target, so I am refining the next attempt to obtain a closer, better-lit view.',
        reason: 'A closer view addresses the missing visual detail without changing the objective.',
      };
    },
  }, {
    role: 'orchestrator',
    systemPrompt: 'Refine one validator-confirmed incomplete task and return structured JSON.',
    historyLimit: 8,
    maxTokens: 768,
    temperature: 0.2,
  });

  assert.equal(calls, 1);
  assert.equal(refined.error, '');
  assert.equal(refined.valid, true);
  assert.match(refined.message, /first view was too distant/i);
  assert.equal(refined.conversationEntry.role, 'assistant');
  assert.equal(refined.workflowCommand.kind, 'environment_workflow_command');
  assert.equal(refined.workflowCommand.instruction, refined.instruction);
  assert.equal(refined.workflowCommand.step, 2);
  assert.equal(refined.workflowCommand.maxSteps, 8);
  assert.equal(refined.workflowCommand.advanceCycle, false);
  assert.equal(refined.workflowCommand.objective, validated.refinementRequest.objective);
  assert.equal(refined.workflowCommand.requiredCompletionBasis, 'visual_observation');
  assert.equal(refined.workflowCommand.motionClass, undefined);

  let invalidRefinementCalls = 0;
  const protectedRequest = {
    ...validated.refinementRequest,
    result: {
      ...validated.refinementRequest.result,
      visualEvidence: {
        verdict: 'supported' as const,
        reason: 'The original visual condition is present.',
        frameId: 'visual-1',
      },
    },
  };
  const protectedCompletion = await environmentTaskRefinerNode.execute({
    request: protectedRequest,
    observation: currentObservation,
  }, {
    refineEnvironmentTask: async () => {
      invalidRefinementCalls += 1;
      return {};
    },
  }, {
    systemPrompt: 'This prompt must not run after supported visual completion.',
  });
  assert.equal(invalidRefinementCalls, 0);
  assert.equal(protectedCompletion.skipped, true);
  assert.equal(protectedCompletion.error, 'supported_visual_completion_cannot_refine');

  const skipped = await environmentTaskRefinerNode.execute({}, {}, {
    systemPrompt: 'This prompt must not run without a validator request.',
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.workflowCommand, null);
});

test('Environment Workflow Command admits the validated instruction to the coordinator queue', async () => {
  const motionControl = {
    version: 1 as const,
    cycleId: 'cycle-1',
    planIds: ['plan-1'],
    lastPlanId: 'plan-1',
    lastVisualFrameId: 'visual-1',
    lastVisualFrameTimestamp: '2026-08-03T12:00:00.000Z',
    consecutiveIdentical: 1,
  };
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
    continuationPolicy: 'bounded',
    requiredCompletionBasis: 'visual_observation',
    motionControl,
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
  assert.equal(queued.input.observation.metadata.taskValidatorCommand.version, 4);
  assert.equal(queued.input.observation.metadata.taskValidatorCommand.continuationPolicy, 'bounded');
  assert.equal(
    queued.input.observation.metadata.taskValidatorCommand.requiredCompletionBasis,
    'visual_observation',
  );
  assert.deepEqual(
    queued.input.observation.metadata.taskValidatorCommand.motionControl,
    motionControl,
  );
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
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
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
  assert.equal(interpreted.instruction, 'Assign the next step to a different actor.');
});

test('a refined instruction can execute once and a completed objective stops the chain', async () => {
  const validatorResult = await environmentTaskValidatorNode.execute({
    taskDecision: {
      outcome: 'continue',
      reason: 'Current evidence does not satisfy the objective criterion.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk' }),
  }, { operatorMode: 'semi' });
  const sourceObservation = observation({ source: 'user', step: 2, maxSteps: 3, terminalCommand: 'walk' });
  const refinement = await environmentTaskRefinerNode.execute({
    request: validatorResult.refinementRequest,
    observation: sourceObservation,
  }, {
    username: 'greggles',
    refineEnvironmentTask: async () => ({
      instruction: 'Turn left to inspect a different part of the room.',
      message: 'The current view did not complete the objective, so I will inspect the left side next.',
      reason: 'The left side has not yet been inspected.',
    }),
  }, {
    systemPrompt: 'Write one refined Environment instruction as structured JSON.',
  });
  assert.equal(refinement.valid, true);
  const queuedInputs: TaskInput[] = [];
  await environmentWorkflowCommandNode.execute({
    command: refinement.workflowCommand,
    observation: sourceObservation,
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
    routingAnalysis: {
      needsAction: true,
      actionType: 'robot_movement',
      actionParams: { motionClass: 'body_local' },
    },
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
    evidenceAssessment: supportedVisualAssessment('visual-2'),
    observation: completedObservation,
  }, { operatorMode: 'semi' });
  assert.equal(completed.complete, true);
  assert.equal(completed.shouldRefine, false);
  assert.equal(completed.decision.objective, 'Complete the objective subject to its stated criterion.');
});

test('Environment Workflow Command executes a validated graph command without rechecking trigger mode', async () => {
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
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
    },
    observation: observation({ source: 'user', step: 2, maxSteps: 3 }),
  }, {
    username: 'greggles',
    operatorMode: 'reactive',
    enqueueEnvironmentWorkflow: () => {
      enqueueCalls += 1;
      return { id: 'queued-task' };
    },
  });

  assert.equal(result.queued, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.taskId, 'queued-task');
  assert.equal(enqueueCalls, 1);
});
