import { getOperatorMode } from '../../active-operator/mode-controller.js';
import {
  hasFreshCorrelatedVisual,
  isEnvironmentActiveViewTerminalStatus,
  normalizeEnvironmentActiveViewProgress,
  type EnvironmentAction,
  type EnvironmentFeedback,
  type EnvironmentMotionClass,
  type EnvironmentMotionControlState,
  type EnvironmentObservation,
} from '../../environment-interface/index.js';
import {
  loadRobotOperatorConfig,
  readRobotObserverCycle,
  type RobotObserverTriggerSource,
} from '../../robot-operator.js';
import type { AutonomyMode } from '../../queue/types.js';
import { defineNode } from '../types.js';
import {
  encodeEnvironmentTaskInstruction,
  environmentTaskContractFromObservation,
  parseEnvironmentTaskInstruction,
  robotOperatorActionRequirement,
  type EnvironmentCompletionBasis,
  type EnvironmentContinuationPolicy,
  type EnvironmentMovementRequest,
  type EnvironmentTaskContract,
  type EnvironmentTaskDecision,
  type EnvironmentTaskOutcome,
} from './helpers.js';
import type { EnvironmentVisualEvidenceAssessment } from './visual-evidence-assessor.node.js';

type TaskSource = RobotObserverTriggerSource | 'environment';

export interface EnvironmentTaskRefinementRequest {
  kind: 'environment_task_refinement_request';
  objective: string;
  currentInstruction: string;
  reason: string;
  source: RobotObserverTriggerSource;
  mode: AutonomyMode;
  graph: string;
  cycleId?: string;
  step: number;
  maxSteps: number;
  continuationPolicy: Extract<EnvironmentContinuationPolicy, 'bounded'>;
  requiredCompletionBasis: EnvironmentCompletionBasis;
  motionClass?: EnvironmentMotionClass;
  motionControl?: EnvironmentMotionControlState;
  requireExternalCompletionEvidence?: boolean;
  result: {
    outcome: EnvironmentTaskOutcome;
    terminalFeedback: {
      type: EnvironmentFeedback['type'];
      message: string;
      actionId?: string;
    } | null;
    completionEvidence: string;
    visualEvidence: {
      verdict: EnvironmentVisualEvidenceAssessment['verdict'];
      reason: string;
      frameId: string;
    } | null;
  };
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

function correlatedVisualFrameId(observation: EnvironmentObservation | undefined): string {
  const cycle = readRobotObserverCycle(observation);
  if (!cycle || !hasFreshCorrelatedVisual(observation, cycle.cycleId)) return '';
  const terminalActionId = latestTerminalFeedback(observation)?.actionId;
  const frames = [observation?.visual, ...(observation?.visuals ?? [])]
    .filter((frame): frame is NonNullable<EnvironmentObservation['visual']> => Boolean(frame));
  const matching = frames.filter(frame => (
    frame.metadata?.correlationId === cycle.cycleId
    && (!terminalActionId || frame.metadata?.actionId === terminalActionId)
  ));
  if (matching.length === 0) return '';
  return matching.reduce((latest, candidate) => (
    Date.parse(candidate.timestamp) >= Date.parse(latest.timestamp) ? candidate : latest
  )).id;
}

function unwrapObjective(value: string): string {
  const contract = parseEnvironmentTaskInstruction(value);
  if (contract) return contract.objective;
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
    { name: 'generatedActions', type: 'array', optional: true, description: 'Strictly validated body-local actions from Movement Generator' },
    { name: 'movementRequest', type: 'object', optional: true, description: 'Current-pass off-script movement request' },
    { name: 'response', type: 'string', optional: true, description: 'Conversational response to pass through' },
    { name: 'generatedResponse', type: 'string', optional: true, description: 'Movement Generator result or typed rejection' },
    { name: 'motionControlResult', type: 'object', optional: true, description: 'Cycle-owned motion-plan ready/stuck result' },
    { name: 'taskDecision', type: 'object', optional: true, description: 'Structured completion decision produced by the Environment LLM' },
    { name: 'taskDecisionError', type: 'string', optional: true, description: 'Task-decision parsing error from Environment Action Parser' },
    { name: 'actionAdmission', type: 'object', optional: true, description: 'Typed capability admission result from Environment Action Parser' },
    { name: 'evidenceAssessment', type: 'object', optional: true, description: 'Independent frame-bound assessment of a claimed visual completion' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current Environment instruction' },
    { name: 'observation', type: 'object', optional: true, description: 'Current observation and terminal action feedback' },
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Current-turn structured task persistence and completion requirements' },
  ],
  outputs: [
    { name: 'actions', type: 'array', description: 'Graph-authored current semantic actions validated against task state' },
    { name: 'movementRequest', type: 'object', description: 'Graph-authored movement request validated against task state' },
    { name: 'response', type: 'string', description: 'Conversational response passed to Environment Bridge Out' },
    { name: 'decision', type: 'object', description: 'Normalized validator decision and audit reason' },
    { name: 'outcome', type: 'string', description: 'Normalized completion outcome' },
    { name: 'complete', type: 'boolean', description: 'Whether the current objective is complete' },
    { name: 'refinementRequest', type: 'object', description: 'Incomplete validated result for the graph-owned refinement LLM' },
    { name: 'shouldRefine', type: 'boolean', description: 'Whether the existing task should enter another bounded refinement stage' },
    { name: 'taskInstruction', type: 'string', description: 'Structured task contract persisted with admitted actions' },
  ],
  description: 'Validates graph-authored task completion and emits a typed incomplete result for bounded graph refinement.',
  async execute(inputs, context) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : undefined;
    const parsedActions = Array.isArray(inputs.actions)
      ? inputs.actions.filter(isRecord) as Partial<EnvironmentAction>[]
      : [];
    const generatedActions = Array.isArray(inputs.generatedActions)
      ? inputs.generatedActions.filter(isRecord) as Partial<EnvironmentAction>[]
      : [];
    const actions = [...parsedActions, ...generatedActions];
    const movementRequest = isRecord(inputs.movementRequest)
      ? inputs.movementRequest as unknown as EnvironmentMovementRequest
      : null;
    const hasCandidateWork = actions.length > 0 || movementRequest !== null;
    const candidateResponse = cleanText(inputs.generatedResponse, 4_000)
      || cleanText(inputs.response, 4_000);
    const motionControlResult = isRecord(inputs.motionControlResult)
      ? inputs.motionControlResult
      : null;
    const taskDecision = isRecord(inputs.taskDecision)
      ? inputs.taskDecision as unknown as EnvironmentTaskDecision
      : null;
    const taskDecisionError = cleanText(inputs.taskDecisionError, 500);
    const actionAdmission = isRecord(inputs.actionAdmission) ? inputs.actionAdmission : null;
    const actionAdmissionBlocked = Boolean(
      actionAdmission?.kind === 'environment_action_admission'
      && actionAdmission.admitted === false
      && cleanText(actionAdmission.reason, 200),
    );
    const actionAdmissionReason = actionAdmissionBlocked
      ? cleanText(actionAdmission?.reason, 200)
      : '';
    const evidenceAssessment = isRecord(inputs.evidenceAssessment)
      ? inputs.evidenceAssessment as unknown as EnvironmentVisualEvidenceAssessment
      : null;
    const routingAnalysis = isRecord(inputs.routingAnalysis)
      ? inputs.routingAnalysis
      : null;
    const mode = currentMode(context);
    const source = taskSource(observation, context);
    const objective = taskObjective(observation, inputs.instruction, context);
    const terminal = latestTerminalFeedback(observation);
    const activeViewProgress = normalizeEnvironmentActiveViewProgress(
      terminal?.data?.activeViewProgress,
    );
    const activeViewStopped = Boolean(
      activeViewProgress
      && isEnvironmentActiveViewTerminalStatus(activeViewProgress.status)
      && activeViewProgress.status !== 'reached',
    );
    const motionStuck = motionControlResult?.status === 'stuck' || activeViewStopped;
    const motionStuckReason = motionControlResult?.status === 'stuck'
      ? cleanText(motionControlResult?.reason, 200) || 'motion_stuck'
      : activeViewStopped
        ? `active_view_${activeViewProgress!.status}`
        : '';
    const response = candidateResponse
      || (activeViewStopped ? cleanText(terminal?.message, 4_000) : '');
    const cycle = readRobotObserverCycle(observation);
    const config = loadRobotOperatorConfig();
    const maxSteps = cycle?.maxSteps ?? config.maxCycleSteps;
    const step = cycle?.step ?? 1;
    const commandMetadata = taskCommandMetadata(observation);
    const motionControl = isRecord(motionControlResult?.state)
      ? motionControlResult.state as unknown as EnvironmentMotionControlState
      : isRecord(observation?.metadata?.motionControl)
        ? observation.metadata.motionControl as unknown as EnvironmentMotionControlState
        : isRecord(commandMetadata?.motionControl)
          ? commandMetadata.motionControl as unknown as EnvironmentMotionControlState
          : undefined;
    const persistedContract = environmentTaskContractFromObservation(observation);
    const fallbackCompletionBasis: EnvironmentCompletionBasis = (
      taskDecision?.requiredCompletionBasis && taskDecision.requiredCompletionBasis !== 'none'
    )
      ? taskDecision.requiredCompletionBasis
      : (!terminal && actions.length === 0 && movementRequest === null
        ? taskDecision?.completionBasis && taskDecision.completionBasis !== 'none'
          ? taskDecision.completionBasis
          : 'response'
        : 'action_result');
    const taskContract: EnvironmentTaskContract = persistedContract
      || {
        objective,
        continuationPolicy: taskDecision?.continuationPolicy === 'bounded' ? 'bounded' : 'none',
        requiredCompletionBasis: fallbackCompletionBasis,
        ...(taskDecision?.motionClass ? { motionClass: taskDecision.motionClass } : {}),
      };
    const continuationPolicy = taskContract.continuationPolicy;
    const requiredCompletionBasis = taskContract.requiredCompletionBasis;
    const completionEvidence = cleanText(taskDecision?.completionEvidence, 500);
    const proposedOutcome = taskDecision?.outcome
      || fallbackOutcome(terminal, actions, movementRequest, response);
    const explicitDecision = Boolean(taskDecision);
    const claimedComplete = taskDecision?.objectiveComplete ?? proposedOutcome === 'complete';
    const visualAssessmentRequired = Boolean(
      requiredCompletionBasis === 'visual_observation'
      && (claimedComplete || terminal?.type === 'completed'),
    );
    const currentVisualFrameId = correlatedVisualFrameId(observation);
    const visualAssessmentSupported = !visualAssessmentRequired || Boolean(
      evidenceAssessment?.assessed === true
      && evidenceAssessment.valid === true
      && evidenceAssessment.verdict === 'supported'
      && evidenceAssessment.frameId
      && evidenceAssessment.frameId === currentVisualFrameId,
    );
    const visualAssessmentRejected = visualAssessmentRequired && !visualAssessmentSupported;
    const assessedVisualCompletion = visualAssessmentRequired && visualAssessmentSupported;
    const effectiveClaimedComplete = claimedComplete || assessedVisualCompletion;
    const assessedCompletionBasis = assessedVisualCompletion
      ? 'visual_observation'
      : taskDecision?.completionBasis;
    const assessedCompletionEvidence = visualAssessmentRequired
      ? cleanText(evidenceAssessment?.reason, 500)
      : completionEvidence;
    const externalCompletionEvidenceRequired = Boolean(
      commandMetadata?.requireExternalCompletionEvidence === true
      || terminal?.type === 'completed',
    );
    const pendingWorkBlocksCompletion = Boolean(
      !terminal
      && hasCandidateWork
      && (
        assessedCompletionBasis === 'response'
        || assessedCompletionBasis === 'action_result'
      )
    );
    const completionSupported = !effectiveClaimedComplete || Boolean(
      !pendingWorkBlocksCompletion
      && assessedCompletionEvidence
      && assessedCompletionBasis === requiredCompletionBasis
      && visualAssessmentSupported
      && !(externalCompletionEvidenceRequired && assessedCompletionBasis === 'response')
      && completionBasisAvailable(
        assessedCompletionBasis,
        observation,
        terminal,
        response,
        source,
        context,
      )
    );
    const oneShotTerminalComplete = Boolean(
      terminal?.type === 'completed'
      && continuationPolicy === 'none'
      && requiredCompletionBasis === 'action_result',
    );
    const effectiveCompletionEvidence = oneShotTerminalComplete
      ? cleanText(terminal?.message, 500) || 'Correlated terminal feedback completed the action.'
      : assessedCompletionEvidence;
    const complete = oneShotTerminalComplete || (effectiveClaimedComplete && completionSupported);
    const prematureCompletionWithWork = Boolean(
      !terminal
      && hasCandidateWork
      && effectiveClaimedComplete
      && !completionSupported,
    );
    const decisionAllowsCurrentAction = !taskDecision
      || CURRENT_ACTION_OUTCOMES.has(proposedOutcome)
      || prematureCompletionWithWork;
    const currentActionsAllowed = !terminal && decisionAllowsCurrentAction;
    const stopActions = actions.filter(action => action.type === 'stop');
    const admittedActions = currentActionsAllowed ? actions : stopActions;
    const admittedMovementRequest = currentActionsAllowed ? movementRequest : null;
    const robotOperatorDecision = isRecord(observation?.metadata?.robotOperatorDecision)
      ? observation.metadata.robotOperatorDecision
      : null;
    const delegatedOperatorInstruction = cleanText(robotOperatorDecision?.instruction, 4_000);
    const delegatedActionRequirement = robotOperatorActionRequirement(observation);
    const currentActionRequired = Boolean(
      !terminal
      && (
        proposedOutcome === 'act'
        || (
          delegatedOperatorInstruction
          && (delegatedActionRequirement ?? routingAnalysis?.needsAction === true)
        )
      )
    );
    const requiredActionMissing = Boolean(
      currentActionRequired
      && actions.length === 0
      && movementRequest === null
    );
    const requiredActionNotAdmitted = Boolean(
      currentActionRequired
      && admittedActions.length === 0
      && admittedMovementRequest === null
    );
    const operatorIntentionEcho = Boolean(
      delegatedOperatorInstruction
      && response
      && delegatedOperatorInstruction.toLowerCase() === response.toLowerCase()
    );
    const outcome = motionStuck
      ? 'request_user'
      : actionAdmissionBlocked
      ? 'request_user'
      : complete
      ? 'complete'
      : prematureCompletionWithWork
      ? 'act'
      : !complete && (claimedComplete || proposedOutcome === 'complete')
        ? 'continue'
        : proposedOutcome;
    const responseStepComplete = Boolean(
      !terminal
      && response
      && actions.length === 0
      && !movementRequest
      && !effectiveClaimedComplete
      && (!currentActionRequired || actionAdmissionBlocked || motionStuck)
      && !operatorIntentionEcho
    );
    const stepResultReady = Boolean(terminal || responseStepComplete);
    const incomplete = Boolean(
      taskDecision
      && !complete
      && QUEUEABLE_OUTCOMES.has(outcome),
    );
    const queueSource = source === 'user' || source === 'autonomy' ? source : null;
    const continuationAuthorized = continuationPolicy === 'bounded';
    const shouldRefine = Boolean(
      stepResultReady
      && incomplete
      && continuationAuthorized
      && objective
      && queueSource
      && step < maxSteps
      && !complete
      && !actionAdmissionBlocked
      && !motionStuck,
    );
    const refinementReason = cleanText(
      visualAssessmentRejected ? evidenceAssessment?.reason : '',
      500,
    ) || cleanText(taskDecision?.reason, 500)
      || cleanText(terminal?.message, 500)
      || 'The current evidence does not complete the objective.';
    const currentInstruction = taskContract.currentInstruction
      || cleanText(inputs.instruction, 500)
      || objective;
    const refinementRequest: EnvironmentTaskRefinementRequest | null = shouldRefine
      ? {
          kind: 'environment_task_refinement_request',
          objective,
          currentInstruction,
          reason: refinementReason,
          source: queueSource!,
          mode,
          graph: cycle?.graph ?? config.environmentGraph,
          cycleId: cycle?.cycleId,
          step,
          maxSteps,
          continuationPolicy: 'bounded',
          requiredCompletionBasis,
          ...(taskContract.motionClass ? { motionClass: taskContract.motionClass } : {}),
          ...(motionControl ? { motionControl } : {}),
          requireExternalCompletionEvidence: externalCompletionEvidenceRequired,
          result: {
            outcome,
            terminalFeedback: terminal
              ? {
                  type: terminal.type,
                  message: cleanText(terminal.message, 500),
                  ...(terminal.actionId ? { actionId: terminal.actionId } : {}),
                }
              : null,
            completionEvidence: effectiveCompletionEvidence,
            visualEvidence: visualAssessmentRequired || visualAssessmentRejected
              ? {
                  verdict: evidenceAssessment?.verdict ?? 'uncertain',
                  reason: cleanText(evidenceAssessment?.reason, 500),
                  frameId: evidenceAssessment?.frameId ?? '',
                }
              : null,
          },
        }
      : null;

    let blockedReason = '';
    if (motionStuck) blockedReason = motionStuckReason;
    else if (actionAdmissionBlocked) blockedReason = actionAdmissionReason;
    else if (visualAssessmentRejected) blockedReason = 'visual_completion_unverified';
    else if (requiredActionMissing) blockedReason = 'required_action_missing';
    else if (effectiveClaimedComplete && !completionSupported && !oneShotTerminalComplete) blockedReason = 'objective_completion_unverified';
    else if (stepResultReady && incomplete && !objective) blockedReason = 'missing_objective';
    else if (stepResultReady && incomplete && !queueSource) blockedReason = `invalid_source_${source}`;
    else if (stepResultReady && incomplete && step >= maxSteps) blockedReason = 'step_limit';
    else if (stepResultReady && incomplete && !continuationAuthorized) blockedReason = 'continuation_not_authorized';
    else if (!currentActionsAllowed && actions.length > stopActions.length) blockedReason = 'current_action_conflicts_with_graph_decision';
    else if (taskDecisionError) blockedReason = 'invalid_task_decision';
    else if (operatorIntentionEcho) blockedReason = 'operator_intention_echo';

    const assessmentResponse = visualAssessmentRequired
      ? cleanText(evidenceAssessment?.response, 1_000)
      : '';
    const unverifiedCompletionClaim = Boolean(
      effectiveClaimedComplete
      && !completionSupported
      && !oneShotTerminalComplete
    );
    const responseSuppressed = Boolean(
      shouldRefine
      || (requiredActionNotAdmitted && !actionAdmissionBlocked && !motionStuck)
      || unverifiedCompletionClaim
      || operatorIntentionEcho
    );
    const visibleResponse = shouldRefine
      ? ''
      : assessedVisualCompletion && !claimedComplete
        ? assessmentResponse || cleanText(evidenceAssessment?.reason, 1_000)
        : visualAssessmentRejected
        ? assessmentResponse
        : responseSuppressed
          ? ''
          : response;

    return {
      actions: admittedActions,
      movementRequest: admittedMovementRequest,
      response: visibleResponse,
      decision: {
        kind: 'environment_task_lifecycle',
        owner: 'environment-task-validator',
        cycleId: cycle?.cycleId ?? (cleanText(commandMetadata?.cycleId, 200) || null),
        step,
        maxSteps,
        outcome,
        complete,
        explicit: explicitDecision,
        reason: assessedVisualCompletion
          ? cleanText(evidenceAssessment?.reason, 500)
          : cleanText(taskDecision?.reason, 500),
        mode,
        source,
        objective,
        stepComplete: stepResultReady,
        continuationPolicy,
        requiredCompletionBasis,
        motionClass: taskContract.motionClass ?? null,
        actionAdmission,
        motionControl,
        motionControlResult,
        activeViewProgress,
        taskContractSource: taskDecision?.taskContractSource ?? null,
        taskContractConflict: taskDecision?.taskContractConflict ?? null,
        externalCompletionEvidenceRequired,
        completionBasis: oneShotTerminalComplete ? 'action_result' : assessedCompletionBasis ?? 'none',
        completionEvidence: effectiveCompletionEvidence,
        completionVerified: complete,
        evidenceAssessment: visualAssessmentRequired
          ? {
              verdict: evidenceAssessment?.verdict ?? 'missing',
              valid: evidenceAssessment?.valid === true,
              frameId: evidenceAssessment?.frameId ?? null,
            }
          : null,
        terminalFeedback: terminal?.type ?? null,
        blockedReason,
        admittedActionCount: admittedActions.length,
        actionRequired: currentActionRequired,
        operatorIntentionEcho,
        responseSuppressed,
        refinementRequested: shouldRefine,
      },
      outcome,
      complete,
      refinementRequest,
      shouldRefine,
      taskInstruction: objective
        ? encodeEnvironmentTaskInstruction({
            objective,
            currentInstruction: cleanText(inputs.instruction, 500) || undefined,
            continuationPolicy,
            requiredCompletionBasis,
            ...(taskContract.motionClass ? { motionClass: taskContract.motionClass } : {}),
          })
        : '',
    };
  },
});
