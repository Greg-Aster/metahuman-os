import type { EnvironmentAction, EnvironmentActionType, EnvironmentObservation } from '../../environment-interface/index.js';

// robotMotionPlan is intentionally excluded. Only Movement Generator may create it.
const DIRECT_ACTION_TYPES = new Set<EnvironmentActionType>([
  'move',
  'look',
  'jump',
  'interact',
  'stop',
  'captureImage',
  'robotCommand',
  'sendText',
]);

export interface DirectRobotInstruction {
  action: Partial<EnvironmentAction>;
  response: string;
}

export interface EnvironmentMovementRequest {
  description: string;
  sessionId?: string;
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

export interface EnvironmentTaskContract {
  objective: string;
  currentInstruction?: string;
  continuationPolicy: EnvironmentContinuationPolicy;
  requiredCompletionBasis: EnvironmentCompletionBasis;
}

export type EnvironmentTaskContractSource =
  | 'persisted'
  | 'environment_decision'
  | 'bounded_router_evidence'
  | 'router_fallback';

export interface EnvironmentTaskContractConflict {
  model: Pick<EnvironmentTaskContract, 'continuationPolicy' | 'requiredCompletionBasis'>;
  routed: Pick<EnvironmentTaskContract, 'continuationPolicy' | 'requiredCompletionBasis'>;
}

const ENVIRONMENT_TASK_CONTRACT_PREFIX = 'EnvironmentTaskContract:';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Robot Operator is the authorization owner for its delegated intention. A
 * boolean is present only for the typed Robot Operator path; null leaves
 * ordinary user/environment routing under the Environment Context Router.
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

export function environmentTaskContractFromRouting(
  value: unknown,
  objective = '',
): EnvironmentTaskContract | null {
  if (!isRecord(value) || !isRecord(value.actionParams)) return null;
  const continuationPolicy = value.actionParams.continuationPolicy;
  const requiredCompletionBasis = normalizedCompletionBasis(
    value.actionParams.requiredCompletionBasis,
  );
  if (
    (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
    || !requiredCompletionBasis
    || requiredCompletionBasis === 'none'
  ) return null;
  return {
    objective: objective.trim().slice(0, 1_000),
    continuationPolicy,
    requiredCompletionBasis,
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
    },
  }, objective);
  if (commandContract) {
    return {
      ...commandContract,
      ...(currentInstruction ? { currentInstruction } : {}),
    };
  }
  return parseEnvironmentTaskInstruction(observation?.metadata?.originatingInstruction);
}

export function encodeEnvironmentTaskInstruction(contract: EnvironmentTaskContract): string {
  return `${ENVIRONMENT_TASK_CONTRACT_PREFIX}${JSON.stringify({
    version: 1,
    objective: contract.objective.trim().slice(0, 1_000),
    ...(contract.currentInstruction?.trim()
      ? { currentInstruction: contract.currentInstruction.trim().slice(0, 500) }
      : {}),
    continuationPolicy: contract.continuationPolicy,
    requiredCompletionBasis: contract.requiredCompletionBasis,
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
    };
  } catch {
    return null;
  }
}

export interface EnvironmentTaskDecision {
  outcome: EnvironmentTaskOutcome;
  reason: string;
  objectiveComplete: boolean;
  continuationPolicy?: EnvironmentContinuationPolicy;
  requiredCompletionBasis?: EnvironmentCompletionBasis;
  completionBasis?: EnvironmentCompletionBasis;
  completionEvidence?: string;
  /** Internal provenance added after model output parsing by Environment Task Contract. */
  taskContractSource?: EnvironmentTaskContractSource;
  /** Typed disagreement retained for lifecycle telemetry; never model-authored. */
  taskContractConflict?: EnvironmentTaskContractConflict;
}

export interface EnvironmentPromptAdmission {
  /** Include current state, capabilities, feedback, location, and map context. */
  includeEnvironmentContext?: boolean;
  /** Include fresh visual-frame descriptions and vision-specific instructions. */
  includeVisionContext?: boolean;
  /** Include action, movement, and whole-objective lifecycle contracts. */
  includeActionContracts?: boolean;
}

export function parseDirectRobotInstruction(
  value: unknown,
  sessionId?: string,
  supportedRobotCommands?: string[],
): DirectRobotInstruction | null {
  if (typeof value !== 'string') return null;

  const instruction = value.trim().toLowerCase().replace(/[.!]+$/, '');
  if (!instruction || instruction.length > 120) return null;
  if (/\b(?:don't|do not|never|not)\b/.test(instruction)) return null;

  if (/^(?:please\s+)?(?:stop|halt|stop moving)$/.test(instruction)) {
    return {
      action: { type: 'stop', sessionId },
      response: 'Stopping.',
    };
  }

  if (/^(?:please\s+)?(?:sit|sit down|take a seat|have a seat)$/.test(instruction)) {
    if (!robotCommandIsSupported('sit', supportedRobotCommands)) return null;
    return {
      action: {
        type: 'robotCommand',
        command: 'sit',
        sessionId,
      },
      response: 'Sitting down.',
    };
  }

  const match = instruction.match(
    /^(?:please\s+)?(?:(?:walk|move|go)\s+(forward|forwards|backward|backwards)|turn\s+(left|right))(?:\s+(?:for\s+)?(\d{1,2})\s+(?:steps?|units?))?$/,
  );
  if (!match) return null;

  const direction = match[1] ?? match[2];
  const units = match[3] ? Math.max(1, Math.min(10, Number.parseInt(match[3], 10))) : undefined;
  const command = direction.startsWith('forward')
    ? 'walk'
    : direction.startsWith('backward')
      ? 'backward'
      : direction;
  const response = command === 'walk'
    ? 'Walking forward.'
    : command === 'backward'
      ? 'Walking backward.'
      : `Turning ${command}.`;

  if (!robotCommandIsSupported(command, supportedRobotCommands)) return null;

  return {
    action: {
      type: 'robotCommand',
      command,
      units,
      sessionId,
    },
    response,
  };
}

function normalizedRobotCommand(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function robotCommandIsSupported(command: string, supportedRobotCommands?: string[]): boolean {
  if (!supportedRobotCommands?.length) return true;
  const normalized = normalizedRobotCommand(command);
  return supportedRobotCommands.some(candidate => normalizedRobotCommand(candidate) === normalized);
}

export function stringifyEnvironmentObservation(
  observation: EnvironmentObservation,
  systemPrompt: string,
  admission: EnvironmentPromptAdmission = {},
): string {
  const includeEnvironmentContext = admission.includeEnvironmentContext ?? true;
  const includeVisionContext = admission.includeVisionContext ?? true;
  const includeActionContracts = admission.includeActionContracts ?? true;
  const sections: string[] = [];
  if (includeActionContracts && systemPrompt.trim()) {
    sections.push(systemPrompt.trim());
  }

  if (includeEnvironmentContext) {
    sections.push(`Environment: ${observation.environmentId}`);
    sections.push(`Adapter: ${observation.adapter}`);
    sections.push(`Session: ${observation.sessionId}`);
    sections.push(`Time: ${observation.timestamp}`);
  }

  if (includeEnvironmentContext && observation.text?.length) {
    sections.push([
      'Recent text:',
      ...observation.text.map(event => {
        const speaker = event.senderName ?? event.senderId ?? event.source;
        return `- [${event.source}] ${speaker}: ${event.text}`;
      }),
    ].join('\n'));
  }

  if (includeEnvironmentContext && observation.state && Object.keys(observation.state).length > 0) {
    sections.push(`State:\n${JSON.stringify(observation.state, null, 2)}`);
  }

  if (includeEnvironmentContext && observation.location && Object.keys(observation.location).length > 0) {
    sections.push(`Location:\n${JSON.stringify(observation.location, null, 2)}`);
  }

  if (includeEnvironmentContext && observation.map && Object.keys(observation.map).length > 0) {
    sections.push(`Map:\n${JSON.stringify(observation.map, null, 2)}`);
  }

  if (includeVisionContext && observation.visual) {
    sections.push(`Visual frame: ${describeVisualFrame(observation.visual)}`);
  }

  if (includeVisionContext && observation.visuals?.length) {
    sections.push([
      'Visual frames:',
      ...observation.visuals.map(frame => `- ${describeVisualFrame(frame)}`),
    ].join('\n'));
  }

  if (includeEnvironmentContext && observation.feedback?.length) {
    sections.push([
      'Recent feedback:',
      ...observation.feedback.map(event => `- [${event.type}] ${event.message}`),
    ].join('\n'));
  }

  if (includeEnvironmentContext) {
    sections.push(`Available actions: ${observation.capabilities.actions.join(', ')}`);
  }
  const robotCommands = observation.capabilities.robotCommands
    ?.map(command => command.trim())
    .filter(Boolean);
  if (includeEnvironmentContext && robotCommands?.length) {
    sections.push(`Supported robot commands: ${robotCommands.join(', ')}`);
  }
  if (includeEnvironmentContext) {
    sections.push([
      'Sensor truth contract:',
      '- Capability and readiness fields describe available hardware, not current sensory content.',
      '- Claim current sight only from a fresh visual frame and current hearing only from a current audio transcript.',
      '- Treat false readiness as unavailable and null or missing readiness as unknown.',
    ].join('\n'));
  }
  if (includeActionContracts) {
    sections.push([
      'Response contract:',
      '- Return exactly one JSON object: {"response":"short conversational reply","actions":[],"movementRequest":null,"taskDecision":{"outcome":"complete","reason":"why","objectiveComplete":true,"continuationPolicy":"none","requiredCompletionBasis":"response","completionBasis":"response","completionEvidence":"the requested result is present in response"}}.',
      '- Put only supported semantic actions in actions[]. Use an empty array when no action is needed.',
      '- taskDecision.outcome must be one of: complete, continue, observe, act, report, curiosity, background, request_user, wait.',
      '- Set objectiveComplete=true only when the current objective is actually satisfied.',
      '- A response, observation, or action result can complete the current step without completing the objective. Do useful work now; do not merely promise future work.',
      '- Actions and movementRequest in the current output have not executed yet. When either contains work, use outcome="act" and objectiveComplete=false; action_result is available only from later terminal feedback.',
      '- Every taskDecision must set continuationPolicy="none" or "bounded" and requiredCompletionBasis. Default to "none" only when one response or action result proves the entire objective. Use "bounded" when the objective requires later work or evidence beyond the completed step.',
      '- requiredCompletionBasis declares the evidence needed to prove the whole objective: response, action_result, visual_observation, environment_state, or user_input. A different basis may prove a step but cannot prove the whole objective.',
      '- A completed action with continuationPolicy="none" closes that one-shot objective using action_result evidence. Do not keep a simple completed action alive merely because the instruction was recorded as the objective.',
      '- When the objective remains incomplete after a completed step, use continuationPolicy="bounded". The existing validator and graph-owned refinement stage own any later attempt.',
      '- Never write a successor instruction in this response or issue the completed action directly during its feedback pass.',
      '- objectiveComplete=true requires completionBasis and completionEvidence proving the whole objective and every constraint. completionBasis is response, action_result, visual_observation, environment_state, or user_input.',
      '- Visual completion evidence must be fresh and correlated; ambiguous, stale, or missing sensory input cannot prove completion.',
    ].join('\n'));
  } else {
    sections.push([
      'Conversation response contract:',
      '- Return exactly one JSON object: {"response":"conversational reply","actions":[],"movementRequest":null,"taskDecision":{"outcome":"complete","reason":"response supplied","objectiveComplete":true,"continuationPolicy":"none","requiredCompletionBasis":"response","completionBasis":"response","completionEvidence":"the requested response is present"}}.',
      '- This route does not authorize environment actions or movement. Keep actions empty and movementRequest null.',
    ].join('\n'));
  }
  if (includeActionContracts && observation.capabilities.actions.includes('robotCommand')) {
    sections.push([
      'Robot command contract:',
      '- A robotCommand contains a semantic command and optional units, never simulator commands or raw servo values.',
      ...(robotCommands?.length
        ? ['- Use only a command named in Supported robot commands.']
        : []),
      '- Example: {"response":"I will walk forward.","actions":[{"type":"robotCommand","command":"walk","units":3}],"movementRequest":null,"taskDecision":{"outcome":"act","reason":"This is the current required step.","objectiveComplete":false,"continuationPolicy":"none","requiredCompletionBasis":"action_result"}}.',
    ].join('\n'));
  }
  if (includeActionContracts && observation.capabilities.actions.includes('captureImage')) {
    sections.push([
      'Robot vision contract:',
      '- The camera is the robot\'s visual sense. captureImage obtains one fresh view of the present physical environment.',
      '- When the current task depends on the present physical scene and no fresh correlated visual frame is available, request captureImage before answering from sight.',
      '- Do not describe the scene until a fresh correlated visual observation arrives.',
    ].join('\n'));
  }
  if (includeActionContracts && observation.capabilities.actions.includes('robotMotionPlan')) {
    sections.push([
      'Off-script movement routing:',
      '- Decide movement only from the current Task instruction. Conversation history, memories, prior actions, and feedback never authorize a new movement.',
      '- For greetings, general conversation, information questions, or any Task instruction that does not ask the robot to move, keep movementRequest null.',
      '- Prefer an advertised Supported robot command whenever it represents the requested behavior.',
      '- When a requested movement has no matching supported command, leave actions empty and set movementRequest to {"description":"a concise movement description"}.',
      '- Never put robotMotionPlan, joint targets, servo values, PWM values, calibration, or simulator commands in actions.',
      '- Example: {"response":"I will generate that movement.","actions":[],"movementRequest":{"description":"crouch, lift the front-right leg, pause, then stand"},"taskDecision":{"outcome":"act","reason":"This is the current required step.","objectiveComplete":false,"continuationPolicy":"none","requiredCompletionBasis":"action_result"}}.',
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function describeVisualFrame(frame: NonNullable<EnvironmentObservation['visual']>): string {
  const details = [
    frame.id,
    frame.mimeType,
    frame.width && frame.height ? `${frame.width}x${frame.height}` : undefined,
    frame.source ? `source=${frame.source}` : undefined,
    frame.altText ? `alt=${frame.altText}` : undefined,
  ].filter(Boolean);
  return details.join(', ') || 'image attached';
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
  }

  return null;
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
  }

  if (type === 'sendText' && (typeof record.text !== 'string' || !record.text.trim())) {
    return null;
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
  return { request: { description, sessionId }, error: '' };
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
  const completionBasis = typeof record.completionBasis === 'string'
    ? record.completionBasis.trim() as EnvironmentCompletionBasis
    : undefined;
  if (completionBasis !== undefined && !ENVIRONMENT_COMPLETION_BASES.includes(completionBasis)) {
    return { decision: null, error: 'taskDecision completionBasis is not supported' };
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
  const completionEvidence = typeof record.completionEvidence === 'string'
    ? record.completionEvidence.trim()
    : '';
  if (completionEvidence.length > 500) {
    return { decision: null, error: 'taskDecision completionEvidence exceeds 500 characters' };
  }

  return {
    decision: {
      outcome,
      reason,
      objectiveComplete: typeof record.objectiveComplete === 'boolean'
        ? record.objectiveComplete
        : outcome === 'complete',
      ...(continuationPolicy ? { continuationPolicy } : {}),
      ...(requiredCompletionBasis ? { requiredCompletionBasis } : {}),
      ...(completionBasis ? { completionBasis } : {}),
      ...(completionEvidence ? { completionEvidence } : {}),
    },
    error: '',
  };
}

export function parseEnvironmentActions(
  value: unknown,
  sessionId?: string,
): Partial<EnvironmentAction>[] {
  if (Array.isArray(value)) {
    return value.map(item => normalizeAction(item, sessionId)).filter(action => action !== null);
  }

  if (typeof value === 'string') {
    const parsed = extractJsonObject(value);
    return parsed ? parseEnvironmentActions(parsed, sessionId) : [];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.actions)) {
    return parseEnvironmentActions(record.actions, sessionId);
  }
  if (record.action) {
    return parseEnvironmentActions(record.action, sessionId);
  }

  const normalized = normalizeAction(record, sessionId);
  return normalized ? [normalized] : [];
}

export function parseEnvironmentModelOutput(
  value: unknown,
  sessionId?: string,
): {
  response: string;
  actions: Partial<EnvironmentAction>[];
  movementRequest: EnvironmentMovementRequest | null;
  movementRequestError: string;
  taskDecision: EnvironmentTaskDecision | null;
  taskDecisionError: string;
} {
  const parsed = typeof value === 'string' ? extractJsonObject(value) : value;
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const response = typeof record?.response === 'string'
    ? record.response.trim()
    : typeof value === 'string' && !parsed
      ? value.trim()
      : '';
  const movement = parseMovementRequest(record?.movementRequest, sessionId);
  const task = parseTaskDecision(record?.taskDecision);

  return {
    response,
    actions: parseEnvironmentActions(parsed, sessionId),
    movementRequest: movement.request,
    movementRequestError: movement.error,
    taskDecision: task.decision,
    taskDecisionError: task.error,
  };
}
