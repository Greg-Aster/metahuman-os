import type {
  EnvironmentFeedback,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { parseRobotObserverCycle } from '../../robot-operator.js';
import { defineNode } from '../types.js';
import type { EnvironmentTaskState } from './helpers.js';
import {
  cleanEnvironmentText,
  environmentCompletionInstruction,
  environmentFeedbackInstruction,
  isEnvironmentRecord,
} from './task-lifecycle.js';

export const environmentTaskPreparationNode = defineNode({
  id: 'environment_task_preparation',
  name: 'Prepare Environment Decision',
  category: 'environment',
  inputs: [
    { name: 'taskState', type: 'object', description: 'Task state from Environment Task Input' },
    { name: 'instruction', type: 'string', description: 'Current user or planner instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human-authored instruction, when present' },
    { name: 'inputSource', type: 'string', description: 'Instruction provenance: user or autonomy' },
    { name: 'terminalFeedback', type: 'object', optional: true, description: 'Exact feedback from Environment Feedback Correlator' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated frames from Environment Image Input' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle from Robot Operator Input or Environment Action Context Input' },
  ],
  outputs: [
    { name: 'taskState', type: 'object', description: 'Task state prepared for the current LLM decision' },
    { name: 'instruction', type: 'string', description: 'Lifecycle-grounded instruction for the Environment LLM' },
    { name: 'routingAnalysis', type: 'object', description: 'Context admission requirements for this decision' },
    { name: 'memoryHints', type: 'object', description: 'Memory retrieval requirements for this decision' },
    { name: 'movementRequest', type: 'object', description: 'Previously selected movement request resumed after standing preparation' },
    { name: 'operatorActionRequired', type: 'boolean', description: 'Whether the Robot Operator requested a physical consequence' },
    { name: 'deterministicComplete', type: 'boolean', description: 'Whether exact one-step user action feedback completes the lifecycle' },
  ],
  description: 'Builds lifecycle and context requirements for one Environment LLM decision from explicit task, feedback, image, and Robot Operator inputs.',
  async execute(inputs) {
    const taskState = isEnvironmentRecord(inputs.taskState)
      ? inputs.taskState as unknown as EnvironmentTaskState
      : null;
    if (!taskState) throw new Error('Prepare Environment Decision requires taskState');
    const instruction = cleanEnvironmentText(inputs.instruction, 4_000);
    const userInstruction = cleanEnvironmentText(inputs.userInstruction, 4_000);
    const inputSource = inputs.inputSource === 'autonomy' ? 'autonomy' : 'user';
    const terminalFeedback = isEnvironmentRecord(inputs.terminalFeedback)
      ? inputs.terminalFeedback as unknown as EnvironmentFeedback
      : null;
    const frames = Array.isArray(inputs.frames)
      ? inputs.frames.filter(isEnvironmentRecord) as unknown as EnvironmentVisualFrame[]
      : [];
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
    const feedbackPass = Boolean(terminalFeedback);
    const operatorActionRequired = !feedbackPass
      && robotObserver?.requestedBy === 'boredom-movement';
    const needsMemory = Boolean(!feedbackPass && userInstruction);
    const needsVision = feedbackPass
      ? taskState.requiredCompletionBasis === 'visual_observation'
      : frames.length > 0 && (
          operatorActionRequired
          || robotObserver?.requestedBy === 'boredom-observer'
        );
    const preparedState: EnvironmentTaskState = feedbackPass
      ? {
          ...taskState,
          phase: taskState.requiredCompletionBasis === 'action_result'
            && taskState.continuationPolicy === 'none'
            ? 'awaiting_action'
            : 'evaluating_evidence',
        }
      : taskState;
    const movementRequest = terminalFeedback?.type === 'completed'
      ? preparedState.pendingMovementRequest ?? null
      : null;
    const deterministicComplete = Boolean(
      inputSource === 'user'
      && terminalFeedback?.type === 'completed'
      && preparedState.requiredCompletionBasis === 'action_result'
      && preparedState.continuationPolicy === 'none'
    );
    const preparedInstruction = terminalFeedback
      ? deterministicComplete
        ? environmentCompletionInstruction(preparedState, terminalFeedback)
        : environmentFeedbackInstruction(preparedState, terminalFeedback, frames)
      : operatorActionRequired
        ? [
            instruction,
            'Robot Operator delegated this intention because it requires one new sensing or environment action. Return one safe advertised action in actions[] or movementRequest now; prose about a future action is not execution. Any taskState evidence requirement applies after that action and must not replace it. If no advertised action can safely advance the intention, report the limitation without claiming that you will act.',
          ].filter(Boolean).join('\n\n')
        : instruction;
    const routingAnalysis = {
      needsMemory,
      memoryTier: 'hot',
      memoryQuery: needsMemory ? instruction : '',
      memoryTypes: [],
      needsEnvironment: true,
      needsVision,
      needsAction: operatorActionRequired,
      actionType: operatorActionRequired ? 'environment_action' : 'none',
      actionParams: {
        continuationPolicy: preparedState.continuationPolicy,
        requiredCompletionBasis: preparedState.requiredCompletionBasis,
        ...(preparedState.motionClass ? { motionClass: preparedState.motionClass } : {}),
        ...(preparedState.actionPurpose ? { actionPurpose: preparedState.actionPurpose } : {}),
      },
      complexity: 0.2,
      responseStyle: 'conversational',
      responseLength: 'brief',
      isFollowUp: !feedbackPass,
      emotionalTone: 'neutral',
    };
    return {
      taskState: preparedState,
      instruction: preparedInstruction,
      routingAnalysis,
      memoryHints: {
        needsMemory,
        memoryTier: 'hot',
        memoryQuery: needsMemory ? instruction : '',
        memoryTypes: [],
      },
      movementRequest,
      operatorActionRequired,
      deterministicComplete,
    };
  },
});
