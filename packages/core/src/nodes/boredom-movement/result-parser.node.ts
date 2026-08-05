import { defineNode } from '../types.js';

export interface BoredomMovementReflection {
  observed: string;
  reflection: string;
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

export const boredomMovementResultParserNode = defineNode({
  id: 'boredom_movement_result_parser',
  name: 'Boredom Movement Result',
  category: 'operator',
  inputs: [
    { name: 'response', type: 'any', description: 'Thinking-stripped reflection response' },
  ],
  outputs: [
    { name: 'result', type: 'object', description: 'Validated post-movement observation and reflection' },
    { name: 'observed', type: 'string', description: 'Concise visual observation' },
    { name: 'reflection', type: 'string', description: 'Grounded visible Idle Thought' },
    { name: 'valid', type: 'boolean', description: 'Whether the response satisfied the graph contract' },
    { name: 'error', type: 'string', description: 'Parsing or contract error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates a grounded Boredom Movement reflection and exposes no action or delegation output.',
  async execute(inputs) {
    const raw = typeof inputs.response === 'string'
      ? inputs.response
      : typeof inputs.response?.content === 'string'
        ? inputs.response.content
        : '';
    const parsed = extractJsonObject(raw);
    const invalid = (error: string) => ({
      result: null,
      observed: '',
      reflection: '',
      valid: false,
      error,
    });
    if (!isRecord(parsed)) return invalid('Boredom Movement response was not a JSON object.');
    const observed = cleanText(parsed.observed, 500);
    const reflection = cleanText(parsed.reflection, 500);
    if (!observed) return invalid('Boredom Movement result requires a current visual observation.');
    if (!reflection) return invalid('Boredom Movement result requires a concise reflection.');
    const result: BoredomMovementReflection = { observed, reflection };
    return { result, observed, reflection, valid: true, error: '' };
  },
});
