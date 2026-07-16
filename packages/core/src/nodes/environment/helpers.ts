import type { EnvironmentAction, EnvironmentActionType, EnvironmentObservation } from '../../environment-interface/index.js';

const ACTION_TYPES = new Set<EnvironmentActionType>([
  'move',
  'look',
  'jump',
  'interact',
  'stop',
  'robotCommand',
  'sendText',
]);

export interface DirectRobotInstruction {
  action: Partial<EnvironmentAction>;
  response: string;
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
  if (!match) {
    const command = matchAdvertisedRobotCommand(instruction, supportedRobotCommands);
    return command
      ? {
          action: { type: 'robotCommand', command, sessionId },
          response: `I will ${command}.`,
        }
      : null;
  }

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

function matchAdvertisedRobotCommand(
  instruction: string,
  supportedRobotCommands?: string[],
): string | null {
  if (!supportedRobotCommands?.length) return null;
  const phrase = instruction
    .replace(/^(?:please\s+)?(?:have\s+)?(?:the\s+)?robot\s+/, '')
    .replace(/^(?:please\s+)?(?:do|perform)\s+(?:a|an|the)?\s*/, '')
    .replace(/^(?:please\s+)/, '');
  const normalizedPhrase = normalizedRobotCommand(phrase);
  const command = supportedRobotCommands.find(candidate => (
    normalizedRobotCommand(candidate) === normalizedPhrase
  ));
  return command?.trim().toLowerCase() || null;
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
    'Response contract:',
    '- Return exactly one JSON object: {"response":"short conversational reply","actions":[]}.',
    '- Put only supported semantic actions in actions[]. Use an empty array when no action is needed.',
  ].join('\n'));
  if (observation.capabilities.actions.includes('robotCommand')) {
    sections.push([
      'Robot command contract:',
      '- A robotCommand contains a semantic command and optional units, never simulator commands or raw servo values.',
      ...(robotCommands?.length
        ? ['- Use only a command named in Supported robot commands.']
        : []),
      '- Example: {"response":"I will walk forward.","actions":[{"type":"robotCommand","command":"walk","units":3}]}.',
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
  if (typeof type !== 'string' || !ACTION_TYPES.has(type as EnvironmentActionType)) {
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
): { response: string; actions: Partial<EnvironmentAction>[] } {
  const parsed = typeof value === 'string' ? extractJsonObject(value) : value;
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const response = typeof record?.response === 'string'
    ? record.response.trim()
    : typeof value === 'string' && !parsed
      ? value.trim()
      : '';

  return {
    response,
    actions: parseEnvironmentActions(parsed, sessionId),
  };
}
