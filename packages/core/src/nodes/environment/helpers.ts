import { projectDesireAwareness } from '../../agency/lifecycle-policy.js'
import type { EnvironmentTaskProgram, EnvironmentTaskStep } from '../../environment-interface/active-task.js'
import {
  ENVIRONMENT_MOTION_CLASSES,
  normalizeEnvironmentVisualInspectionTarget,
  normalizeEnvironmentVisualTarget,
  type EnvironmentAction,
  type EnvironmentActionType,
  type EnvironmentCapabilities,
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

export type EnvironmentVisualEvidenceMode = 'single' | 'comparison';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

export interface EnvironmentTaskDecision {
  outcome: EnvironmentTaskOutcome;
  reason: string;
  /** Model-authored durable objective. A decision without an objective is not a task. */
  objective: string;
  completionCriteria?: string;
  objectiveComplete: boolean;
  continuationPolicy?: EnvironmentContinuationPolicy;
  requiredCompletionBasis?: EnvironmentCompletionBasis;
  /** Environment LLM-owned semantic motion reference for the selected action. */
  motionClass?: EnvironmentMotionClass;
  /** Optional semantic hint used to align the evidence contract when present. */
  actionPurpose?: EnvironmentActionPurpose;
  /** Short current-scene description used only for asynchronous familiarity search. */
  observationSummary?: string;
  /** Whether visual proof needs one current frame or a before/after comparison. */
  visualEvidenceMode?: EnvironmentVisualEvidenceMode;
  /** Model-authored evidence for a completion claim. Visual evidence must cite the current frame id. */
  completionEvidence?: string;
}

const SELECTOR_MAX_OBJECT_KEYS = 12;
const SELECTOR_MAX_ARRAY_ITEMS = 8;
const SELECTOR_MAX_DEPTH = 3;
const SELECTOR_MAX_STRING_LENGTH = 180;
const SELECTOR_STATE_FIELD_LEAF_LIMIT = 10;
const SELECTOR_COMMAND_DESCRIPTION_BUDGET = 4_000;

function projectSelectorEvidence(
  value: unknown,
  budget: { remaining: number },
  depth = 0,
  maxDepth = SELECTOR_MAX_DEPTH,
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
      const projected = projectSelectorEvidence(item, budget, depth + 1, maxDepth);
      return projected === undefined ? [] : [projected];
    });
  }
  if (!isRecord(value) || depth >= maxDepth) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SELECTOR_MAX_OBJECT_KEYS)
      .flatMap(([key, nested]) => {
        const projected = projectSelectorEvidence(nested, budget, depth + 1, maxDepth);
        return projected === undefined ? [] : [[key, projected]];
      }),
  );
}

export function projectSelectorState(value: unknown): unknown {
  if (!isRecord(value)) return projectSelectorEvidence(value, { remaining: SELECTOR_STATE_FIELD_LEAF_LIMIT });
  // The gateway also contains other robots and the legacy joint contract. Keep
  // the selected body's model and settings ahead of the generic state budget.
  const body = isRecord(value.body) ? value.body : null;
  const gateway = isRecord(value.gateway) ? value.gateway : null;
  const robots = isRecord(gateway?.robots) ? gateway.robots : null;
  const selected = typeof body?.robotId === 'string' ? robots?.[body.robotId] : null;
  const robot = isRecord(selected) ? selected : null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SELECTOR_MAX_OBJECT_KEYS)
      .flatMap(([key, nested]) => {
        if (key === 'gateway' && robots) {
          return [[key, { selectedRobot: robot ? {
            robotId: body!.robotId,
            model: robot.model,
            profile: robot.profile,
            mode: robot.mode,
            connectionState: robot.connection_state,
            activeWalk: projectSelectorEvidence(robot.active_walk, { remaining: 16 }),
            posture: robot.posture ?? null,
            lastTerminal: projectSelectorEvidence(robot.last_terminal, { remaining: 8 }),
          } : null }]];
        }
        if (key === 'activeMovementUpdates' && isRecord(nested)) {
          return [[key, { version: nested.version, available: nested.available,
            controls: projectSelectorEvidence(nested.controls, { remaining: 8 }) }]];
        }
        const projected = projectSelectorEvidence(
          nested,
          { remaining: SELECTOR_STATE_FIELD_LEAF_LIMIT },
          1,
          SELECTOR_MAX_DEPTH + 1,
        );
        return projected === undefined ? [] : [[key, projected]];
      }),
  );
}

export function projectRobotStatusContext(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const body = isRecord(value.body) ? value.body : null;
  const lastAction = isRecord(value.lastAction) ? value.lastAction : null;
  const situation = isRecord(value.situation) ? value.situation : null;
  const agency = isRecord(value.agency) ? value.agency : null;
  const task = isRecord(value.task) ? value.task : null;
  return {
    updatedAt: value.updatedAt,
    lastBodyAction: value.lastBodyAction ?? null,
    ...(value.latestVisualObservation ? { latestVisualObservation: value.latestVisualObservation } : {}),
    body: body
      ? projectSelectorEvidence({
          sessionId: body.sessionId,
          environmentId: body.environmentId,
          connectionStatus: body.connectionStatus,
          observationAt: body.observationAt,
          telemetryAt: body.telemetryAt,
          battery: body.battery,
          motion: body.motion,
        }, { remaining: 24 }, 0, 4) ?? null
      : null,
    lastAction: lastAction
      ? projectSelectorEvidence(lastAction, { remaining: 16 }, 0, 3) ?? null
      : null,
    task: task
      ? projectSelectorEvidence({
          objectiveId: task.objectiveId,
          executionId: task.executionId,
          executionStatus: task.executionStatus,
          completionCriteria: task.completionCriteria,
          objective: task.objective,
          instruction: task.instruction,
          source: task.source,
          decision: task.decision,
          selectedAction: task.selectedAction,
          actionId: task.actionId,
          actionStatus: task.actionStatus,
          feedback: task.feedback,
          baselineFrame: task.baselineFrame,
          updatedAt: task.updatedAt,
        }, { remaining: 40 }, 0, 5) ?? null
      : null,
    situation: situation
      ? projectSelectorEvidence({
          currentGoal: situation.currentGoal,
          currentIntent: situation.currentIntent,
          userContext: situation.userContext,
          uncertainties: situation.uncertainties,
        }, { remaining: 20 }, 0, 3) ?? null
      : null,
    agency: agency
      ? { purpose: 'Pending work for Desire Agent; never a body instruction or permission to act.',
          activeDesires: projectDesireAwareness(agency.activeDesires) }
      : null,
  };
}

/**
 * Preserve only descriptions for currently executable exact command names. The
 * adapter owns their meaning; this projection bounds untrusted bridge input for
 * the selector prompt without attempting to choose a command in code.
 */
export function projectRobotCommandDescriptions(
  capabilities: Pick<EnvironmentCapabilities, 'robotCommands' | 'robotCommandDescriptions'>,
): Record<string, string> {
  if (!isRecord(capabilities.robotCommandDescriptions)) return {};
  const entries = [...new Set(capabilities.robotCommands ?? [])].slice(0, 64).flatMap(command => {
    const description = typeof capabilities.robotCommandDescriptions?.[command] === 'string'
      ? capabilities.robotCommandDescriptions[command].replace(/\s+/g, ' ').trim()
      : '';
    return description ? [[command, description] as const] : [];
  });
  const descriptionLimit = Math.min(
    SELECTOR_MAX_STRING_LENGTH,
    Math.floor(SELECTOR_COMMAND_DESCRIPTION_BUDGET / Math.max(1, entries.length)),
  );
  return Object.fromEntries(entries.map(([command, description]) => [
    command,
    description.slice(0, descriptionLimit),
  ]));
}

/** History remains evidence, not additional system instructions. Preserve the
 * canonical buffer's dates and source identities through model presentation. */
export function projectEnvironmentHistory(value: unknown) {
  const entries = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.messages) ? value.messages : [];
  const conversation: Array<{ role: string; content: string; timestamp?: string | number }> = [];
  const innerDialogue: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.content !== 'string' || !entry.content.trim()) continue;
    const timestamp = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString()
      : typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
    const meta = isRecord(entry.meta) ? entry.meta : {};
    if (meta.isInnerDialogue === true) {
      innerDialogue.push({ type: meta.originalRole, timestamp, source: meta.dialogueSource,
        content: entry.content.trim() });
    } else if (entry.role === 'user' || entry.role === 'assistant') {
      conversation.push({ role: entry.role, content: entry.content.trim(), ...(timestamp ? { timestamp } : {}) });
    }
  }
  return { conversation, innerDialogue };
}

export interface EnvironmentSelectorEnvelopeInput {
  /** Frames selected alongside the attached images, in the same order. */
  visualFrames?: EnvironmentVisualFrame[];
  observationHistory?: import('../../visual-observation.js').VisualObservationRecord[];
  execution?: unknown;
  instruction: string;
  observation?: EnvironmentObservation | null;
  recentConversation?: Array<{ role: string; content: string; timestamp?: string | number }>;
  innerDialogue?: Array<Record<string, unknown>>;
  memories?: Array<string | Record<string, unknown>>;
  currentTime?: string;
  personaText?: string;
  robotStatus?: unknown;
  replyToContent?: string;
  inputSource?: 'user' | 'autonomy';
  routing?: Record<string, boolean>;
  currentObservation?: boolean;
  currentVisionAvailable?: boolean;
}

export interface EnvironmentSelectorSystemInput {
  systemPrompt: string;
}

export function buildEnvironmentSelectorSystemPrompt(
  input: EnvironmentSelectorSystemInput,
): string {
  return input.systemPrompt.trim();
}

function selectorCapabilityRules(capabilities: EnvironmentCapabilities, state: unknown): string[] {
  const actions = new Set(capabilities.actions);
  const commandDescriptions = projectRobotCommandDescriptions(capabilities);
  const gateway = isRecord(state) && isRecord(state.gateway) ? state.gateway : null;
  const robot = isRecord(gateway?.selectedRobot) ? gateway.selectedRobot : null;
  return [
    actions.has('robotCommand')
      ? Object.keys(commandDescriptions).length > 0
        ? actions.has('robotMotionPlan')
          ? 'robotCommand: choose from robotCommandCatalog descriptions, never identifier names. A chosen physical activity is represented by ordered program steps. Its local executor advances through action receipts and ongoing behaviors without a model call for each movement. For a directly specified movement, preserve every target or body part, motion, direction, and timing detail; use a generatedMotion step only when no description covers that current movement.'
          : 'robotCommand: choose from robotCommandCatalog descriptions, never identifier names. A chosen physical activity is represented by ordered program steps. Its local executor advances through action receipts and ongoing behaviors without a model call for each movement. For a directly specified movement, preserve every target or body part, motion, direction, and timing detail.'
        : actions.has('robotMotionPlan')
          ? 'robotCommand: command descriptions are unavailable, so do not infer opaque or punctuation-only command effects; use a generatedMotion step when a named effect cannot be identified confidently.'
          : 'robotCommand: command descriptions are unavailable, so do not infer opaque or punctuation-only command effects.'
      : '',
    actions.has('robotCommand')
      ? 'For ongoing named motions described by the adapter, set continuous:true. For live walking and turning together, select continuous move with forward and turn controls.'
      : '',
    robot?.model === 'v2-12servo' && actions.has('move')
      ? 'V2 locomotion: speed is 0..200 for Walk/Run (above 100 selects Run), or 0..100 for Crawl/Crab; speed 0 finishes the gait. Use speed OR both stride (1..100) and rate (0.25..3), never both control modes. Forward and turn are a pair of signed percentages (-100..100); positive turn is left. Use the advertised directional Crab commands for sideways motion. For finite cycles set continuous:false and units explicitly; continuous:true runs until finished or stopped. Live updates use only the advertised activeMovementUpdates controls.'
      : '',
    actions.has('robotMotionPlan')
      ? 'robotMotionPlan: request off-script body_local motion through a generatedMotion step; never author a motion plan directly.'
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
  const robotCommandDescriptions = observation
    ? projectRobotCommandDescriptions(observation.capabilities)
    : {};
  const frames = (input.visualFrames ?? [])
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
  const feedback = (observation?.feedback ?? []).slice(-3).map(event => ({
    type: event.type,
    actionId: event.actionId,
    message: event.message.slice(0, SELECTOR_MAX_STRING_LENGTH),
    command: isRecord(event.data) && typeof event.data.command === 'string'
      ? event.data.command.slice(0, SELECTOR_MAX_STRING_LENGTH)
      : undefined,
  }));
  const state = observation ? projectSelectorState(observation.state ?? {}) : null;
  const location = projectSelectorEvidence(observation?.location, { remaining: 6 });
  const map = projectSelectorEvidence(observation?.map, { remaining: 6 });
  return JSON.stringify({
    currentTime: input.currentTime ?? new Date().toISOString(),
    currentInstruction: input.instruction.slice(0, 4_000),
    inputSource: input.inputSource ?? 'user',
    selectedRoutes: input.routing ?? {},
    evidenceAvailability: {
      environmentObservation: observation
        ? input.currentObservation === true ? 'triggering' : 'saved'
        : 'none',
      currentVision: input.currentVisionAvailable === true,
    },
    currentEnvironment: observation ? {
      sessionId: observation.sessionId,
      timestamp: observation.timestamp,
      state,
      ...(location !== undefined ? { location } : {}),
      ...(map !== undefined ? { map } : {}),
      capabilities: {
        actions: observation.capabilities.actions.slice(0, 32),
        ...(Object.keys(robotCommandDescriptions).length > 0
          ? { robotCommandCatalog: robotCommandDescriptions }
          : { robotCommands: observation.capabilities.robotCommands?.slice(0, 64) ?? [] }),
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
    } : null,
    capabilityRules: observation ? selectorCapabilityRules(observation.capabilities, state) : [],
    activePersona: input.personaText?.trim().slice(0, 2_000) || null,
    robotStatus: projectRobotStatusContext(input.robotStatus),
    execution: input.execution ?? null,
    ...(input.observationHistory?.length ? { observationHistory: input.observationHistory } : {}),
    ...(input.replyToContent?.trim()
      ? { replyToContext: input.replyToContent.trim().slice(0, 500) }
      : {}),
    recentConversation: (input.recentConversation ?? []).map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
    })),
    innerDialogue: input.innerDialogue ?? [],
    memories: (input.memories ?? []).slice(0, 3),
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
    continuous: typeof record.continuous === 'boolean' ? record.continuous : undefined,
    speed: typeof record.speed === 'number' ? record.speed : undefined,
    stride: typeof record.stride === 'number' ? record.stride : undefined,
    rate: typeof record.rate === 'number' ? record.rate : undefined,
    gait: typeof record.gait === 'string' ? record.gait as EnvironmentAction['gait'] : undefined,
    forward: typeof record.forward === 'number' ? record.forward : undefined,
    turn: typeof record.turn === 'number' ? record.turn : undefined,
    target: typeof record.target === 'string' ? record.target : undefined,
    inspectionTarget,
    visualTarget,
    vector,
    metadata: record.metadata && typeof record.metadata === 'object'
      ? record.metadata as Record<string, unknown>
      : undefined,
  };
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
  if (!objective) {
    return { decision: null, error: 'taskDecision objective must be a non-empty string' };
  }
  if (typeof record.completionCriteria !== 'string' || !record.completionCriteria.trim()) {
    return { decision: null, error: 'taskDecision completionCriteria must be a non-empty string' };
  }
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
      ...(typeof record.completionCriteria === 'string' && record.completionCriteria.trim()
        ? { completionCriteria: record.completionCriteria.trim() } : {}),
      objective,
      objectiveComplete: outcome === 'complete',
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
  visualObservation?: unknown;
  response: string;
  program: EnvironmentTaskProgram | null;
  taskDecision: (Omit<EnvironmentTaskDecision, 'objectiveComplete' | 'completionCriteria'> & {
    completionCriteria: string;
  }) | null;
}

const SELECTOR_SCHEMA_STRING = { type: 'string' } as const;
const SELECTOR_SCHEMA_COMPLETION_BASES = ENVIRONMENT_COMPLETION_BASES.filter(value => value !== 'none');
const SELECTOR_SCHEMA_DECISION_PROPERTIES = {
  objective: { type: 'string', minLength: 1 },
  completionCriteria: { type: 'string', minLength: 1, description: 'Observable success condition for this objective, not merely the next movement.' },
  outcome: { type: 'string', enum: [...ENVIRONMENT_TASK_OUTCOMES], description: 'Progress of the whole objective. complete means its success condition has been met, not merely accepted or started.' },
  reason: { type: 'string', minLength: 1 },
  continuationPolicy: { type: 'string', enum: [...ENVIRONMENT_CONTINUATION_POLICIES] },
  requiredCompletionBasis: { type: 'string', enum: SELECTOR_SCHEMA_COMPLETION_BASES },
  motionClass: { type: 'string', enum: [...ENVIRONMENT_MOTION_CLASSES] },
  actionPurpose: { type: 'string', enum: [...ENVIRONMENT_ACTION_PURPOSES] },
  observationSummary: { type: 'string', maxLength: 300 },
  visualEvidenceMode: { type: 'string', enum: ['single', 'comparison'] },
  completionEvidence: { type: 'string', maxLength: 1_000 },
} as const;
const SELECTOR_SCHEMA_DECISION_REQUIRED = [
  'objective',
  'completionCriteria',
  'outcome',
  'reason',
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
  continuous: { type: 'boolean' }, speed: { type: 'number' }, stride: { type: 'number' }, rate: { type: 'number' },
  gait: { type: 'string', enum: ['walk', 'crawl', 'run', 'crab'] },
  forward: { type: 'number', minimum: -100, maximum: 100 }, turn: { type: 'number', minimum: -100, maximum: 100 },
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
      direction: SELECTOR_SCHEMA_ACTION_PROPERTIES.direction,
      continuous: SELECTOR_SCHEMA_ACTION_PROPERTIES.continuous,
      speed: SELECTOR_SCHEMA_ACTION_PROPERTIES.speed,
      stride: SELECTOR_SCHEMA_ACTION_PROPERTIES.stride,
      rate: SELECTOR_SCHEMA_ACTION_PROPERTIES.rate,
      gait: SELECTOR_SCHEMA_ACTION_PROPERTIES.gait,
      forward: SELECTOR_SCHEMA_ACTION_PROPERTIES.forward,
      turn: SELECTOR_SCHEMA_ACTION_PROPERTIES.turn,
    },
  };

  if (nonCommandTypes.length === 0) return robotCommandSchema;
  if (!directActionTypes.includes('robotCommand')) return nonCommandSchema;
  return { anyOf: [nonCommandSchema, robotCommandSchema] };
}

export interface EnvironmentSelectorJsonSchemaInput {
  actions?: readonly string[];
  robotCommands?: readonly string[];
  actionRouteSelected?: boolean;
  requireAction?: boolean;
}

/**
 * Provider-level structured output for the universal Environment selector.
 * It constrains output to the current adapter capability contract without
 * encoding scene content or phrase-specific behavior.
 *
 * Core validates the returned structure and route consistency before any effect
 * or objective update is committed, independently of provider schema support.
 */
export function buildEnvironmentSelectorJsonSchema(
  input: EnvironmentSelectorJsonSchemaInput = {},
): Record<string, unknown> {
  const capabilityBound = Array.isArray(input.actions);
  const advertisedActions = new Set(input.actions ?? []);
  const actionRouteSelected = input.actionRouteSelected !== false;
  const robotCommands = [...new Set((input.robotCommands ?? [])
    .map(command => command.trim())
    .filter(Boolean))].slice(0, 64);
  const directActionTypes = [...DIRECT_ACTION_TYPES].filter(type => (
    actionRouteSelected
    && (!capabilityBound || advertisedActions.has(type))
    && (type !== 'robotCommand' || !capabilityBound || robotCommands.length > 0)
  ));
  const movementSupported = actionRouteSelected
    && (!capabilityBound || advertisedActions.has('robotMotionPlan'));
  const nonActionOutcomes = ENVIRONMENT_TASK_OUTCOMES.filter(outcome => outcome !== 'act');
  const taskDecisionObjectSchema = {
    type: 'object',
    additionalProperties: false,
    required: [...SELECTOR_SCHEMA_DECISION_REQUIRED],
    properties: {
      ...SELECTOR_SCHEMA_DECISION_PROPERTIES,
      outcome: {
        type: 'string',
        enum: directActionTypes.length > 0 || movementSupported
          ? [...ENVIRONMENT_TASK_OUTCOMES]
          : nonActionOutcomes,
      },
    },
  };
  const taskSchema = (properties: Record<string, unknown>, nullable = true) => {
    const decision = { ...taskDecisionObjectSchema,
      properties: { ...taskDecisionObjectSchema.properties, ...properties } };
    return {
      description: 'Durable objective state when this pass defines or changes an objective. Preserve the whole objective and its success criteria, not just the next effect.',
      ...(nullable ? { anyOf: [{ type: 'null' }, decision] } : decision),
    };
  };
  const response = {
    ...SELECTOR_SCHEMA_STRING,
    description: 'Optional natural speech. It may accompany a selected consequence but never substitutes for a required physical or sensing action.',
  };
  const branch = (program: unknown, decision: unknown) => ({ type: 'object', additionalProperties: false,
    required: ['response', 'program', 'taskDecision'], properties: { response, program, taskDecision: decision } });
  const alternatives: Record<string, unknown>[] = [];
  if (!input.requireAction || (!directActionTypes.length && !movementSupported)) {
    alternatives.push(branch({ type: 'null' }, taskSchema({ outcome: { type: 'string', enum: nonActionOutcomes } })));
  }
  const steps: Record<string, unknown>[] = [];
  const action = selectorActionItemSchema(directActionTypes, robotCommands);
  if (directActionTypes.length) steps.push({ type: 'object', additionalProperties: false,
    required: ['kind', 'action'], properties: { kind: { const: 'action' }, action } });
  if (movementSupported) steps.push({ type: 'object', additionalProperties: false,
    required: ['kind', 'description'], properties: { kind: { const: 'generatedMotion' }, description: { type: 'string', minLength: 1, maxLength: 500 } } });
  if (directActionTypes.includes('move') && (!capabilityBound || advertisedActions.has('captureImage'))) {
    steps.push({ type: 'object', additionalProperties: false,
      required: ['kind', 'target', 'completionCriteria', 'motion', 'candidateLabels', 'identifyEveryFrames', 'steering'],
      properties: { kind: { const: 'behavior' }, target: { type: 'string', minLength: 1 },
        completionCriteria: { type: 'string', minLength: 1 }, motion: { type: 'object', additionalProperties: false,
          required: ['type', 'direction', 'continuous'], properties: {
            ...SELECTOR_SCHEMA_ACTION_PROPERTIES, type: { const: 'move' }, continuous: { const: true } } },
        candidateLabels: { type: 'array', items: { type: 'string' } },
        identifyEveryFrames: { type: 'integer', minimum: 1 },
        steering: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
          required: ['label', 'gain'], properties: { label: { type: 'string' }, gain: { type: 'number' } } }] } } });
  }
  if (steps.length) alternatives.push(branch({ type: 'object', additionalProperties: false,
    required: ['steps'], properties: { steps: { type: 'array', minItems: 1, items: { anyOf: steps } } } },
    taskSchema({ outcome: { type: 'string', enum: ENVIRONMENT_TASK_OUTCOMES.filter(value => value !== 'complete') } }, false)));
  return { anyOf: alternatives };
}

export const ENVIRONMENT_SELECTOR_JSON_SCHEMA = buildEnvironmentSelectorJsonSchema();

export interface EnvironmentSelectorValidationResult {
  jsonValid: boolean;
  valid: boolean;
  errors: string[];
  value?: Omit<EnvironmentModelOutput, 'taskDecision'> & { taskDecision: EnvironmentTaskDecision | null };
}

const SELECTOR_OUTPUT_FIELDS = new Set([
  'response',
  'program',
  'taskDecision',
]);

const SELECTOR_TASK_DECISION_FIELDS = new Set([
  'outcome',
  'reason',
  'objective',
  'completionCriteria',
  'continuationPolicy',
  'requiredCompletionBasis',
  'motionClass',
  'actionPurpose',
  'observationSummary',
  'visualEvidenceMode',
  'completionEvidence',
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
  'metadata', 'continuous', 'speed', 'stride', 'rate', 'gait', 'forward', 'turn',
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
  for (const field of SELECTOR_OUTPUT_FIELDS) if (!(field in raw)) errors.push(`${field} is required`);
  for (const field of Object.keys(raw)) if (!SELECTOR_OUTPUT_FIELDS.has(field) && field !== 'visualObservation') errors.push(`${field} is not an Environment model-output field`);
  if (typeof raw.response !== 'string') errors.push('response must be a string');
  const task = parseTaskDecision(raw.taskDecision);
  if (task.error) errors.push(task.error);
  if (isRecord(raw.taskDecision)) {
    for (const field of Object.keys(raw.taskDecision)) if (!SELECTOR_TASK_DECISION_FIELDS.has(field)) errors.push(`taskDecision.${field} is not supported`);
    for (const field of SELECTOR_SCHEMA_DECISION_REQUIRED) if (!(field in raw.taskDecision)) errors.push(`taskDecision.${field} is required`);
  }
  const action = (value: unknown): Partial<EnvironmentAction> | null => {
    if (!isRecord(value) || Object.keys(value).some(key => !SELECTOR_ACTION_FIELDS.has(key))) return null;
    return normalizeAction(value, sessionId);
  };
  let program: EnvironmentTaskProgram | null = null;
  if (raw.program !== null) {
    if (!isRecord(raw.program) || Object.keys(raw.program).some(key => key !== 'steps') || !Array.isArray(raw.program.steps) || !raw.program.steps.length) errors.push('program requires non-empty steps');
    else {
      const steps: EnvironmentTaskStep[] = [];
      for (const step of raw.program.steps) {
        if (!isRecord(step)) { errors.push('program step must be an object'); continue; }
        if (step.kind === 'action' && Object.keys(step).every(key => ['kind', 'action'].includes(key))) {
          const normalized = action(step.action);
          if (normalized) steps.push({ kind: 'action', action: normalized });
          else errors.push('action step requires a typed semantic action');
        } else if (step.kind === 'generatedMotion' && Object.keys(step).every(key => ['kind', 'description'].includes(key))
          && typeof step.description === 'string' && step.description.trim() && step.description.length <= 500) {
          steps.push({ kind: 'generatedMotion', description: step.description.trim() });
        } else if (step.kind === 'behavior') {
          const motion = action(step.motion);
          const steering = step.steering;
          if (Object.keys(step).some(key => !['kind', 'target', 'completionCriteria', 'motion', 'candidateLabels', 'identifyEveryFrames', 'steering'].includes(key))
            || typeof step.target !== 'string' || !step.target.trim() || typeof step.completionCriteria !== 'string' || !step.completionCriteria.trim()
            || motion?.type !== 'move' || motion.continuous !== true || !Array.isArray(step.candidateLabels)
            || step.candidateLabels.some(label => typeof label !== 'string') || !Number.isInteger(step.identifyEveryFrames) || Number(step.identifyEveryFrames) < 1
            || (steering !== null && (!isRecord(steering) || typeof steering.label !== 'string' || typeof steering.gain !== 'number'))) errors.push('behavior requires target, phase criteria, ongoing motion, candidate labels, frame cadence and steering');
          else steps.push({ kind: 'behavior', target: step.target, completionCriteria: step.completionCriteria,
            motion, candidateLabels: step.candidateLabels as string[], identifyEveryFrames: Number(step.identifyEveryFrames),
            steering: steering as { label: string; gain: number } | null });
        } else errors.push('program step kind is unsupported');
      }
      if (steps.length === raw.program.steps.length) program = { steps };
    }
    if (!task.decision) errors.push('a task program requires its objective decision');
    if (task.decision?.objectiveComplete) errors.push('a newly selected program cannot establish completion before its results');
  }
  const response = typeof raw.response === 'string' ? raw.response.trim() : '';
  if (!response && !program && !task.decision && !isRecord(raw.visualObservation)) errors.push('selector output requires response, program, taskDecision, or visualObservation');
  if (!program && task.decision?.outcome === 'act') errors.push('taskDecision outcome=act requires a program');
  if (errors.length) return { jsonValid: true, valid: false, errors };
  return { jsonValid: true, valid: true, errors, value: { response, program, taskDecision: task.decision,
    ...(raw.visualObservation !== undefined ? { visualObservation: raw.visualObservation } : {}) } };
}
