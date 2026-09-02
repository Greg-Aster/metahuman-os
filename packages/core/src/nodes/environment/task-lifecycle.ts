import {
  validEnvironmentJpegDataUrl,
  type EnvironmentAction,
  type EnvironmentFeedback,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import type {
  EnvironmentActionPurpose,
  EnvironmentCompletionBasis,
  EnvironmentMovementRequest,
  EnvironmentPendingMovementContract,
  EnvironmentTaskDecision,
  EnvironmentTaskFrameRef,
  EnvironmentTaskSelectedAction,
  EnvironmentTaskState,
  EnvironmentVisualEvidenceMode,
} from './helpers.js';

export function isEnvironmentRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cleanEnvironmentText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

export function environmentTaskFrameRef(
  frame: EnvironmentVisualFrame | undefined,
): EnvironmentTaskFrameRef | undefined {
  if (!frame?.id || !frame.timestamp) return undefined;
  const correlationId = cleanEnvironmentText(frame.metadata?.correlationId, 200);
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    ...(frame.source ? { source: frame.source } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

export function environmentSelectedAction(
  action: Partial<EnvironmentAction> | undefined,
): EnvironmentTaskSelectedAction | undefined {
  if (!action?.type) return undefined;
  const command = cleanEnvironmentText(action.command, 200);
  const direction = cleanEnvironmentText(action.direction, 40);
  const target = cleanEnvironmentText(action.target, 200);
  const description = cleanEnvironmentText(action.metadata?.motionSummary, 500);
  return {
    type: action.type,
    ...(command ? { command } : {}),
    ...(direction ? { direction } : {}),
    ...(target ? { target } : {}),
    ...(description ? { description } : {}),
  };
}

export function environmentMovementPreparationRequest(
  action: Partial<EnvironmentAction> | undefined,
): EnvironmentMovementRequest | null {
  const preparation = isEnvironmentRecord(action?.metadata?.motionPreparation)
    ? action.metadata.motionPreparation
    : null;
  const request = isEnvironmentRecord(preparation?.movementRequest)
    ? preparation.movementRequest
    : null;
  const description = cleanEnvironmentText(request?.description, 500);
  const sessionId = cleanEnvironmentText(request?.sessionId, 200);
  if (
    preparation?.version !== 1
    || preparation.kind !== 'stand_before_freestyle'
    || action?.type !== 'robotCommand'
    || action.command !== 'stand'
    || !description
    || request?.motionClass !== 'body_local'
  ) return null;
  return {
    description,
    ...(sessionId ? { sessionId } : {}),
    motionClass: 'body_local',
  };
}

function terminalCommand(feedback: EnvironmentFeedback | null): string {
  return cleanEnvironmentText(feedback?.data?.command, 200);
}

export function environmentCompletionInstruction(
  state: EnvironmentTaskState,
  terminal: EnvironmentFeedback,
): string {
  return `EnvironmentCompletionEvent:${JSON.stringify({
    objective: state.objective,
    action: state.selectedAction ?? null,
    result: {
      type: terminal.type,
      actionId: terminal.actionId ?? null,
      message: cleanEnvironmentText(terminal.message, 500),
    },
    lifecycle: {
      objectiveComplete: true,
      completionBasis: 'action_result',
      outwardResponseOptional: true,
    },
    reporting: {
      attribution: 'Distinguish the original objective from the action selected by Environment Action Selector. Do not say the user requested the exact selected action unless the objective actually did.',
      response: 'An outward response is optional. If you provide one, ground it in the exact selected action and terminal result.',
    },
  })}`;
}

export function environmentFeedbackInstruction(
  state: EnvironmentTaskState,
  terminal: EnvironmentFeedback,
  frames: EnvironmentVisualFrame[],
): string {
  const command = terminalCommand(terminal) || state.selectedAction?.command || state.selectedAction?.type || 'unknown';
  const visualMode = state.visualEvidenceMode ?? 'single';
  const currentFrame = currentEnvironmentEvidenceFrame(frames);
  const boundedActionResult = terminal.type === 'completed'
    && state.continuationPolicy === 'bounded'
    && state.requiredCompletionBasis === 'action_result';
  const requiredEvidenceInstruction = boundedActionResult
    ? 'Required whole-objective evidence: action_result. The exact correlated result verifies the selected action.'
    : `Required whole-objective evidence: ${state.requiredCompletionBasis}.`;
  const evidenceInstruction = boundedActionResult
    ? 'Review what the verified action changes for this evolving objective. One completed consequence does not end an autonomous episode by itself. If the objective is genuinely fulfilled, set outcome=complete and objectiveComplete=true with a meaningful response. Otherwise preserve or revise the objective and select the next advertised consequence now. Require another image only when the objective actually depends on new visual evidence.'
    : state.requiredCompletionBasis === 'visual_observation'
      ? visualMode === 'comparison'
        ? frames.length >= 2
          ? 'Two images are attached in chronological order: the baseline before the action, then the current correlated result. Compare them directly.'
          : 'A before/after comparison is required, but both correlated images are not available. Do not claim a visual change without both images.'
        : frames.length >= 1
          ? `The current correlated result image is attached as frame ${currentFrame?.id || 'unknown'}. Complete only if this image visibly satisfies the stopping condition. Set completionEvidence to a short visual description that cites that exact frame id.`
          : 'The required current correlated image is unavailable. Do not claim visual completion.'
      : '';
  return [
    `Original objective: ${state.objective}`,
    terminal.type === 'completed' && state.requiredCompletionBasis === 'visual_observation'
      ? `The previously selected ${command} action returned a correlated camera result. Motor completion only means the command finished; it is not visual evidence that the stopping condition was met.`
      : `Exact terminal feedback: type=${terminal.type}; actionId=${terminal.actionId}; command=${command}; message=${cleanEnvironmentText(terminal.message, 500)}`,
    requiredEvidenceInstruction,
    evidenceInstruction,
    'Evaluate the objective from the correlated evidence and decide whether to complete it, preserve it, or revise it with another supported action.',
    terminal.type === 'completed'
      ? 'Decide whether the original objective is complete from the required evidence. If it is incomplete, select the next advertised action directly in this response.'
      : 'The action did not complete successfully. Decide whether to select a different advertised action now or report the limitation honestly.',
    'Do not narrate a future action without returning that action in actions[] or movementRequest.',
  ].filter(Boolean).join('\n');
}

export function environmentEvidenceMode(
  decision: EnvironmentTaskDecision | null,
  state: EnvironmentTaskState,
  requiredBasis: EnvironmentCompletionBasis,
  contractLocked = false,
): EnvironmentVisualEvidenceMode | undefined {
  if (requiredBasis !== 'visual_observation') return undefined;
  if (contractLocked && state.visualEvidenceMode) return state.visualEvidenceMode;
  if (decision?.visualEvidenceMode) return decision.visualEvidenceMode;
  if (state.visualEvidenceMode) return state.visualEvidenceMode;
  return 'single';
}

export function currentEnvironmentEvidenceFrame(
  frames: EnvironmentVisualFrame[],
): EnvironmentVisualFrame | undefined {
  return [...frames].reverse().find(frame => validEnvironmentJpegDataUrl(frame.dataUrl));
}

export function environmentVisualEvidenceAvailable(
  mode: EnvironmentVisualEvidenceMode | undefined,
  state: EnvironmentTaskState,
  frames: EnvironmentVisualFrame[],
): boolean {
  const current = currentEnvironmentEvidenceFrame(frames);
  if (!current) return false;
  if (mode !== 'comparison') return true;
  return Boolean(
    state.baselineFrame
    && state.baselineFrame.id !== current.id
    && frames.some(frame => (
      frame.id === state.baselineFrame?.id
      && validEnvironmentJpegDataUrl(frame.dataUrl)
    )),
  );
}

export function environmentLifecycleDecision(
  state: EnvironmentTaskState,
  details: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: 'environment_task_state',
    owner: 'environment-task-reducer',
    version: 1,
    objective: state.objective,
    phase: state.phase,
    step: state.step,
    continuationPolicy: state.continuationPolicy,
    requiredCompletionBasis: state.requiredCompletionBasis,
    motionClass: state.motionClass ?? null,
    actionPurpose: state.actionPurpose ?? null,
    visualEvidenceMode: state.visualEvidenceMode ?? null,
    ...details,
  };
}

export type { EnvironmentPendingMovementContract };
