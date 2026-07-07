import type { EnvironmentAction, EnvironmentActionType, EnvironmentObservation } from '../../environment-interface/index.js';

const ACTION_TYPES = new Set<EnvironmentActionType>([
  'move',
  'look',
  'jump',
  'interact',
  'stop',
  'sendText',
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

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
    sections.push(`Visual frame: ${observation.visual.url ?? observation.visual.dataUrl ?? observation.visual.id}`);
  }

  if (observation.visuals?.length) {
    sections.push([
      'Visual frames:',
      ...observation.visuals.map(frame => `- ${frame.url ?? frame.dataUrl ?? frame.id}`),
    ].join('\n'));
  }

  if (observation.feedback?.length) {
    sections.push([
      'Recent feedback:',
      ...observation.feedback.map(event => `- [${event.type}] ${event.message}`),
    ].join('\n'));
  }

  sections.push(`Available actions: ${observation.capabilities.actions.join(', ')}`);

  return sections.join('\n\n');
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

  const vector = record.vector && typeof record.vector === 'object'
    ? record.vector as EnvironmentAction['vector']
    : undefined;

  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : sessionId,
    type: type as EnvironmentActionType,
    text: typeof record.text === 'string' ? record.text : undefined,
    direction: typeof record.direction === 'string' ? record.direction as EnvironmentAction['direction'] : undefined,
    amount: typeof record.amount === 'number' ? record.amount : undefined,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
    target: typeof record.target === 'string' ? record.target : undefined,
    vector,
    metadata: record.metadata && typeof record.metadata === 'object'
      ? record.metadata as Record<string, unknown>
      : undefined,
  };
}

function numberFromInstruction(text: string): number | undefined {
  const digitMatch = text.match(/\b(\d{1,2})\b/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return value;
    }
  }

  return undefined;
}

function parseNaturalMovementInstruction(text: string, sessionId?: string): Partial<EnvironmentAction> | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (/\b(?:stop|halt|stand still|freeze)\b/.test(normalized)) {
    return { type: 'stop', sessionId };
  }

  const movementVerb = /\b(?:walk|move|go|run|step|head|travel)\b/;
  if (!movementVerb.test(normalized)) {
    return null;
  }

  const direction =
    /\b(?:forward|forwards|ahead)\b/.test(normalized) ? 'forward'
      : /\b(?:back|backward|backwards)\b/.test(normalized) ? 'back'
        : /\bleft\b/.test(normalized) ? 'left'
          : /\bright\b/.test(normalized) ? 'right'
            : undefined;

  if (!direction) {
    return null;
  }

  const stepCount = numberFromInstruction(normalized) ?? 1;
  return {
    type: 'move',
    sessionId,
    direction,
    amount: 1,
    durationMs: Math.max(250, Math.min(1500, stepCount * 150)),
    metadata: {
      source: 'natural-language-fallback',
      instruction: text.trim(),
      stepCount,
    },
  };
}

export function parseEnvironmentActions(
  value: unknown,
  sessionId?: string,
  textFallback = true,
  naturalMovementFallback = false,
): Partial<EnvironmentAction>[] {
  if (Array.isArray(value)) {
    return value.map(item => normalizeAction(item, sessionId)).filter(action => action !== null);
  }

  if (typeof value === 'string') {
    const parsed = extractJsonObject(value);
    if (parsed) {
      return parseEnvironmentActions(parsed, sessionId, textFallback, naturalMovementFallback);
    }
    const movementAction = naturalMovementFallback
      ? parseNaturalMovementInstruction(value, sessionId)
      : null;
    if (movementAction) {
      return [movementAction];
    }
    return textFallback && value.trim()
      ? [{ type: 'sendText', sessionId, text: value.trim() }]
      : [];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.actions)) {
    return parseEnvironmentActions(record.actions, sessionId, textFallback, naturalMovementFallback);
  }
  if (record.action) {
    return parseEnvironmentActions(record.action, sessionId, textFallback, naturalMovementFallback);
  }

  const normalized = normalizeAction(record, sessionId);
  return normalized ? [normalized] : [];
}
