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

export const ENVIRONMENT_CONTINUATION_TYPES = ['advance', 'repeat'] as const;

export type EnvironmentContinuationType = typeof ENVIRONMENT_CONTINUATION_TYPES[number];

export interface EnvironmentTaskDecision {
  outcome: EnvironmentTaskOutcome;
  reason: string;
  objectiveComplete: boolean;
  nextInstruction?: string;
  continuationType?: EnvironmentContinuationType;
  completionBasis?: EnvironmentCompletionBasis;
  completionEvidence?: string;
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

export function stringifyEnvironmentObservation(observation: EnvironmentObservation, systemPrompt: string): string {
  const sections: string[] = [];
  if (systemPrompt.trim()) {
    sections.push(systemPrompt.trim());
  }

  sections.push(`Environment: ${observation.environmentId}`);
  sections.push(`Adapter: ${observation.adapter}`);
  sections.push(`Session: ${observation.sessionId}`);
  sections.push(`Time: ${observation.timestamp}`);

  if (observation.text?.length) {
    sections.push([
      'Recent text:',
      ...observation.text.map(event => {
        const speaker = event.senderName ?? event.senderId ?? event.source;
        return `- [${event.source}] ${speaker}: ${event.text}`;
      }),
    ].join('\n'));
  }

  if (observation.state && Object.keys(observation.state).length > 0) {
    sections.push(`State:\n${JSON.stringify(observation.state, null, 2)}`);
  }

  if (observation.location && Object.keys(observation.location).length > 0) {
    sections.push(`Location:\n${JSON.stringify(observation.location, null, 2)}`);
  }

  if (observation.map && Object.keys(observation.map).length > 0) {
    sections.push(`Map:\n${JSON.stringify(observation.map, null, 2)}`);
  }

  if (observation.visual) {
    sections.push(`Visual frame: ${describeVisualFrame(observation.visual)}`);
  }

  if (observation.visuals?.length) {
    sections.push([
      'Visual frames:',
      ...observation.visuals.map(frame => `- ${describeVisualFrame(frame)}`),
    ].join('\n'));
  }

  if (observation.feedback?.length) {
    sections.push([
      'Recent feedback:',
      ...observation.feedback.map(event => `- [${event.type}] ${event.message}`),
    ].join('\n'));
  }

  sections.push(`Available actions: ${observation.capabilities.actions.join(', ')}`);
  const robotCommands = observation.capabilities.robotCommands
    ?.map(command => command.trim())
    .filter(Boolean);
  if (robotCommands?.length) {
    sections.push(`Supported robot commands: ${robotCommands.join(', ')}`);
  }
  sections.push([
    'Sensor truth contract:',
    '- Capability and readiness fields describe available hardware, not current sensory content.',
    '- Claim current sight only from a fresh visual frame and current hearing only from a current audio transcript.',
    '- Treat false readiness as unavailable and null or missing readiness as unknown.',
  ].join('\n'));
  sections.push([
    'Response contract:',
    '- Return exactly one JSON object: {"response":"short conversational reply","actions":[],"movementRequest":null,"taskDecision":{"outcome":"complete","reason":"why","objectiveComplete":true,"completionBasis":"response","completionEvidence":"the requested result is present in response"}}.',
    '- Put only supported semantic actions in actions[]. Use an empty array when no action is needed.',
    '- taskDecision.outcome must be one of: complete, continue, observe, act, report, curiosity, background, request_user, wait.',
    '- Set objectiveComplete=true only when the current objective is actually satisfied.',
    '- A response, observation, or action result can complete the current step without completing the objective. Do useful work now; do not merely promise future work.',
    '- Actions and movementRequest in the current output have not executed yet. When either contains work, use outcome="act" and objectiveComplete=false; action_result is available only from later terminal feedback.',
    '- When the objective remains incomplete, you may include one narrower objective-bound nextInstruction and continuationType="advance" or "repeat". Use "repeat" only when the original user objective authorizes the same completed action again.',
    '- If an incomplete decision omits either continuation field, the validator re-admits the original objective for a fresh bounded evaluation instead of ending the task.',
    '- Never issue the completed action directly during its feedback pass; a permitted repetition must run later through the bounded validator workflow.',
    '- objectiveComplete=true requires completionBasis and completionEvidence proving the whole objective and every constraint. completionBasis is response, action_result, visual_observation, environment_state, or user_input.',
    '- Visual completion evidence must be fresh and correlated; ambiguous, stale, or missing sensory input cannot prove completion.',
  ].join('\n'));
  if (observation.capabilities.actions.includes('robotCommand')) {
    sections.push([
      'Robot command contract:',
      '- A robotCommand contains a semantic command and optional units, never simulator commands or raw servo values.',
      ...(robotCommands?.length
        ? ['- Use only a command named in Supported robot commands.']
        : []),
      '- Example: {"response":"I will walk forward.","actions":[{"type":"robotCommand","command":"walk","units":3}],"movementRequest":null,"taskDecision":{"outcome":"act","reason":"This is the current required step.","objectiveComplete":false}}.',
    ].join('\n'));
  }
  if (observation.capabilities.actions.includes('captureImage')) {
    sections.push([
      'Robot vision contract:',
      '- The camera is the robot\'s visual sense. captureImage obtains one fresh view of the present physical environment.',
      '- When the current task depends on the present physical scene and no fresh correlated visual frame is available, request captureImage before answering from sight.',
      '- Do not describe the scene until a fresh correlated visual observation arrives.',
    ].join('\n'));
  }
  if (observation.capabilities.actions.includes('robotMotionPlan')) {
    sections.push([
      'Off-script movement routing:',
      '- Decide movement only from the current Task instruction. Conversation history, memories, prior actions, and feedback never authorize a new movement.',
      '- For greetings, general conversation, information questions, or any Task instruction that does not ask the robot to move, keep movementRequest null.',
      '- Prefer an advertised Supported robot command whenever it represents the requested behavior.',
      '- When a requested movement has no matching supported command, leave actions empty and set movementRequest to {"description":"a concise movement description"}.',
      '- Never put robotMotionPlan, joint targets, servo values, PWM values, calibration, or simulator commands in actions.',
      '- Example: {"response":"I will generate that movement.","actions":[],"movementRequest":{"description":"crouch, lift the front-right leg, pause, then stand"},"taskDecision":{"outcome":"act","reason":"This is the current required step.","objectiveComplete":false}}.',
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
  const nextInstruction = typeof record.nextInstruction === 'string'
    ? record.nextInstruction.trim()
    : '';
  if (nextInstruction.length > 500) {
    return { decision: null, error: 'taskDecision nextInstruction exceeds 500 characters' };
  }
  const completionBasis = typeof record.completionBasis === 'string'
    ? record.completionBasis.trim() as EnvironmentCompletionBasis
    : undefined;
  if (completionBasis !== undefined && !ENVIRONMENT_COMPLETION_BASES.includes(completionBasis)) {
    return { decision: null, error: 'taskDecision completionBasis is not supported' };
  }
  const continuationType = typeof record.continuationType === 'string'
    ? record.continuationType.trim() as EnvironmentContinuationType
    : undefined;
  if (continuationType !== undefined && !ENVIRONMENT_CONTINUATION_TYPES.includes(continuationType)) {
    return { decision: null, error: 'taskDecision continuationType is not supported' };
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
      ...(nextInstruction ? { nextInstruction } : {}),
      ...(continuationType ? { continuationType } : {}),
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
