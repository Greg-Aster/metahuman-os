import {
  ENVIRONMENT_MOTION_CLASSES,
  normalizeEnvironmentVisualInspectionTarget,
  normalizeEnvironmentVisualTarget,
  type EnvironmentAction,
  type EnvironmentActionType,
  type EnvironmentMotionClass,
  type EnvironmentObservation,
  type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';

// robotMotionPlan is intentionally excluded. Only Movement Generator may create it.
const DIRECT_ACTION_TYPES = new Set<EnvironmentActionType>([
  'move',
  'look',
  'jump',
  'interact',
  'stop',
  'captureImage',
  'robotCommand',
  'inspect',
  'visualApproach',
  'sendText',
]);
const PERSISTED_ACTION_TYPES = new Set<EnvironmentActionType>([
  ...DIRECT_ACTION_TYPES,
  'robotMotionPlan',
  'speak',
]);

export interface EnvironmentMovementRequest {
  description: string;
  sessionId?: string;
  /** Environment LLM-owned motion reference; never authored by the movement model. */
  motionClass: Extract<EnvironmentMotionClass, 'body_local'>;
}

export const ENVIRONMENT_TASK_OUTCOMES = [
  'complete',
  'continue',
  'observe',
  'act',
  'report',
  'curiosity',
  'background',
  'request_user',
  'wait',
] as const;

export type EnvironmentTaskOutcome = typeof ENVIRONMENT_TASK_OUTCOMES[number];

export const ENVIRONMENT_COMPLETION_BASES = [
  'none',
  'response',
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const;

export type EnvironmentCompletionBasis = typeof ENVIRONMENT_COMPLETION_BASES[number];

export const ENVIRONMENT_CONTINUATION_POLICIES = ['none', 'bounded'] as const;

export type EnvironmentContinuationPolicy = typeof ENVIRONMENT_CONTINUATION_POLICIES[number];

export const ENVIRONMENT_ACTION_PURPOSES = [
  'expression',
  'information_gain',
  'task_effect',
] as const;

export type EnvironmentActionPurpose = typeof ENVIRONMENT_ACTION_PURPOSES[number];

export interface EnvironmentTaskContract {
  objective: string;
  currentInstruction?: string;
  continuationPolicy: EnvironmentContinuationPolicy;
  requiredCompletionBasis: EnvironmentCompletionBasis;
  /** Absent only on legacy or non-motion contracts. */
  motionClass?: EnvironmentMotionClass;
  actionPurpose?: EnvironmentActionPurpose;
  visualEvidenceMode?: EnvironmentVisualEvidenceMode;
}

export type EnvironmentVisualEvidenceMode = 'single' | 'comparison';

export interface EnvironmentTaskFrameRef {
  id: string;
  timestamp: string;
  source?: string;
  correlationId?: string;
}

export interface EnvironmentTaskSelectedAction {
  type: EnvironmentActionType;
  command?: string;
  direction?: string;
  target?: string;
  description?: string;
}

export type EnvironmentTaskPhase =
  | 'new'
  | 'awaiting_action'
  | 'evaluating_evidence'
  | 'complete'
  | 'blocked';

/**
 * The one persisted lifecycle record for an Environment objective.
 *
 * It intentionally stores semantic state and frame references only. Image data
 * remains in the bounded in-process frame cache owned by the task-state node.
 */
export interface EnvironmentTaskState {
  version: 1;
  objective: string;
  phase: EnvironmentTaskPhase;
  step: number;
  maxSteps: number;
  continuationPolicy: EnvironmentContinuationPolicy;
  requiredCompletionBasis: Exclude<EnvironmentCompletionBasis, 'none'>;
  motionClass?: EnvironmentMotionClass;
  actionPurpose?: EnvironmentActionPurpose;
  visualEvidenceMode?: EnvironmentVisualEvidenceMode;
  baselineFrame?: EnvironmentTaskFrameRef;
  selectedAction?: EnvironmentTaskSelectedAction;
}

export type EnvironmentTaskContractSource =
  | 'persisted'
  | 'environment_decision'
  | 'router_fallback';

export interface EnvironmentTaskContractConflict {
  model: Pick<EnvironmentTaskContract, 'continuationPolicy' | 'requiredCompletionBasis'>;
  routed: Pick<EnvironmentTaskContract, 'continuationPolicy' | 'requiredCompletionBasis'>;
}

const ENVIRONMENT_TASK_CONTRACT_PREFIX = 'EnvironmentTaskContract:';
const ENVIRONMENT_TASK_STATE_PREFIX = 'EnvironmentTaskState:';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function environmentInputSource(
  context: { environmentActionSource?: unknown; userMessage?: unknown },
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): 'user' | 'autonomy' {
  if (context.environmentActionSource === 'autonomy') return 'autonomy';
  if (context.environmentActionSource === 'user') return 'user';
  if (typeof context.userMessage === 'string' && context.userMessage.trim()) return 'user';
  const robotObserver = isRecord(observation?.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  return robotObserver?.triggerSource === 'autonomy' ? 'autonomy' : 'user';
}

/**
 * Robot Operator may contribute a typed action preference to its delegated
 * intention. The Environment LLM remains the semantic action owner.
 */
export function robotOperatorActionRequirement(
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): boolean | null {
  const decision = isRecord(observation?.metadata?.robotOperatorDecision)
    ? observation.metadata.robotOperatorDecision
    : null;
  return typeof decision?.requiresAction === 'boolean'
    ? decision.requiresAction
    : null;
}

function normalizedCompletionBasis(value: unknown): EnvironmentCompletionBasis | null {
  return typeof value === 'string'
    && ENVIRONMENT_COMPLETION_BASES.includes(value as EnvironmentCompletionBasis)
    ? value as EnvironmentCompletionBasis
    : null;
}

export function normalizedEnvironmentActionPurpose(value: unknown): EnvironmentActionPurpose | null {
  return typeof value === 'string'
    && ENVIRONMENT_ACTION_PURPOSES.includes(value as EnvironmentActionPurpose)
    ? value as EnvironmentActionPurpose
    : null;
}

export function normalizedEnvironmentMotionClass(value: unknown): EnvironmentMotionClass | null {
  return typeof value === 'string'
    && ENVIRONMENT_MOTION_CLASSES.includes(value as EnvironmentMotionClass)
    ? value as EnvironmentMotionClass
    : null;
}

export function environmentTaskContractFromRouting(
  value: unknown,
  objective = '',
): EnvironmentTaskContract | null {
  if (!isRecord(value) || !isRecord(value.actionParams)) return null;
  const continuationPolicy = value.actionParams.continuationPolicy;
  const requiredCompletionBasis = normalizedCompletionBasis(
    value.actionParams.requiredCompletionBasis,
  );
  const motionClass = normalizedEnvironmentMotionClass(value.actionParams.motionClass);
  const actionPurpose = normalizedEnvironmentActionPurpose(value.actionParams.actionPurpose);
  const visualEvidenceMode = value.actionParams.visualEvidenceMode === 'single'
    || value.actionParams.visualEvidenceMode === 'comparison'
    ? value.actionParams.visualEvidenceMode
    : undefined;
  if (
    (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
    || !requiredCompletionBasis
    || requiredCompletionBasis === 'none'
  ) return null;
  return {
    objective: objective.trim().slice(0, 1_000),
    continuationPolicy,
    requiredCompletionBasis,
    ...(motionClass ? { motionClass } : {}),
    ...(actionPurpose ? { actionPurpose } : {}),
    ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
  };
}

/**
 * A trigger may define the evidence needed for its high-level intention while
 * leaving action selection and lifecycle ownership to Environment Mode.
 */
export function robotOperatorLifecycleContractFromObservation(
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): EnvironmentTaskContract | null {
  const decision = isRecord(observation?.metadata?.robotOperatorDecision)
    ? observation.metadata.robotOperatorDecision
    : null;
  const lifecycle = isRecord(decision?.lifecycleContract)
    ? decision.lifecycleContract
    : null;
  if (!lifecycle) return null;
  const objective = typeof lifecycle.objective === 'string'
    ? lifecycle.objective.trim().slice(0, 1_000)
    : '';
  const continuationPolicy = lifecycle.continuationPolicy;
  const requiredCompletionBasis = normalizedCompletionBasis(lifecycle.requiredCompletionBasis);
  const visualEvidenceMode = lifecycle.visualEvidenceMode === 'single'
    || lifecycle.visualEvidenceMode === 'comparison'
    ? lifecycle.visualEvidenceMode
    : undefined;
  if (
    !objective
    || (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
    || !requiredCompletionBasis
    || requiredCompletionBasis === 'none'
  ) return null;
  return {
    objective,
    continuationPolicy,
    requiredCompletionBasis,
    ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
  };
}

export function environmentTaskContractFromObservation(
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): EnvironmentTaskContract | null {
  const command = isRecord(observation?.metadata?.taskValidatorCommand)
    ? observation.metadata.taskValidatorCommand
    : null;
  const objective = typeof command?.objective === 'string'
    ? command.objective.trim().slice(0, 1_000)
    : '';
  const currentInstruction = typeof command?.instruction === 'string'
    ? command.instruction.trim().slice(0, 500)
    : '';
  const commandContract = environmentTaskContractFromRouting({
    actionParams: {
      continuationPolicy: command?.continuationPolicy,
      requiredCompletionBasis: command?.requiredCompletionBasis,
      motionClass: command?.motionClass,
      actionPurpose: command?.actionPurpose,
    },
  }, objective);
  if (commandContract) {
    return {
      ...commandContract,
      ...(currentInstruction ? { currentInstruction } : {}),
    };
  }
  const robotOperatorContract = robotOperatorLifecycleContractFromObservation(observation);
  if (robotOperatorContract) return robotOperatorContract;
  const taskState = parseEnvironmentTaskState(observation?.metadata?.originatingInstruction);
  if (taskState) {
    return {
      objective: taskState.objective,
      continuationPolicy: taskState.continuationPolicy,
      requiredCompletionBasis: taskState.requiredCompletionBasis,
      ...(taskState.motionClass ? { motionClass: taskState.motionClass } : {}),
      ...(taskState.actionPurpose ? { actionPurpose: taskState.actionPurpose } : {}),
      ...(taskState.visualEvidenceMode ? { visualEvidenceMode: taskState.visualEvidenceMode } : {}),
    };
  }
  return parseEnvironmentTaskInstruction(observation?.metadata?.originatingInstruction);
}

export function encodeEnvironmentTaskState(state: EnvironmentTaskState): string {
  return `${ENVIRONMENT_TASK_STATE_PREFIX}${JSON.stringify({
    version: 1,
    objective: state.objective.trim().slice(0, 1_000),
    phase: state.phase,
    step: Math.max(0, Math.floor(state.step)),
    maxSteps: Math.max(1, Math.min(10, Math.floor(state.maxSteps))),
    continuationPolicy: state.continuationPolicy,
    requiredCompletionBasis: state.requiredCompletionBasis,
    ...(state.motionClass ? { motionClass: state.motionClass } : {}),
    ...(state.actionPurpose ? { actionPurpose: state.actionPurpose } : {}),
    ...(state.visualEvidenceMode ? { visualEvidenceMode: state.visualEvidenceMode } : {}),
    ...(state.baselineFrame ? { baselineFrame: state.baselineFrame } : {}),
    ...(state.selectedAction ? { selectedAction: state.selectedAction } : {}),
  })}`;
}

function normalizedTaskFrameRef(value: unknown): EnvironmentTaskFrameRef | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim().slice(0, 200) : '';
  const timestamp = typeof value.timestamp === 'string'
    ? value.timestamp.trim().slice(0, 100)
    : '';
  if (!id || !timestamp || Number.isNaN(Date.parse(timestamp))) return null;
  const source = typeof value.source === 'string' ? value.source.trim().slice(0, 100) : '';
  const correlationId = typeof value.correlationId === 'string'
    ? value.correlationId.trim().slice(0, 200)
    : '';
  return {
    id,
    timestamp,
    ...(source ? { source } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function normalizedSelectedAction(value: unknown): EnvironmentTaskSelectedAction | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !PERSISTED_ACTION_TYPES.has(value.type as EnvironmentActionType)) {
    return null;
  }
  const clean = (field: unknown, maxLength = 200): string => (
    typeof field === 'string' ? field.trim().slice(0, maxLength) : ''
  );
  const command = clean(value.command);
  const direction = clean(value.direction, 40);
  const target = clean(value.target);
  const description = clean(value.description, 500);
  return {
    type: value.type as EnvironmentActionType,
    ...(command ? { command } : {}),
    ...(direction ? { direction } : {}),
    ...(target ? { target } : {}),
    ...(description ? { description } : {}),
  };
}

export function parseEnvironmentTaskState(value: unknown): EnvironmentTaskState | null {
  if (typeof value !== 'string' || !value.startsWith(ENVIRONMENT_TASK_STATE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(ENVIRONMENT_TASK_STATE_PREFIX.length));
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    const objective = typeof parsed.objective === 'string'
      ? parsed.objective.trim().slice(0, 1_000)
      : '';
    const phases: EnvironmentTaskPhase[] = ['new', 'awaiting_action', 'evaluating_evidence', 'complete', 'blocked'];
    const phase = typeof parsed.phase === 'string' && phases.includes(parsed.phase as EnvironmentTaskPhase)
      ? parsed.phase as EnvironmentTaskPhase
      : null;
    const continuationPolicy = parsed.continuationPolicy;
    const requiredCompletionBasis = normalizedCompletionBasis(parsed.requiredCompletionBasis);
    const motionClass = normalizedEnvironmentMotionClass(parsed.motionClass);
    const actionPurpose = normalizedEnvironmentActionPurpose(parsed.actionPurpose);
    const visualEvidenceMode = parsed.visualEvidenceMode === 'single' || parsed.visualEvidenceMode === 'comparison'
      ? parsed.visualEvidenceMode
      : undefined;
    const step = Number.isInteger(parsed.step) ? Number(parsed.step) : -1;
    const maxSteps = Number.isInteger(parsed.maxSteps) ? Number(parsed.maxSteps) : 0;
    if (
      !objective
      || !phase
      || step < 0
      || maxSteps < 1
      || maxSteps > 10
      || (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
      || !requiredCompletionBasis
      || requiredCompletionBasis === 'none'
      || (parsed.motionClass !== undefined && !motionClass)
      || (parsed.actionPurpose !== undefined && !actionPurpose)
    ) return null;
    const baselineFrame = normalizedTaskFrameRef(parsed.baselineFrame);
    const selectedAction = normalizedSelectedAction(parsed.selectedAction);
    return {
      version: 1,
      objective,
      phase,
      step,
      maxSteps,
      continuationPolicy,
      requiredCompletionBasis,
      ...(motionClass ? { motionClass } : {}),
      ...(actionPurpose ? { actionPurpose } : {}),
      ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
      ...(baselineFrame ? { baselineFrame } : {}),
      ...(selectedAction ? { selectedAction } : {}),
    };
  } catch {
    return null;
  }
}

export function environmentTaskStateFromObservation(
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): EnvironmentTaskState | null {
  const serialized = parseEnvironmentTaskState(observation?.metadata?.originatingInstruction);
  if (serialized) return serialized;

  // Backward-compatible adoption of an action already queued by the retired
  // validator workflow. The new reducer becomes its sole lifecycle owner.
  const command = isRecord(observation?.metadata?.taskValidatorCommand)
    ? observation.metadata.taskValidatorCommand
    : null;
  if (!command) return null;
  const contract = environmentTaskContractFromObservation(observation);
  if (!contract || contract.requiredCompletionBasis === 'none') return null;
  const step = Number.isInteger(command?.step) ? Math.max(0, Number(command?.step)) : 1;
  const maxSteps = Number.isInteger(command?.maxSteps)
    ? Math.max(1, Math.min(10, Number(command?.maxSteps)))
    : 3;
  return {
    version: 1,
    objective: contract.objective,
    phase: 'awaiting_action',
    step,
    maxSteps,
    continuationPolicy: contract.continuationPolicy,
    requiredCompletionBasis: contract.requiredCompletionBasis,
    ...(contract.motionClass ? { motionClass: contract.motionClass } : {}),
    ...(contract.actionPurpose ? { actionPurpose: contract.actionPurpose } : {}),
    ...(contract.visualEvidenceMode ? { visualEvidenceMode: contract.visualEvidenceMode } : {}),
  };
}

export function encodeEnvironmentTaskInstruction(contract: EnvironmentTaskContract): string {
  return `${ENVIRONMENT_TASK_CONTRACT_PREFIX}${JSON.stringify({
    version: 2,
    objective: contract.objective.trim().slice(0, 1_000),
    ...(contract.currentInstruction?.trim()
      ? { currentInstruction: contract.currentInstruction.trim().slice(0, 500) }
      : {}),
    continuationPolicy: contract.continuationPolicy,
    requiredCompletionBasis: contract.requiredCompletionBasis,
    ...(contract.motionClass ? { motionClass: contract.motionClass } : {}),
    ...(contract.actionPurpose ? { actionPurpose: contract.actionPurpose } : {}),
    ...(contract.visualEvidenceMode ? { visualEvidenceMode: contract.visualEvidenceMode } : {}),
  })}`;
}

export function parseEnvironmentTaskInstruction(value: unknown): EnvironmentTaskContract | null {
  if (typeof value !== 'string' || !value.startsWith(ENVIRONMENT_TASK_CONTRACT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(ENVIRONMENT_TASK_CONTRACT_PREFIX.length));
    if (!isRecord(parsed)) return null;
    const objective = typeof parsed.objective === 'string'
      ? parsed.objective.trim().slice(0, 1_000)
      : '';
    const currentInstruction = typeof parsed.currentInstruction === 'string'
      ? parsed.currentInstruction.trim().slice(0, 500)
      : '';
    const continuationPolicy = parsed.continuationPolicy;
    const requiredCompletionBasis = normalizedCompletionBasis(parsed.requiredCompletionBasis);
    const motionClass = normalizedEnvironmentMotionClass(parsed.motionClass);
    const actionPurpose = normalizedEnvironmentActionPurpose(parsed.actionPurpose);
    const visualEvidenceMode = parsed.visualEvidenceMode === 'single'
      || parsed.visualEvidenceMode === 'comparison'
      ? parsed.visualEvidenceMode
      : undefined;
    if (parsed.motionClass !== undefined && !motionClass) return null;
    if (parsed.actionPurpose !== undefined && !actionPurpose) return null;
    if (
      !objective
      || (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
      || !requiredCompletionBasis
      || requiredCompletionBasis === 'none'
    ) return null;
    return {
      objective,
      ...(currentInstruction ? { currentInstruction } : {}),
      continuationPolicy,
      requiredCompletionBasis,
      ...(motionClass ? { motionClass } : {}),
      ...(actionPurpose ? { actionPurpose } : {}),
      ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
    };
  } catch {
    return null;
  }
}

export interface EnvironmentTaskDecision {
  outcome: EnvironmentTaskOutcome;
  reason: string;
  /** Model-authored objective. Autonomous workflows may require this field. */
  objective?: string;
  objectiveComplete: boolean;
  continuationPolicy?: EnvironmentContinuationPolicy;
  requiredCompletionBasis?: EnvironmentCompletionBasis;
  /** Environment LLM-owned semantic motion reference for the selected action. */
  motionClass?: EnvironmentMotionClass;
  /** Why the selected action exists; Task State uses this to enforce evidence consistency. */
  actionPurpose?: EnvironmentActionPurpose;
  /** Short current-scene description used only for asynchronous familiarity search. */
  observationSummary?: string;
  /** Whether visual proof needs one current frame or a before/after comparison. */
  visualEvidenceMode?: EnvironmentVisualEvidenceMode;
  /** Model-authored evidence for a completion claim. Visual evidence must cite the current frame id. */
  completionEvidence?: string;
  /** Internal provenance added after model output parsing by Environment Task Contract. */
  taskContractSource?: EnvironmentTaskContractSource;
  /** Typed disagreement retained for lifecycle telemetry; never model-authored. */
  taskContractConflict?: EnvironmentTaskContractConflict;
}

const SELECTOR_MAX_OBJECT_KEYS = 12;
const SELECTOR_MAX_ARRAY_ITEMS = 8;
const SELECTOR_MAX_DEPTH = 3;
const SELECTOR_MAX_STRING_LENGTH = 180;
const SELECTOR_STATE_LEAF_LIMIT = 10;

function projectSelectorEvidence(
  value: unknown,
  budget: { remaining: number },
  depth = 0,
): unknown {
  if (budget.remaining <= 0) return undefined;
  if (typeof value === 'string') {
    budget.remaining -= 1;
    return value.slice(0, SELECTOR_MAX_STRING_LENGTH);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    budget.remaining -= 1;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, SELECTOR_MAX_ARRAY_ITEMS).flatMap(item => {
      const projected = projectSelectorEvidence(item, budget, depth + 1);
      return projected === undefined ? [] : [projected];
    });
  }
  if (!isRecord(value) || depth >= SELECTOR_MAX_DEPTH) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SELECTOR_MAX_OBJECT_KEYS)
      .flatMap(([key, nested]) => {
        const projected = projectSelectorEvidence(nested, budget, depth + 1);
        return projected === undefined ? [] : [[key, projected]];
      }),
  );
}

export interface EnvironmentSelectorEnvelopeInput {
  instruction: string;
  observation: EnvironmentObservation;
  taskState?: EnvironmentTaskState | null;
  recentConversation?: Array<{ role: string; content: string }>;
  memories?: string[];
  personaText?: string;
  mustSelectAction?: boolean;
  mustAdvanceTask?: boolean;
  inputSource?: 'user' | 'autonomy';
}

export interface EnvironmentSelectorSystemInput {
  systemPrompt: string;
  queuedContinuation?: boolean;
  mustAdvanceTask?: boolean;
}

export function buildEnvironmentSelectorSystemPrompt(
  input: EnvironmentSelectorSystemInput,
): string {
  return [
    input.systemPrompt.trim(),
    input.queuedContinuation
      ? 'This is a continuation of the one persisted taskState in the user envelope; preserve its objective and evidence contract.'
      : '',
    input.mustAdvanceTask
      ? 'This bounded continuation must advance the persisted task: either complete it from the exact required evidence or return one next advertised action now. An incomplete response with no action is invalid.'
      : '',
  ].filter(Boolean).join('\n\n');
}

function selectorCapabilityRules(observation: EnvironmentObservation): string[] {
  const actions = new Set(observation.capabilities.actions);
  return [
    actions.has('robotCommand')
      ? 'robotCommand: use an exact advertised robotCommands value.'
      : '',
    actions.has('robotMotionPlan')
      ? 'robotMotionPlan: request off-script body_local motion through movementRequest; never author a motion plan directly.'
      : '',
    actions.has('captureImage')
      ? 'captureImage: request one fresh frame when current visual evidence is absent.'
      : '',
    actions.has('inspect')
      ? 'inspect: use only for an advertised active-view target from the current frame.'
      : '',
    actions.has('visualApproach')
      ? 'visualApproach: use only for an advertised target_relative route bound to the current frame.'
      : '',
    actions.has('sendText')
      ? 'sendText: use only for text sent through the environment adapter.'
      : '',
  ].filter(Boolean);
}

/**
 * Bounded, user-agnostic selector input shared by runtime and system training.
 * Raw image bytes remain separate model content parts; only correlation and
 * freshness metadata are serialized here.
 */
export function buildEnvironmentSelectorEnvelope(
  input: EnvironmentSelectorEnvelopeInput,
): string {
  const observation = input.observation;
  const frames = [observation.visual, ...(observation.visuals ?? [])]
    .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
    .slice(-2)
    .map(frame => ({
      id: frame.id,
      timestamp: frame.timestamp,
      source: frame.source,
      correlationId: typeof frame.metadata?.correlationId === 'string'
        ? frame.metadata.correlationId
        : undefined,
      actionId: typeof frame.metadata?.actionId === 'string'
        ? frame.metadata.actionId
        : undefined,
    }));
  const feedback = (observation.feedback ?? []).slice(-3).map(event => ({
    type: event.type,
    actionId: event.actionId,
    message: event.message.slice(0, SELECTOR_MAX_STRING_LENGTH),
    command: isRecord(event.data) && typeof event.data.command === 'string'
      ? event.data.command.slice(0, SELECTOR_MAX_STRING_LENGTH)
      : undefined,
  }));
  const state = projectSelectorEvidence(
    observation.state ?? {},
    { remaining: SELECTOR_STATE_LEAF_LIMIT },
  );
  const location = projectSelectorEvidence(observation.location, { remaining: 6 });
  const map = projectSelectorEvidence(observation.map, { remaining: 6 });
  const robotObserver = isRecord(observation.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  return JSON.stringify({
    currentInstruction: input.instruction.slice(0, 4_000),
    inputSource: input.inputSource
      ?? (robotObserver?.triggerSource === 'autonomy' ? 'autonomy' : 'user'),
    decisionRequirements: {
      mustSelectAction: input.mustSelectAction === true,
      mustAdvanceTask: input.mustAdvanceTask === true,
    },
    currentEnvironment: {
      sessionId: observation.sessionId,
      timestamp: observation.timestamp,
      state,
      ...(location !== undefined ? { location } : {}),
      ...(map !== undefined ? { map } : {}),
      capabilities: {
        actions: observation.capabilities.actions.slice(0, 32),
        robotCommands: observation.capabilities.robotCommands?.slice(0, 64) ?? [],
        motionClasses: observation.capabilities.motionClasses ?? [],
        navigation: observation.capabilities.navigation === true,
        visual: observation.capabilities.visual === true,
        movement: observation.capabilities.movement === true,
        activeView: Boolean(observation.capabilities.activeView),
        visualApproach: Boolean(observation.capabilities.visualApproach),
      },
      feedback,
      visualFrames: frames,
      actionId: typeof observation.metadata?.actionId === 'string'
        ? observation.metadata.actionId
        : undefined,
      correlationId: typeof observation.metadata?.correlationId === 'string'
        ? observation.metadata.correlationId
        : undefined,
    },
    capabilityRules: selectorCapabilityRules(observation),
    taskState: input.taskState ?? null,
    activePersona: input.personaText?.trim().slice(0, 2_000) || null,
    recentConversation: (input.recentConversation ?? []).slice(-4).map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content.slice(0, SELECTOR_MAX_STRING_LENGTH),
    })),
    memories: (input.memories ?? []).slice(0, 3).map(memory => memory.slice(0, 500)),
  });
}

function normalizeAction(value: unknown, sessionId?: string): Partial<EnvironmentAction> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !DIRECT_ACTION_TYPES.has(type as EnvironmentActionType)) {
    return null;
  }

  if (type === 'robotCommand') {
    const command = typeof record.command === 'string' ? record.command.trim() : '';
    if (!command) {
      return null;
    }
  } else if (typeof record.command === 'string' && record.command.trim()) {
    // A semantic command belongs only to robotCommand. Accepting it on move
    // previously let malformed selector output fall through as a generic walk.
    return null;
  }

  if (
    type === 'move'
    && typeof record.direction !== 'string'
    && (!record.vector || typeof record.vector !== 'object')
  ) {
    return null;
  }

  if (type === 'sendText' && (typeof record.text !== 'string' || !record.text.trim())) {
    return null;
  }

  if (type === 'inspect' && (!record.inspectionTarget || typeof record.inspectionTarget !== 'object')) {
    return null;
  }
  if (type === 'visualApproach' && (!record.visualTarget || typeof record.visualTarget !== 'object')) {
    return null;
  }
  let inspectionTarget: EnvironmentAction['inspectionTarget'];
  if (type === 'inspect') {
    try {
      inspectionTarget = normalizeEnvironmentVisualInspectionTarget(record.inspectionTarget);
    } catch {
      return null;
    }
  }
  let visualTarget: EnvironmentAction['visualTarget'];
  if (type === 'visualApproach') {
    try {
      visualTarget = normalizeEnvironmentVisualTarget(record.visualTarget);
    } catch {
      return null;
    }
  }

  const vector = record.vector && typeof record.vector === 'object'
    ? record.vector as EnvironmentAction['vector']
    : undefined;

  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : sessionId,
    type: type as EnvironmentActionType,
    text: typeof record.text === 'string' ? record.text : undefined,
    direction: typeof record.direction === 'string' ? record.direction as EnvironmentAction['direction'] : undefined,
    command: typeof record.command === 'string' ? record.command : undefined,
    units: typeof record.units === 'number' ? record.units : undefined,
    amount: typeof record.amount === 'number' ? record.amount : undefined,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
    target: typeof record.target === 'string' ? record.target : undefined,
    inspectionTarget,
    visualTarget,
    vector,
    metadata: record.metadata && typeof record.metadata === 'object'
      ? record.metadata as Record<string, unknown>
      : undefined,
  };
}

function parseMovementRequest(
  value: unknown,
  sessionId?: string,
): { request: EnvironmentMovementRequest | null; error: string } {
  if (value === undefined || value === null) return { request: null, error: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { request: null, error: 'movementRequest must be an object or null' };
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter(key => key !== 'description');
  if (unknown.length > 0) {
    return {
      request: null,
      error: `movementRequest contains unsupported field(s): ${unknown.join(', ')}`,
    };
  }
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (!description || description.length > 500) {
    return { request: null, error: 'movementRequest description must contain 1..500 characters' };
  }
  return { request: { description, sessionId, motionClass: 'body_local' }, error: '' };
}

function parseTaskDecision(
  value: unknown,
): { decision: EnvironmentTaskDecision | null; error: string } {
  if (value === undefined || value === null) return { decision: null, error: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { decision: null, error: 'taskDecision must be an object' };
  }

  const record = value as Record<string, unknown>;
  const outcome = typeof record.outcome === 'string'
    ? record.outcome.trim() as EnvironmentTaskOutcome
    : '' as EnvironmentTaskOutcome;
  if (!ENVIRONMENT_TASK_OUTCOMES.includes(outcome)) {
    return { decision: null, error: 'taskDecision outcome is not supported' };
  }

  const reason = typeof record.reason === 'string' ? record.reason.trim().slice(0, 500) : '';
  const objective = typeof record.objective === 'string'
    ? record.objective.replace(/\s+/g, ' ').trim().slice(0, 1_000)
    : '';
  const requiredCompletionBasis = typeof record.requiredCompletionBasis === 'string'
    ? record.requiredCompletionBasis.trim() as EnvironmentCompletionBasis
    : undefined;
  if (
    requiredCompletionBasis !== undefined
    && (
      !ENVIRONMENT_COMPLETION_BASES.includes(requiredCompletionBasis)
      || requiredCompletionBasis === 'none'
    )
  ) {
    return { decision: null, error: 'taskDecision requiredCompletionBasis is not supported' };
  }
  const continuationPolicy = typeof record.continuationPolicy === 'string'
    ? record.continuationPolicy.trim() as EnvironmentContinuationPolicy
    : undefined;
  if (
    continuationPolicy !== undefined
    && !ENVIRONMENT_CONTINUATION_POLICIES.includes(continuationPolicy)
  ) {
    return { decision: null, error: 'taskDecision continuationPolicy is not supported' };
  }
  const motionClass = normalizedEnvironmentMotionClass(record.motionClass);
  if (record.motionClass !== undefined && !motionClass) {
    return { decision: null, error: 'taskDecision motionClass is not supported' };
  }
  const actionPurpose = normalizedEnvironmentActionPurpose(record.actionPurpose);
  if (record.actionPurpose !== undefined && !actionPurpose) {
    return { decision: null, error: 'taskDecision actionPurpose is not supported' };
  }
  const observationSummary = typeof record.observationSummary === 'string'
    ? record.observationSummary.replace(/\s+/g, ' ').trim()
    : '';
  if (observationSummary.length > 300) {
    return { decision: null, error: 'taskDecision observationSummary exceeds 300 characters' };
  }
  const visualEvidenceMode = record.visualEvidenceMode === 'single'
    || record.visualEvidenceMode === 'comparison'
    ? record.visualEvidenceMode
    : undefined;
  if (record.visualEvidenceMode !== undefined && !visualEvidenceMode) {
    return { decision: null, error: 'taskDecision visualEvidenceMode is not supported' };
  }
  const completionEvidence = typeof record.completionEvidence === 'string'
    ? record.completionEvidence.replace(/\s+/g, ' ').trim()
    : '';
  if (completionEvidence.length > 1_000) {
    return { decision: null, error: 'taskDecision completionEvidence exceeds 1000 characters' };
  }
  return {
    decision: {
      outcome,
      reason,
      ...(objective ? { objective } : {}),
      objectiveComplete: typeof record.objectiveComplete === 'boolean'
        ? record.objectiveComplete
        : outcome === 'complete',
      ...(continuationPolicy ? { continuationPolicy } : {}),
      ...(requiredCompletionBasis ? { requiredCompletionBasis } : {}),
      ...(motionClass ? { motionClass } : {}),
      ...(actionPurpose ? { actionPurpose } : {}),
      ...(observationSummary ? { observationSummary } : {}),
      ...(visualEvidenceMode ? { visualEvidenceMode } : {}),
      ...(completionEvidence ? { completionEvidence } : {}),
    },
    error: '',
  };
}

export interface EnvironmentModelOutput {
  response: string;
  actions: Partial<EnvironmentAction>[];
  movementRequest: (Omit<EnvironmentMovementRequest, 'motionClass'> & {
    motionClass?: EnvironmentMovementRequest['motionClass'];
  }) | null;
  taskDecision: EnvironmentTaskDecision;
}

const SELECTOR_SCHEMA_STRING = { type: 'string' } as const;
const SELECTOR_SCHEMA_COMPLETION_BASES = ENVIRONMENT_COMPLETION_BASES.filter(value => value !== 'none');
const SELECTOR_SCHEMA_DECISION_PROPERTIES = {
  outcome: { type: 'string', enum: [...ENVIRONMENT_TASK_OUTCOMES] },
  reason: SELECTOR_SCHEMA_STRING,
  objective: SELECTOR_SCHEMA_STRING,
  objectiveComplete: { type: 'boolean' },
  continuationPolicy: { type: 'string', enum: [...ENVIRONMENT_CONTINUATION_POLICIES] },
  requiredCompletionBasis: { type: 'string', enum: SELECTOR_SCHEMA_COMPLETION_BASES },
  motionClass: { type: 'string', enum: [...ENVIRONMENT_MOTION_CLASSES] },
  actionPurpose: { type: 'string', enum: [...ENVIRONMENT_ACTION_PURPOSES] },
  observationSummary: SELECTOR_SCHEMA_STRING,
  visualEvidenceMode: { type: 'string', enum: ['single', 'comparison'] },
  completionEvidence: { type: 'string', maxLength: 1_000 },
} as const;
const SELECTOR_SCHEMA_DECISION_REQUIRED = [
  'outcome',
  'reason',
  'objectiveComplete',
  'continuationPolicy',
  'requiredCompletionBasis',
] as const;
const SELECTOR_SCHEMA_ACTION_PROPERTIES = {
  type: { type: 'string', enum: [...DIRECT_ACTION_TYPES] },
  command: SELECTOR_SCHEMA_STRING,
  direction: SELECTOR_SCHEMA_STRING,
  target: SELECTOR_SCHEMA_STRING,
  text: SELECTOR_SCHEMA_STRING,
  units: { type: 'number' },
  amount: { type: 'number' },
  durationMs: { type: 'number' },
  vector: { type: 'object' },
  inspectionTarget: { type: 'object' },
  visualTarget: { type: 'object' },
  metadata: { type: 'object' },
} as const;

function selectorActionItemSchema(
  directActionTypes: EnvironmentActionType[],
  robotCommands: string[],
): Record<string, unknown> {
  const nonCommandTypes = directActionTypes.filter(type => type !== 'robotCommand');
  const { command: _command, ...nonCommandProperties } = SELECTOR_SCHEMA_ACTION_PROPERTIES;
  const nonCommandSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['type'],
    properties: {
      ...nonCommandProperties,
      type: { type: 'string', enum: nonCommandTypes },
    },
  };
  const robotCommandSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'command'],
    properties: {
      type: { type: 'string', enum: ['robotCommand'] },
      command: robotCommands.length > 0
        ? { type: 'string', enum: robotCommands }
        : SELECTOR_SCHEMA_STRING,
      units: SELECTOR_SCHEMA_ACTION_PROPERTIES.units,
      amount: SELECTOR_SCHEMA_ACTION_PROPERTIES.amount,
      durationMs: SELECTOR_SCHEMA_ACTION_PROPERTIES.durationMs,
      metadata: SELECTOR_SCHEMA_ACTION_PROPERTIES.metadata,
    },
  };

  if (nonCommandTypes.length === 0) return robotCommandSchema;
  if (!directActionTypes.includes('robotCommand')) return nonCommandSchema;
  return { anyOf: [nonCommandSchema, robotCommandSchema] };
}

export interface EnvironmentSelectorJsonSchemaInput {
  actions?: readonly string[];
  robotCommands?: readonly string[];
  requireAction?: boolean;
  requireObjective?: boolean;
  requireProgress?: boolean;
}

/**
 * Provider-level structured output for the universal Environment selector.
 * It constrains output to the current adapter capability contract without
 * encoding scene content or phrase-specific behavior.
 *
 * Ollama's structured decoder reliably enforces this flat schema. Cross-field
 * lifecycle consistency remains in Task State, its canonical runtime owner.
 */
export function buildEnvironmentSelectorJsonSchema(
  input: EnvironmentSelectorJsonSchemaInput = {},
): Record<string, unknown> {
  const capabilityBound = Array.isArray(input.actions);
  const advertisedActions = new Set(input.actions ?? []);
  const robotCommands = [...new Set((input.robotCommands ?? [])
    .map(command => command.trim())
    .filter(Boolean))].slice(0, 64);
  const directActionTypes = [...DIRECT_ACTION_TYPES].filter(type => (
    (!capabilityBound || advertisedActions.has(type))
    && (type !== 'robotCommand' || !capabilityBound || robotCommands.length > 0)
  ));
  const movementSupported = !capabilityBound || advertisedActions.has('robotMotionPlan');
  const progressBranches: Record<string, unknown>[] = [];
  if (directActionTypes.length > 0) {
    progressBranches.push({
      properties: {
        actions: { minItems: 1 },
      },
    });
  }
  if (movementSupported) {
    progressBranches.push({
      properties: {
        movementRequest: { type: 'object' },
      },
    });
  }
  progressBranches.push({
    properties: {
      actions: { maxItems: 0 },
      movementRequest: { type: 'null' },
      taskDecision: {
        required: ['outcome', 'objectiveComplete', 'requiredCompletionBasis', 'completionEvidence'],
        properties: {
          outcome: { type: 'string', enum: ['complete'] },
          objectiveComplete: { type: 'boolean', enum: [true] },
          requiredCompletionBasis: { type: 'string', enum: SELECTOR_SCHEMA_COMPLETION_BASES },
          completionEvidence: { type: 'string', minLength: 1, maxLength: 1_000 },
        },
      },
    },
  });

  return {
    type: 'object',
    additionalProperties: false,
    required: ['response', 'actions', 'movementRequest', 'taskDecision'],
    ...(input.requireProgress === true
      ? { allOf: [{ anyOf: progressBranches }] }
      : {}),
    properties: {
      response: SELECTOR_SCHEMA_STRING,
      actions: {
        type: 'array',
        ...(input.requireAction && !movementSupported && directActionTypes.length > 0
          ? { minItems: 1 }
          : {}),
        maxItems: 1,
        items: selectorActionItemSchema(directActionTypes, robotCommands),
      },
      movementRequest: movementSupported
        ? {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['description'],
                properties: {
                  description: { type: 'string', minLength: 1, maxLength: 500 },
                },
              },
            ],
          }
        : { type: 'null' },
      taskDecision: {
        type: 'object',
        additionalProperties: false,
        required: [
          ...SELECTOR_SCHEMA_DECISION_REQUIRED,
          ...(input.requireObjective === true ? ['objective'] : []),
        ],
        properties: SELECTOR_SCHEMA_DECISION_PROPERTIES,
      },
    },
  };
}

export const ENVIRONMENT_SELECTOR_JSON_SCHEMA = buildEnvironmentSelectorJsonSchema();

export interface EnvironmentSelectorValidationResult {
  jsonValid: boolean;
  valid: boolean;
  errors: string[];
  value?: EnvironmentModelOutput;
}

const SELECTOR_OUTPUT_FIELDS = new Set([
  'response',
  'actions',
  'movementRequest',
  'taskDecision',
]);

const SELECTOR_TASK_DECISION_FIELDS = new Set([
  'outcome',
  'reason',
  'objective',
  'objectiveComplete',
  'continuationPolicy',
  'requiredCompletionBasis',
  'motionClass',
  'actionPurpose',
  'observationSummary',
  'visualEvidenceMode',
]);

const SELECTOR_ACTION_FIELDS = new Set([
  'id',
  'sessionId',
  'type',
  'text',
  'direction',
  'command',
  'units',
  'amount',
  'durationMs',
  'target',
  'inspectionTarget',
  'visualTarget',
  'vector',
  'metadata',
]);

/**
 * Strict deployment contract for the small Environment action selector.
 *
 * Unlike the tolerant conversational parser, this accepts only one complete
 * JSON object using the existing Environment model-output fields. Invalid or
 * partial specialist output therefore cannot authorize physical work.
 */
export function validateEnvironmentSelectorOutput(
  text: unknown,
  sessionId?: string,
  input: { requireObjective?: boolean } = {},
): EnvironmentSelectorValidationResult {
  if (typeof text !== 'string') {
    return {
      jsonValid: false,
      valid: false,
      errors: ['selector output must be strict JSON text'],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return {
      jsonValid: false,
      valid: false,
      errors: ['selector output is not strict JSON'],
    };
  }
  if (!isRecord(raw)) {
    return {
      jsonValid: true,
      valid: false,
      errors: ['selector output must be one JSON object'],
    };
  }

  const errors: string[] = [];
  for (const field of SELECTOR_OUTPUT_FIELDS) {
    if (!(field in raw)) errors.push(`${field} is required`);
  }
  for (const field of Object.keys(raw)) {
    if (!SELECTOR_OUTPUT_FIELDS.has(field)) errors.push(`${field} is not an Environment model-output field`);
  }
  if (typeof raw.response !== 'string') errors.push('response must be a string');
  if (!Array.isArray(raw.actions)) errors.push('actions must be an array');
  if (raw.movementRequest !== null && !isRecord(raw.movementRequest)) {
    errors.push('movementRequest must be an object or null');
  }
  if (!isRecord(raw.taskDecision)) {
    errors.push('taskDecision must be an object');
  } else {
    for (const field of Object.keys(raw.taskDecision)) {
      if (!SELECTOR_TASK_DECISION_FIELDS.has(field)) {
        errors.push(`taskDecision.${field} is not supported`);
      }
    }
    for (const field of [
      'outcome',
      'reason',
      'objectiveComplete',
      'continuationPolicy',
      'requiredCompletionBasis',
    ]) {
      if (!(field in raw.taskDecision)) errors.push(`taskDecision.${field} is required`);
    }
    if (typeof raw.taskDecision.reason !== 'string' || !raw.taskDecision.reason.trim()) {
      errors.push('taskDecision.reason must be a non-empty string');
    }
    if (
      input.requireObjective === true
      && (typeof raw.taskDecision.objective !== 'string' || !raw.taskDecision.objective.trim())
    ) {
      errors.push('taskDecision.objective must be a non-empty string for autonomous work');
    }
    if (typeof raw.taskDecision.objectiveComplete !== 'boolean') {
      errors.push('taskDecision.objectiveComplete must be boolean');
    }
  }

  const actions = Array.isArray(raw.actions)
    ? raw.actions.map(action => normalizeAction(action, sessionId))
    : [];
  if (Array.isArray(raw.actions)) {
    raw.actions.forEach((action, index) => {
      if (!isRecord(action)) return;
      for (const field of Object.keys(action)) {
        if (!SELECTOR_ACTION_FIELDS.has(field)) {
          errors.push(`actions[${index}].${field} is not an Environment action field`);
        }
      }
    });
  }
  if (Array.isArray(raw.actions) && actions.some(action => action === null)) {
    errors.push('every action must be a valid typed Environment action');
  }
  if (actions.length > 1) errors.push('selector output may contain at most one action');
  const normalizedActions = actions.filter((action): action is Partial<EnvironmentAction> => action !== null);
  // Some structured decoders populate both mutually exclusive branches. A
  // complete typed direct action is the narrower and safer choice, so it owns
  // the decision and the off-script movement branch is discarded. Without a
  // direct action, movement remains strictly validated below.
  const movement = parseMovementRequest(
    normalizedActions.length > 0 ? null : raw.movementRequest,
    sessionId,
  );
  if (movement.error) errors.push(movement.error);
  const task = parseTaskDecision(raw.taskDecision);
  if (task.error) errors.push(task.error);

  const decision = task.decision;
  if (errors.length > 0 || !decision) {
    return { jsonValid: true, valid: false, errors };
  }
  return {
    jsonValid: true,
    valid: true,
    errors,
    value: {
      response: String(raw.response).trim(),
      actions: normalizedActions,
      movementRequest: movement.request
        ? {
            description: movement.request.description,
            ...(movement.request.sessionId ? { sessionId: movement.request.sessionId } : {}),
          }
        : null,
      taskDecision: decision,
    },
  };
}
