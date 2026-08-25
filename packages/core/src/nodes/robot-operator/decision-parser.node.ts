import { defineNode } from '../types.js';

export interface RobotOperatorDecision {
  observed: string;
  instruction: string;
  reason: string;
}

export const ROBOT_OPERATOR_DECISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['observed', 'instruction', 'reason'],
  properties: {
    observed: { type: 'string', minLength: 1, maxLength: 500 },
    instruction: { type: 'string', minLength: 1, maxLength: 1_000 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
  },
} as const;

const DECISION_FIELDS = new Set(['observed', 'instruction', 'reason']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function strictJsonObject(value: string): unknown {
  try {
    return JSON.parse(value.trim());
  } catch {
    return null;
  }
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
    { name: 'instruction', type: 'string', description: 'High-level intention delegated to Boredom Autonomy' },
    { name: 'reason', type: 'string', description: 'Concise inspectable decision reason' },
    { name: 'valid', type: 'boolean', description: 'Whether the model response satisfied the graph contract' },
    { name: 'error', type: 'string', description: 'Parsing or contract error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Strictly validates one planner-authored observation and high-level autonomy instruction.',
  async execute(inputs) {
    const raw = typeof inputs.response === 'string'
      ? inputs.response
      : typeof inputs.response?.content === 'string'
        ? inputs.response.content
        : '';
    const parsed = strictJsonObject(raw);
    const invalid = (error: string) => ({
      decision: null,
      observed: '',
      instruction: '',
      reason: '',
      valid: false,
      error,
    });
    if (!isRecord(parsed)) return invalid('Robot Operator response was not a JSON object.');
    const unknown = Object.keys(parsed).filter(field => !DECISION_FIELDS.has(field));
    if (unknown.length > 0 || Object.keys(parsed).length !== DECISION_FIELDS.size) {
      return invalid('Robot Operator decision must contain exactly observed, instruction, and reason.');
    }
    const observed = cleanText(parsed.observed, 500);
    const reason = cleanText(parsed.reason, 500);
    const instruction = cleanText(parsed.instruction, 1_000);
    if (!observed) return invalid('Robot Operator decision requires a current observation summary.');
    if (!reason) return invalid('Robot Operator decision requires a concise reason.');
    if (!instruction) return invalid('Environment delegation requires a high-level intention.');
    const decision: RobotOperatorDecision = {
      observed,
      instruction,
      reason,
    };
    return {
      decision,
      observed: decision.observed,
      instruction: decision.instruction,
      reason: decision.reason,
      valid: true,
      error: '',
    };
  },
});
