import { defineNode } from '../types.js';

export type RobotOperatorRoute = 'environment' | 'wait';

export interface RobotOperatorDecision {
  route: RobotOperatorRoute;
  instruction: string;
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const robotOperatorDecisionParserNode = defineNode({
  id: 'robot_operator_decision_parser',
  name: 'Robot Operator Decision Parser',
  category: 'operator',
  inputs: [
    { name: 'response', type: 'any', description: 'Thinking-stripped Robot Operator LLM response' },
  ],
  outputs: [
    { name: 'decision', type: 'object', description: 'Validated high-level route and intention' },
    { name: 'route', type: 'string', description: 'environment or wait' },
    { name: 'instruction', type: 'string', description: 'High-level intention delegated to Environment Mode' },
    { name: 'reason', type: 'string', description: 'Concise inspectable decision reason' },
    { name: 'valid', type: 'boolean', description: 'Whether the model response satisfied the graph contract' },
    { name: 'error', type: 'string', description: 'Parsing or contract error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates a Robot Operator route without inventing fallback behavior or execution details.',
  async execute(inputs) {
    const raw = typeof inputs.response === 'string'
      ? inputs.response
      : typeof inputs.response?.content === 'string'
        ? inputs.response.content
        : '';
    const parsed = extractJsonObject(raw);
    const invalid = (error: string) => ({
      decision: { route: 'wait', instruction: '', reason: error } satisfies RobotOperatorDecision,
      route: 'wait',
      instruction: '',
      reason: error,
      valid: false,
      error,
    });
    if (!isRecord(parsed)) return invalid('Robot Operator response was not a JSON object.');
    const route = cleanText(parsed.route, 40).toLowerCase();
    if (route !== 'environment' && route !== 'wait') {
      return invalid('Robot Operator route must be environment or wait.');
    }
    const reason = cleanText(parsed.reason, 500);
    const instruction = cleanText(parsed.instruction, 1_000);
    if (!reason) return invalid('Robot Operator decision requires a concise reason.');
    if (route === 'environment' && !instruction) {
      return invalid('Environment delegation requires a high-level instruction.');
    }
    const decision: RobotOperatorDecision = {
      route,
      instruction: route === 'environment' ? instruction : '',
      reason,
    };
    return {
      decision,
      route: decision.route,
      instruction: decision.instruction,
      reason: decision.reason,
      valid: true,
      error: '',
    };
  },
});
