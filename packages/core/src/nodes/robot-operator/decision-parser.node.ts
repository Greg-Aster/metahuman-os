import { defineNode } from '../types.js';

export interface RobotOperatorDecision {
  observed: string;
  instruction: string;
  requiresAction: boolean;
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
    { name: 'decision', type: 'object', description: 'Validated grounded observation and free-form high-level intention' },
    { name: 'observed', type: 'string', description: 'Concise summary grounded in the current robot stimulus' },
    { name: 'instruction', type: 'string', description: 'High-level intention delegated to Environment Mode' },
    { name: 'requiresAction', type: 'boolean', description: 'LLM-authored decision that satisfying the intention requires environment work rather than conversation alone' },
    { name: 'reason', type: 'string', description: 'Concise inspectable decision reason' },
    { name: 'valid', type: 'boolean', description: 'Whether the model response satisfied the graph contract' },
    { name: 'error', type: 'string', description: 'Parsing or contract error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates one grounded observation and free-form intention without classifying or inventing robot behavior.',
  async execute(inputs) {
    const raw = typeof inputs.response === 'string'
      ? inputs.response
      : typeof inputs.response?.content === 'string'
        ? inputs.response.content
        : '';
    const parsed = extractJsonObject(raw);
    const invalid = (error: string) => ({
      decision: null,
      observed: '',
      instruction: '',
      requiresAction: false,
      reason: '',
      valid: false,
      error,
    });
    if (!isRecord(parsed)) return invalid('Robot Operator response was not a JSON object.');
    const observed = cleanText(parsed.observed, 500);
    const reason = cleanText(parsed.reason, 500);
    const instruction = cleanText(parsed.instruction, 1_000);
    if (!observed) return invalid('Robot Operator decision requires a current observation summary.');
    if (!reason) return invalid('Robot Operator decision requires a concise reason.');
    if (!instruction) return invalid('Environment delegation requires a high-level intention.');
    if (typeof parsed.requiresAction !== 'boolean') {
      return invalid('Robot Operator decision requires an explicit requiresAction boolean.');
    }
    const decision: RobotOperatorDecision = {
      observed,
      instruction,
      requiresAction: parsed.requiresAction,
      reason,
    };
    return {
      decision,
      observed: decision.observed,
      instruction: decision.instruction,
      requiresAction: decision.requiresAction,
      reason: decision.reason,
      valid: true,
      error: '',
    };
  },
});
