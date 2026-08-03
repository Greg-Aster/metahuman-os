import { getOperatorMode } from '../../active-operator/mode-controller.js';
import {
  hasFreshCorrelatedVisual,
  type EnvironmentAction,
  type EnvironmentFeedback,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';
import {
  loadRobotOperatorConfig,
  readRobotObserverCycle,
  type RobotObserverTriggerSource,
} from '../../robot-operator.js';
import type { AutonomyMode } from '../../queue/types.js';
import { defineNode } from '../types.js';
import type {
  EnvironmentCompletionBasis,
  EnvironmentMovementRequest,
  EnvironmentTaskDecision,
  EnvironmentTaskOutcome,
} from './helpers.js';

type TaskSource = RobotObserverTriggerSource | 'environment';

export interface EnvironmentWorkflowCommand {
  kind: 'environment_workflow_command';
  objective: string;
  instruction: string;
  reason: string;
  source: RobotObserverTriggerSource;
  mode: AutonomyMode;
  graph: string;
  cycleId?: string;
  step: number;
  maxSteps: number;
  advanceCycle?: boolean;
  requireExternalCompletionEvidence?: boolean;
}

const CURRENT_ACTION_OUTCOMES = new Set<EnvironmentTaskOutcome>(['continue', 'observe', 'act']);
const QUEUEABLE_OUTCOMES = new Set<EnvironmentTaskOutcome>(['continue', 'observe', 'act', 'report']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function currentMode(context: Record<string, unknown>): AutonomyMode {
  const override = context.operatorMode;
  return override === 'reactive' || override === 'semi' || override === 'full'
    ? override
    : getOperatorMode();
}

function taskCommandMetadata(observation: EnvironmentObservation | undefined): Record<string, unknown> | null {
  const value = observation?.metadata?.taskValidatorCommand;
  return isRecord(value) ? value : null;
}

function taskSource(
  observation: EnvironmentObservation | undefined,
  context: Record<string, unknown>,
): TaskSource {
  const command = taskCommandMetadata(observation);
  if (command?.source === 'user' || command?.source === 'autonomy') return command.source;

  const cycle = readRobotObserverCycle(observation);
  if (cycle) return cycle.triggerSource;
  if (observation?.metadata?.boredomMovement) return 'autonomy';
  if (context.environmentActionSource === 'user' || context.environmentActionSource === 'autonomy') {
    return context.environmentActionSource;
  }
  if (observation?.metadata?.perceptionEvent === 'audio_utterance') return 'user';
  if (typeof context.userMessage === 'string' && context.userMessage.trim()) return 'user';
  return 'environment';
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function hasCurrentUserInput(
  observation: EnvironmentObservation | undefined,
  context: Record<string, unknown>,
): boolean {
  if (typeof context.userMessage === 'string' && Boolean(context.userMessage.trim())) return true;
  if (observation?.metadata?.perceptionEvent === 'audio_utterance') return true;
  return observation?.text?.some(event => event.source === 'player' || event.source === 'environment') === true;
}

function completionBasisAvailable(
  basis: EnvironmentCompletionBasis | undefined,
  observation: EnvironmentObservation | undefined,
  terminal: EnvironmentFeedback | null,
  response: string,
  source: TaskSource,
  context: Record<string, unknown>,
): boolean {
  switch (basis) {
    case 'response':
      return Boolean(response);
    case 'action_result':
      return terminal?.type === 'completed';
    case 'visual_observation': {
      const cycle = readRobotObserverCycle(observation);
      return Boolean(cycle && hasFreshCorrelatedVisual(observation, cycle.cycleId));
    }
    case 'environment_state':
      return Boolean(observation?.state && Object.keys(observation.state).length > 0);
    case 'user_input':
      return source === 'user' && hasCurrentUserInput(observation, context);
    default:
      return false;
  }
}

function unwrapObjective(value: string): string {
  const match = value.match(/^Objective:\s*(.+?)\s+Next Environment instruction \(step \d+ of \d+\):/i);
  return cleanText(match?.[1] || value, 1_000);
}

function taskObjective(
  observation: EnvironmentObservation | undefined,
  instruction: unknown,
  context: Record<string, unknown>,
): string {
  const command = taskCommandMetadata(observation);
  const candidates = [
    command?.objective,
    observation?.metadata?.originatingInstruction,
    context.environmentTaskObjective,
    context.environmentTaskInstruction,
    context.userMessage,
    instruction,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanText(candidate, 1_000);
    if (cleaned) return unwrapObjective(cleaned);
  }
  return '';
}

function latestTerminalFeedback(observation: EnvironmentObservation | undefined): EnvironmentFeedback | null {
  for (let index = (observation?.feedback?.length ?? 0) - 1; index >= 0; index -= 1) {
    const feedback = observation?.feedback?.[index];
    if (
      feedback
      && ['completed', 'rejected', 'cancelled', 'expired', 'failed'].includes(feedback.type)
    ) return feedback;
  }
  return null;
}

function sourceMayAct(mode: AutonomyMode, source: TaskSource): boolean {
  return source === 'user' || mode === 'full';
}

function sourceMayQueue(mode: AutonomyMode, source: TaskSource): source is RobotObserverTriggerSource {
  if (mode === 'reactive') return false;
  if (mode === 'semi') return source === 'user';
  return source === 'user' || source === 'autonomy';
}

function fallbackOutcome(
  terminal: EnvironmentFeedback | null,
  actions: Partial<EnvironmentAction>[],
  movementRequest: EnvironmentMovementRequest | null,
  response: string,
): EnvironmentTaskOutcome {
  if (terminal) return 'report';
  if (actions.length > 0 || movementRequest) return 'act';
  return response ? 'report' : 'wait';
}

export const environmentTaskValidatorNode = defineNode({
  id: 'environment_task_validator',
  name: 'Environment Task Validator',
  category: 'environment',
  inputs: [
    { name: 'actions', type: 'array', optional: true, description: 'Current-pass semantic actions from Environment Action Parser' },
    { name: 'movementRequest', type: 'object', optional: true, description: 'Current-pass off-script movement request' },
    { name: 'response', type: 'string', optional: true, description: 'Conversational response to pass through' },
    { name: 'taskDecision', type: 'object', optional: true, description: 'Structured completion decision produced by the Environment LLM' },
    { name: 'taskDecisionError', type: 'string', optional: true, description: 'Task-decision parsing error from Environment Action Parser' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current Environment instruction' },
    { name: 'observation', type: 'object', optional: true, description: 'Current observation and terminal action feedback' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Mode- and source-admitted current semantic actions' },
    { name: 'movementRequest', type: 'object', description: 'Mode- and source-admitted movement request' },
    { name: 'response', type: 'string', description: 'Conversational response passed to Environment Bridge Out' },
    { name: 'decision', type: 'object', description: 'Normalized validator decision and audit reason' },
    { name: 'outcome', type: 'string', description: 'Normalized completion outcome' },
    { name: 'complete', type: 'boolean', description: 'Whether the current objective is complete' },
    { name: 'nextInstruction', type: 'string', description: 'Validated instruction for a separate Environment workflow run' },
    { name: 'workflowCommand', type: 'object', description: 'Bounded command for Environment Workflow Command' },
    { name: 'shouldQueue', type: 'boolean', description: 'Whether a separate Environment workflow run should be queued' },
  ],
  description: 'Validates task completion, gates robot actions by Active Operator mode, and emits a bounded next-workflow command without mutating the queue.',
  async execute(inputs, context) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : undefined;
    const actions = Array.isArray(inputs.actions)
      ? inputs.actions.filter(isRecord) as Partial<EnvironmentAction>[]
      : [];
    const movementRequest = isRecord(inputs.movementRequest)
      ? inputs.movementRequest as unknown as EnvironmentMovementRequest
      : null;
    const response = cleanText(inputs.response, 4_000);
    const taskDecision = isRecord(inputs.taskDecision)
      ? inputs.taskDecision as unknown as EnvironmentTaskDecision
      : null;
    const taskDecisionError = cleanText(inputs.taskDecisionError, 500);
    const mode = currentMode(context);
    const source = taskSource(observation, context);
    const objective = taskObjective(observation, inputs.instruction, context);
    const terminal = latestTerminalFeedback(observation);
    const cycle = readRobotObserverCycle(observation);
    const config = loadRobotOperatorConfig();
    const maxSteps = cycle?.maxSteps ?? config.maxCycleSteps;
    const step = cycle?.step ?? 1;
    const requestedNextInstruction = cleanText(taskDecision?.nextInstruction, 500);
    const completionEvidence = cleanText(taskDecision?.completionEvidence, 500);
    const proposedOutcome = taskDecision?.outcome
      || fallbackOutcome(terminal, actions, movementRequest, response);
    const explicitDecision = Boolean(taskDecision);
    const claimedComplete = taskDecision?.objectiveComplete ?? proposedOutcome === 'complete';
    const hasCandidateWork = actions.length > 0 || movementRequest !== null;
    const externalCompletionEvidenceRequired = Boolean(
      taskCommandMetadata(observation)?.requireExternalCompletionEvidence === true
      || terminal?.type === 'completed',
    );
    const pendingWorkBlocksCompletion = Boolean(
      !terminal
      && hasCandidateWork
      && (
        taskDecision?.completionBasis === 'response'
        || taskDecision?.completionBasis === 'action_result'
      )
    );
    const completionSupported = !claimedComplete || Boolean(
      !pendingWorkBlocksCompletion
      && completionEvidence
      && !(externalCompletionEvidenceRequired && taskDecision?.completionBasis === 'response')
      && completionBasisAvailable(
        taskDecision?.completionBasis,
        observation,
        terminal,
        response,
        source,
        context,
      )
    );
    const complete = claimedComplete && completionSupported;
    const prematureCompletionWithWork = Boolean(
      !terminal
      && hasCandidateWork
      && claimedComplete
      && !completionSupported,
    );
    const decisionAllowsCurrentAction = !taskDecision
      || CURRENT_ACTION_OUTCOMES.has(proposedOutcome)
      || prematureCompletionWithWork;
    const currentActionsAllowed = !terminal && sourceMayAct(mode, source) && decisionAllowsCurrentAction;
    const stopActions = actions.filter(action => action.type === 'stop');
    const admittedActions = currentActionsAllowed ? actions : stopActions;
    const admittedMovementRequest = currentActionsAllowed ? movementRequest : null;
    const outcome = prematureCompletionWithWork
      ? 'act'
      : !complete && (claimedComplete || proposedOutcome === 'complete')
        ? 'continue'
        : proposedOutcome;
    const responseStepComplete = Boolean(
      !terminal
      && response
      && actions.length === 0
      && !movementRequest
      && !claimedComplete
    );
    const queueTrigger = terminal?.type === 'completed' || responseStepComplete;
    const incomplete = Boolean(
      taskDecision
      && !complete
      && QUEUEABLE_OUTCOMES.has(outcome),
    );
    const queueSourceAllowed = sourceMayQueue(mode, source);
    const queueSource = source === 'user' || source === 'autonomy' ? source : null;
    const explicitContinuation = Boolean(
      requestedNextInstruction
      && taskDecision?.continuationType,
    );
    const continuationDerived = Boolean(incomplete && objective && !explicitContinuation);
    const nextInstruction = explicitContinuation
      ? requestedNextInstruction
      : incomplete ? objective : '';
    const continuationType = explicitContinuation
      ? taskDecision?.continuationType
      : incomplete ? 'advance' : undefined;
    const continuationClassified = continuationType === 'advance' || continuationType === 'repeat';
    const repeatRequested = continuationType === 'repeat';
    const repeatAuthorized = Boolean(
      repeatRequested
      && source === 'user'
      && !complete,
    );
    const repeatBlocked = repeatRequested && !repeatAuthorized;
    const shouldQueue = Boolean(
      queueTrigger
      && incomplete
      && nextInstruction
      && continuationClassified
      && objective
      && queueSourceAllowed
      && queueSource
      && step < maxSteps
      && !repeatBlocked,
    );
    const workflowCommand: EnvironmentWorkflowCommand | null = shouldQueue
      ? {
          kind: 'environment_workflow_command',
          objective,
          instruction: nextInstruction,
          reason: cleanText(taskDecision?.reason, 500) || 'The current objective requires another bounded step.',
          source: queueSource!,
          mode,
          graph: cycle?.graph ?? config.graph,
          cycleId: cycle?.cycleId,
          step,
          maxSteps,
          advanceCycle: responseStepComplete,
          requireExternalCompletionEvidence: externalCompletionEvidenceRequired,
        }
      : null;

    let blockedReason = '';
    if (claimedComplete && !completionSupported) blockedReason = 'objective_completion_unverified';
    else if (queueTrigger && incomplete && !objective) blockedReason = 'missing_objective';
    else if (queueTrigger && incomplete && !queueSourceAllowed) blockedReason = `mode_${mode}_source_${source}`;
    else if (queueTrigger && incomplete && step >= maxSteps) blockedReason = 'step_limit';
    else if (repeatBlocked) blockedReason = 'repeat_not_authorized';
    else if (!currentActionsAllowed && actions.length > stopActions.length) blockedReason = `current_action_blocked_${mode}_${source}`;
    else if (taskDecisionError) blockedReason = 'invalid_task_decision';

    return {
      actions: admittedActions,
      movementRequest: admittedMovementRequest,
      response,
      decision: {
        outcome,
        complete,
        explicit: explicitDecision,
        reason: cleanText(taskDecision?.reason, 500),
        mode,
        source,
        objective,
        stepComplete: queueTrigger,
        continuationType: continuationType ?? null,
        continuationDerived,
        externalCompletionEvidenceRequired,
        completionBasis: taskDecision?.completionBasis ?? 'none',
        completionEvidence,
        completionVerified: complete,
        terminalFeedback: terminal?.type ?? null,
        blockedReason,
        admittedActionCount: admittedActions.length,
      },
      outcome,
      complete,
      nextInstruction: shouldQueue ? nextInstruction : '',
      workflowCommand,
      shouldQueue,
    };
  },
});
