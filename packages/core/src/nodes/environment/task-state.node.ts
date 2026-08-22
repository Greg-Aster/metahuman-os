import { defineNode } from '../types.js';
import {
  validEnvironmentJpegDataUrl,
  type EnvironmentAction,
  type EnvironmentFeedback,
  type EnvironmentObservation,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { loadRobotOperatorConfig, readRobotObserverCycle } from '../../robot-operator.js';
import {
  encodeEnvironmentTaskState,
  environmentTaskStateFromObservation,
  robotOperatorActionRequirement,
  type EnvironmentCompletionBasis,
  type EnvironmentTaskDecision,
  type EnvironmentTaskFrameRef,
  type EnvironmentTaskSelectedAction,
  type EnvironmentTaskState,
  type EnvironmentVisualEvidenceMode,
} from './helpers.js';

const TERMINAL_TYPES = new Set<EnvironmentFeedback['type']>([
  'completed',
  'rejected',
  'cancelled',
  'expired',
  'failed',
]);
const MAX_CACHED_FRAMES = 24;
const frameCache = new Map<string, EnvironmentVisualFrame>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function framesFromObservation(observation: EnvironmentObservation | null): EnvironmentVisualFrame[] {
  if (!observation) return [];
  const frames = [observation.visual, ...(observation.visuals ?? [])]
    .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame));
  const seen = new Set<string>();
  return frames.filter(frame => {
    const key = frame.id || frame.dataUrl || frame.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rememberFrames(frames: EnvironmentVisualFrame[]): void {
  for (const frame of frames) {
    if (!frame.id || !validEnvironmentJpegDataUrl(frame.dataUrl)) continue;
    frameCache.delete(frame.id);
    frameCache.set(frame.id, frame);
  }
  while (frameCache.size > MAX_CACHED_FRAMES) {
    const oldest = frameCache.keys().next().value;
    if (typeof oldest !== 'string') break;
    frameCache.delete(oldest);
  }
}

export function clearEnvironmentTaskFrameCache(): void {
  frameCache.clear();
}

function frameRef(frame: EnvironmentVisualFrame | undefined): EnvironmentTaskFrameRef | undefined {
  if (!frame?.id || !frame.timestamp) return undefined;
  const correlationId = typeof frame.metadata?.correlationId === 'string'
    ? frame.metadata.correlationId
    : '';
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    ...(frame.source ? { source: frame.source } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function selectedAction(action: Partial<EnvironmentAction> | undefined): EnvironmentTaskSelectedAction | undefined {
  if (!action?.type) return undefined;
  const command = cleanText(action.command, 200);
  const direction = cleanText(action.direction, 40);
  const target = cleanText(action.target, 200);
  return {
    type: action.type,
    ...(command ? { command } : {}),
    ...(direction ? { direction } : {}),
    ...(target ? { target } : {}),
  };
}

export function matchingEnvironmentTerminalFeedback(
  observation: EnvironmentObservation | null | undefined,
): EnvironmentFeedback | null {
  if (!observation) return null;
  const expectedActionId = cleanText(observation.metadata?.actionId, 200);
  if (!expectedActionId) return null;
  for (let index = (observation.feedback?.length ?? 0) - 1; index >= 0; index -= 1) {
    const candidate = observation.feedback?.[index];
    if (
      candidate
      && TERMINAL_TYPES.has(candidate.type)
      && candidate.actionId === expectedActionId
    ) return candidate;
  }
  return null;
}

function currentCorrelatedFrame(
  observation: EnvironmentObservation | null,
  frames: EnvironmentVisualFrame[],
): EnvironmentVisualFrame | undefined {
  const actionId = cleanText(observation?.metadata?.actionId, 200);
  const correlationId = cleanText(observation?.metadata?.correlationId, 200);
  return [...frames].reverse().find(frame => {
    if (!validEnvironmentJpegDataUrl(frame.dataUrl)) return false;
    const frameActionId = cleanText(frame.metadata?.actionId, 200);
    const frameCorrelationId = cleanText(frame.metadata?.correlationId, 200);
    return Boolean(
      (actionId && frameActionId === actionId)
      || (correlationId && frameCorrelationId === correlationId)
    );
  });
}

function initialTaskState(
  instruction: string,
  observation: EnvironmentObservation | null,
): EnvironmentTaskState {
  const cycle = readRobotObserverCycle(observation ?? undefined);
  const configuredMaxSteps = loadRobotOperatorConfig().maxCycleSteps;
  const baseline = framesFromObservation(observation).find(frame => validEnvironmentJpegDataUrl(frame.dataUrl));
  return {
    version: 1,
    objective: instruction || 'Respond to the current environment input.',
    phase: 'new',
    step: 0,
    maxSteps: cycle?.maxSteps ?? configuredMaxSteps,
    continuationPolicy: 'none',
    requiredCompletionBasis: 'response',
    ...(frameRef(baseline) ? { baselineFrame: frameRef(baseline) } : {}),
  };
}

function terminalCommand(feedback: EnvironmentFeedback | null): string {
  return cleanText(feedback?.data?.command, 200);
}

function completionResponse(state: EnvironmentTaskState, terminal: EnvironmentFeedback): string {
  const action = cleanText(
    state.selectedAction?.command || state.selectedAction?.type,
    200,
  ).replace(/_/g, ' ');
  const objective = cleanText(state.objective, 500);
  const evidence = cleanText(terminal.message, 500) || 'The correlated robot action completed.';
  return JSON.stringify({
    response: action
      ? `The ${action} action finished successfully, which satisfies the one-step objective: ${objective}`
      : `The requested one-step action finished successfully, which satisfies the objective: ${objective}`,
    actions: [],
    movementRequest: null,
    taskDecision: {
      outcome: 'complete',
      reason: `The exact correlated action result is sufficient for this one-step objective: ${evidence}`,
      objectiveComplete: true,
      continuationPolicy: state.continuationPolicy,
      requiredCompletionBasis: 'action_result',
      completionBasis: 'action_result',
      completionEvidence: evidence,
      ...(state.motionClass ? { motionClass: state.motionClass } : {}),
    },
  });
}

function feedbackInstruction(
  state: EnvironmentTaskState,
  terminal: EnvironmentFeedback,
  visuals: EnvironmentVisualFrame[],
  hasCurrentCorrelatedVisual: boolean,
): string {
  const command = terminalCommand(terminal) || state.selectedAction?.command || state.selectedAction?.type || 'unknown';
  const visualMode = state.visualEvidenceMode ?? 'single';
  const boundedActionResult = terminal.type === 'completed'
    && state.continuationPolicy === 'bounded'
    && state.requiredCompletionBasis === 'action_result';
  const requiredEvidenceInstruction = boundedActionResult
    ? 'The prior bounded step recorded action_result, but that can prove only the completed step. Select the evidence basis that can prove the whole objective in this response.'
    : `Required whole-objective evidence: ${state.requiredCompletionBasis}.`;
  const evidenceInstruction = boundedActionResult
    ? hasCurrentCorrelatedVisual
      ? 'The completed action proves only that step, not the bounded objective. A fresh correlated robot-camera image is attached. Inspect it, then either select the next action or explain why suitable whole-objective evidence shows that no further attention is necessary.'
      : 'The completed action proves only that step, not the bounded objective. No fresh correlated robot-camera image is available. Select captureImage if current visual evidence is necessary, or select another suitable advertised action.'
    : state.requiredCompletionBasis === 'visual_observation'
    ? visualMode === 'comparison'
      ? visuals.length >= 2
        ? 'Two images are attached in chronological order: the baseline before the action, then the current correlated result. Compare them directly.'
        : 'A before/after comparison is required, but both correlated images are not available. Do not claim a visual change without both images.'
      : visuals.length >= 1
        ? 'The current correlated result image is attached and may be used as direct visual evidence.'
        : 'The required current correlated image is unavailable. Do not claim visual completion.'
    : '';
  return [
    `Original objective: ${state.objective}`,
    `Exact terminal feedback: type=${terminal.type}; actionId=${terminal.actionId}; command=${command}; message=${cleanText(terminal.message, 500)}`,
    `Action budget: ${state.step} of ${state.maxSteps} used. This is a safety ceiling, not a success condition.`,
    requiredEvidenceInstruction,
    evidenceInstruction,
    'Evaluate the objective\'s observable stopping condition. Do not continue merely because unseen areas might still exist or certainty could be improved indefinitely. For a broad survey without a finite stopping condition, report what the bounded current evidence supports and stop rather than inventing perpetual coverage.',
    terminal.type === 'completed'
      ? 'Decide whether the original objective is complete from the required evidence. If it is incomplete, select the next advertised action directly in this response.'
      : 'The action did not complete successfully. Decide whether to select a different advertised action now or report the limitation honestly.',
    'Do not narrate a future action without returning that action in actions[] or movementRequest.',
  ].filter(Boolean).join('\n');
}

function evidenceMode(
  decision: EnvironmentTaskDecision | null,
  state: EnvironmentTaskState,
  action: Partial<EnvironmentAction> | undefined,
  requiredBasis: EnvironmentCompletionBasis,
): EnvironmentVisualEvidenceMode | undefined {
  if (requiredBasis !== 'visual_observation') return undefined;
  if (decision?.visualEvidenceMode) return decision.visualEvidenceMode;
  if (state.visualEvidenceMode) return state.visualEvidenceMode;
  return action?.type === 'captureImage' ? 'single' : 'comparison';
}

function visualEvidenceAvailable(
  mode: EnvironmentVisualEvidenceMode | undefined,
  state: EnvironmentTaskState,
  observation: EnvironmentObservation | null,
  frames: EnvironmentVisualFrame[],
): boolean {
  const current = currentCorrelatedFrame(observation, frames);
  if (!current) return false;
  if (mode !== 'comparison') return true;
  return Boolean(
    state.baselineFrame
    && state.baselineFrame.id !== current.id
    && frames.some(frame => frame.id === state.baselineFrame?.id && validEnvironmentJpegDataUrl(frame.dataUrl))
  );
}

function lifecycleDecision(
  state: EnvironmentTaskState,
  details: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: 'environment_task_state',
    owner: 'environment-task-state',
    version: 1,
    objective: state.objective,
    phase: state.phase,
    step: state.step,
    maxSteps: state.maxSteps,
    continuationPolicy: state.continuationPolicy,
    requiredCompletionBasis: state.requiredCompletionBasis,
    motionClass: state.motionClass ?? null,
    visualEvidenceMode: state.visualEvidenceMode ?? null,
    ...details,
  };
}

export const environmentTaskStateNode = defineNode({
  id: 'environment_task_state',
  name: 'Environment Task State',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', optional: true, description: 'Current correlated environment observation' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current user instruction or feedback envelope' },
    { name: 'taskState', type: 'object', optional: true, description: 'Prepared task state for the reduce phase' },
    { name: 'actions', type: 'array', optional: true, description: 'Capability-validated semantic actions' },
    { name: 'movementRequest', type: 'object', optional: true, description: 'Body-local movement request' },
    { name: 'generatedActions', type: 'array', optional: true, description: 'Movement Generator result' },
    { name: 'generatedResponse', type: 'string', optional: true, description: 'Movement Generator response' },
    { name: 'response', type: 'string', optional: true, description: 'Environment LLM conversational response' },
    { name: 'taskDecision', type: 'object', optional: true, description: 'Environment LLM task decision' },
    { name: 'taskDecisionError', type: 'string', optional: true, description: 'Task decision parse failure' },
    { name: 'actionAdmission', type: 'object', optional: true, description: 'Capability validation result' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated baseline/current visual frames' },
  ],
  outputs: [
    { name: 'taskState', type: 'object', description: 'The single typed lifecycle state' },
    { name: 'instruction', type: 'string', description: 'Task-state-grounded model instruction' },
    { name: 'routingAnalysis', type: 'object', description: 'Deterministic context admission policy' },
    { name: 'memoryHints', type: 'object', description: 'Deterministic memory retrieval policy' },
    { name: 'visuals', type: 'array', description: 'Current frame or ordered before/after frames' },
    { name: 'precomputedResponse', type: 'string', description: 'Deterministic exact-result closure, otherwise empty' },
    { name: 'actions', type: 'array', description: 'At most one admitted action for this objective step' },
    { name: 'movementRequest', type: 'object', description: 'Always null after reduction; generated motion is emitted as an action' },
    { name: 'response', type: 'string', description: 'Visible response or explicit failure diagnostic' },
    { name: 'decision', type: 'object', description: 'Typed lifecycle decision' },
    { name: 'taskInstruction', type: 'string', description: 'Serialized state persisted with the selected action' },
    { name: 'complete', type: 'boolean', description: 'Whether the whole objective is complete' },
  ],
  properties: {
    phase: 'prepare',
  },
  propertySchemas: {
    phase: {
      type: 'select',
      default: 'prepare',
      label: 'Lifecycle Phase',
      options: ['prepare', 'reduce'],
    },
  },
  description: 'Owns task preparation, exact terminal closure, evidence requirements, bounded retries, and final action admission.',
  async execute(inputs, context, properties) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction, 4_000);
    const observedFrames = framesFromObservation(observation);
    rememberFrames(observedFrames);

    if (properties?.phase !== 'reduce') {
      const currentUserInstruction = cleanText(context.userMessage, 4_000);
      const persisted = currentUserInstruction
        ? null
        : environmentTaskStateFromObservation(observation);
      const state = persisted ?? initialTaskState(instruction, observation);
      const terminal = persisted
        ? matchingEnvironmentTerminalFeedback(observation)
        : null;
      const baseline = state.baselineFrame
        ? frameCache.get(state.baselineFrame.id)
        : undefined;
      const current = terminal
        ? currentCorrelatedFrame(observation, observedFrames)
        : observedFrames.find(frame => validEnvironmentJpegDataUrl(frame.dataUrl));
      const visuals = [baseline, current]
        .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
        .filter((frame, index, all) => all.findIndex(candidate => candidate.id === frame.id) === index);
      const feedbackPass = Boolean(terminal && persisted);
      const operatorActionRequired = feedbackPass
        ? null
        : robotOperatorActionRequirement(observation);
      const needsMemory = Boolean(!feedbackPass && cleanText(context.userMessage, 4_000));
      const needsVision = feedbackPass
        ? state.requiredCompletionBasis === 'visual_observation'
          || Boolean(terminal?.type === 'completed' && state.continuationPolicy === 'bounded')
        : operatorActionRequired === true && Boolean(current);
      const preparedState: EnvironmentTaskState = feedbackPass
        ? {
            ...state,
            phase: state.requiredCompletionBasis === 'action_result'
              && state.continuationPolicy === 'none'
              ? 'awaiting_action'
              : 'evaluating_evidence',
          }
        : state;
      const deterministicComplete = Boolean(
        terminal?.type === 'completed'
        && preparedState.requiredCompletionBasis === 'action_result'
        && preparedState.continuationPolicy === 'none'
      );
      return {
        taskState: preparedState,
        instruction: terminal
          ? feedbackInstruction(preparedState, terminal, visuals, Boolean(current))
          : operatorActionRequired === true
            ? [
                instruction,
                'Robot Operator delegated this intention because it requires one new sensing or environment action. Select one safe advertised action that advances the intention now. If no advertised action can do so safely, explain that limitation instead of returning an empty result.',
              ].filter(Boolean).join('\n\n')
            : instruction,
        routingAnalysis: {
          needsMemory,
          memoryTier: 'hot',
          memoryQuery: needsMemory ? instruction : '',
          memoryTypes: [],
          needsEnvironment: true,
          needsVision,
          needsAction: operatorActionRequired === true,
          actionType: operatorActionRequired === true ? 'environment_action' : 'none',
          actionParams: {
            continuationPolicy: preparedState.continuationPolicy,
            requiredCompletionBasis: preparedState.requiredCompletionBasis,
            ...(preparedState.motionClass ? { motionClass: preparedState.motionClass } : {}),
          },
          complexity: 0.2,
          responseStyle: 'conversational',
          responseLength: 'brief',
          isFollowUp: !feedbackPass,
          emotionalTone: 'neutral',
        },
        memoryHints: {
          needsMemory,
          memoryTier: 'hot',
          memoryQuery: needsMemory ? instruction : '',
          memoryTypes: [],
        },
        visuals,
        precomputedResponse: deterministicComplete && terminal
          ? completionResponse(preparedState, terminal)
          : '',
        terminalFeedback: terminal,
        deterministicComplete,
        actions: [],
        movementRequest: null,
        response: '',
        decision: lifecycleDecision(preparedState, { prepared: true, deterministicComplete }),
        taskInstruction: '',
        complete: deterministicComplete,
      };
    }

    const preparedState = isRecord(inputs.taskState)
      ? inputs.taskState as unknown as EnvironmentTaskState
      : environmentTaskStateFromObservation(observation) ?? initialTaskState(instruction, observation);
    const terminal = matchingEnvironmentTerminalFeedback(observation);
    if (
      terminal?.type === 'completed'
      && preparedState.requiredCompletionBasis === 'action_result'
      && preparedState.continuationPolicy === 'none'
    ) {
      const exactResponse = completionResponse(preparedState, terminal);
      const completeState: EnvironmentTaskState = { ...preparedState, phase: 'complete' };
      return {
        taskState: completeState,
        instruction,
        routingAnalysis: {},
        memoryHints: { needsMemory: false },
        visuals: observedFrames,
        precomputedResponse: '',
        actions: [],
        movementRequest: null,
        response: cleanText(inputs.response, 4_000) || JSON.parse(exactResponse).response,
        decision: lifecycleDecision(completeState, {
          complete: true,
          completionBasis: 'action_result',
          completionEvidence: cleanText(terminal.message, 500),
          terminalFeedback: terminal.type,
          actionId: terminal.actionId ?? null,
        }),
        taskInstruction: '',
        complete: true,
      };
    }

    const parsedActions = Array.isArray(inputs.actions)
      ? inputs.actions.filter(isRecord) as Array<Partial<EnvironmentAction>>
      : [];
    const generatedActions = Array.isArray(inputs.generatedActions)
      ? inputs.generatedActions.filter(isRecord) as Array<Partial<EnvironmentAction>>
      : [];
    const actionAdmission = isRecord(inputs.actionAdmission) ? inputs.actionAdmission : null;
    const admissionBlocked = actionAdmission?.admitted === false;
    const candidateActions = admissionBlocked
      ? []
      : (parsedActions.length > 0 ? parsedActions : generatedActions).slice(0, 1);
    const action = candidateActions[0];
    const taskDecision = isRecord(inputs.taskDecision)
      ? inputs.taskDecision as unknown as EnvironmentTaskDecision
      : null;
    const taskDecisionError = cleanText(inputs.taskDecisionError, 500);
    const generatedResponse = cleanText(inputs.generatedResponse, 2_000);
    const modelResponse = cleanText(inputs.response, 4_000) || generatedResponse;
    const operatorActionRequired = robotOperatorActionRequirement(observation) === true;
    const persistedPass = Boolean(terminal && environmentTaskStateFromObservation(observation));
    const boundedFeedbackPass = Boolean(persistedPass && preparedState.continuationPolicy === 'bounded');
    let requiredCompletionBasis: Exclude<EnvironmentCompletionBasis, 'none'> = persistedPass && !boundedFeedbackPass
      ? preparedState.requiredCompletionBasis
      : taskDecision?.requiredCompletionBasis && taskDecision.requiredCompletionBasis !== 'none'
        ? taskDecision.requiredCompletionBasis
        : action
          ? 'action_result'
          : 'response';
    if (action && requiredCompletionBasis === 'response') requiredCompletionBasis = 'action_result';
    const continuationPolicy = persistedPass && !boundedFeedbackPass
      ? preparedState.continuationPolicy
      : taskDecision?.continuationPolicy ?? (requiredCompletionBasis === 'action_result' ? 'none' : 'bounded');
    const motionClass = taskDecision?.motionClass ?? preparedState.motionClass;
    const visualEvidenceMode = evidenceMode(
      taskDecision,
      preparedState,
      action,
      requiredCompletionBasis,
    );
    const nextStep = preparedState.step + (action ? 1 : 0);
    const atStepLimit = Boolean(action && nextStep > preparedState.maxSteps);
    const admittedActions = atStepLimit ? [] : candidateActions;
    const actionQueued = admittedActions.length > 0;
    const baselineFrame = preparedState.baselineFrame
      ?? frameRef(observedFrames.find(frame => validEnvironmentJpegDataUrl(frame.dataUrl)));
    const nextState: EnvironmentTaskState = {
      ...preparedState,
      phase: actionQueued ? 'awaiting_action' : preparedState.phase,
      step: actionQueued ? nextStep : preparedState.step,
      continuationPolicy,
      requiredCompletionBasis,
      ...(motionClass ? { motionClass } : {}),
      ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
      ...(baselineFrame ? { baselineFrame } : {}),
      ...(actionQueued && selectedAction(admittedActions[0])
        ? { selectedAction: selectedAction(admittedActions[0]) }
        : {}),
    };

    if (actionQueued) {
      const visibleResponse = modelResponse || 'Executing the requested robot action.';
      return {
        taskState: nextState,
        instruction,
        routingAnalysis: {},
        memoryHints: { needsMemory: false },
        visuals: observedFrames,
        precomputedResponse: '',
        actions: admittedActions,
        movementRequest: null,
        response: visibleResponse,
        decision: lifecycleDecision(nextState, {
          complete: false,
          actionQueued: true,
          admittedActionCount: admittedActions.length,
          terminalFeedback: terminal?.type ?? null,
          actionId: terminal?.actionId ?? null,
        }),
        taskInstruction: encodeEnvironmentTaskState(nextState),
        complete: false,
      };
    }

    const claimedComplete = taskDecision?.objectiveComplete === true || taskDecision?.outcome === 'complete';
    const completionBasis = taskDecision?.completionBasis;
    const visualAvailable = visualEvidenceAvailable(
      visualEvidenceMode,
      preparedState,
      observation,
      Array.isArray(inputs.frames)
        ? inputs.frames.filter(isRecord) as unknown as EnvironmentVisualFrame[]
        : observedFrames,
    );
    const completionEvidenceAvailable = requiredCompletionBasis === 'response'
      ? Boolean(modelResponse)
      : requiredCompletionBasis === 'visual_observation'
        ? visualAvailable
        : requiredCompletionBasis === 'environment_state'
          ? Boolean(observation?.state && Object.keys(observation.state).length > 0)
          : requiredCompletionBasis === 'user_input'
            ? Boolean(cleanText(context.userMessage, 4_000))
            : false;
    const complete = Boolean(
      claimedComplete
      && completionBasis === requiredCompletionBasis
      && completionEvidenceAvailable
    ) || Boolean(
      !terminal
      && !action
      && modelResponse
      && requiredCompletionBasis === 'response'
    );
    const finalState: EnvironmentTaskState = {
      ...nextState,
      phase: complete ? 'complete' : 'blocked',
    };
    const fallbackResponse = atStepLimit
      ? `I could not complete the objective within the ${preparedState.maxSteps}-action safety limit, so I stopped.`
      : admissionBlocked
        ? modelResponse || 'The selected robot action is not available on the connected robot.'
        : taskDecisionError
          ? `I received the request, but the Environment LLM returned an invalid task decision: ${taskDecisionError}`
          : modelResponse
            ? modelResponse
            : operatorActionRequired
              ? 'I could not select a safe supported action for this Robot Operator intention, so I stopped rather than guessing.'
              : terminal
                ? 'The robot result arrived, but I could not determine a usable completion or next action.'
                : 'I received the request, but the Environment LLM produced neither a response nor an executable robot action.';
    return {
      taskState: finalState,
      instruction,
      routingAnalysis: {},
      memoryHints: { needsMemory: false },
      visuals: observedFrames,
      precomputedResponse: '',
      actions: [],
      movementRequest: null,
      response: fallbackResponse,
      decision: lifecycleDecision(finalState, {
        complete,
        actionQueued: false,
        admittedActionCount: 0,
        terminalFeedback: terminal?.type ?? null,
        actionId: terminal?.actionId ?? null,
        completionBasis: complete ? requiredCompletionBasis : completionBasis ?? 'none',
        completionEvidence: complete ? cleanText(taskDecision?.completionEvidence, 500) : '',
        blockedReason: complete
          ? ''
          : atStepLimit
            ? 'step_limit'
            : admissionBlocked
              ? cleanText(actionAdmission?.reason, 200) || 'action_not_admitted'
              : requiredCompletionBasis === 'visual_observation' && !visualAvailable
                ? 'visual_evidence_unavailable'
                : taskDecisionError
                  ? 'invalid_task_decision'
                  : 'no_completion_or_action',
      }),
      taskInstruction: '',
      complete,
    };
  },
});
