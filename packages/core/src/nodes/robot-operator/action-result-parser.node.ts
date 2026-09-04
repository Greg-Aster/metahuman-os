import { defineNode } from '../types.js'

const OUTCOMES = ['complete', 'incomplete', 'failed', 'wait'] as const
const CONTINUATION_POLICIES = ['none', 'bounded'] as const
const COMPLETION_BASES = [
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const

export const ROBOT_ACTION_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'response',
    'outcome',
    'reason',
    'objective',
    'objectiveComplete',
    'continuationPolicy',
    'requiredCompletionBasis',
    'observationSummary',
    'completionEvidence',
  ],
  properties: {
    response: { type: 'string', maxLength: 500 },
    outcome: { type: 'string', enum: [...OUTCOMES] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    objective: { type: 'string', minLength: 1, maxLength: 1_000 },
    objectiveComplete: { type: 'boolean' },
    continuationPolicy: { type: 'string', enum: [...CONTINUATION_POLICIES] },
    requiredCompletionBasis: { type: 'string', enum: [...COMPLETION_BASES] },
    observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
    completionEvidence: { type: 'string', maxLength: 1_000 },
  },
  allOf: [{
    anyOf: [
      {
        required: ['outcome', 'objectiveComplete', 'continuationPolicy'],
        properties: {
          outcome: { type: 'string', enum: ['complete'] },
          objectiveComplete: { type: 'boolean', enum: [true] },
          continuationPolicy: { type: 'string', enum: ['none'] },
        },
      },
      {
        required: ['outcome', 'objectiveComplete'],
        properties: {
          outcome: { type: 'string', enum: ['incomplete', 'failed', 'wait'] },
          objectiveComplete: { type: 'boolean', enum: [false] },
        },
      },
    ],
  }],
} as const

const FIELDS: ReadonlySet<string> = new Set(ROBOT_ACTION_RESULT_JSON_SCHEMA.required)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function parseJson(value: unknown): unknown {
  const raw = typeof value === 'string'
    ? value
    : isRecord(value) && typeof value.content === 'string'
      ? value.content
      : ''
  try {
    return JSON.parse(raw.trim())
  } catch {
    return null
  }
}

export const robotActionResultParserNode = defineNode({
  id: 'robot_action_result_parser',
  name: 'Interpret Robot Action Result',
  category: 'operator',
  inputs: [
    { name: 'response', type: 'any', description: 'Strict JSON from the Robot Action Result LLM' },
  ],
  outputs: [
    { name: 'taskDecision', type: 'object', description: 'Validated effect of the returned action result on the current objective' },
    { name: 'response', type: 'string', description: 'Optional concise conversation authored by the LLM' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates one LLM interpretation of a correlated robot success or failure. It neither sends an action nor schedules another workflow.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const invalid = (error: string): never => { throw new Error(error) }
    if (!isRecord(parsed)) return invalid('Robot action result was not a JSON object.')
    if (Object.keys(parsed).length !== FIELDS.size || Object.keys(parsed).some(field => !FIELDS.has(field))) {
      return invalid('Robot action result contains unexpected or missing fields.')
    }

    const outcome = cleanText(parsed.outcome, 40)
    const reason = cleanText(parsed.reason, 500)
    const objective = cleanText(parsed.objective, 1_000)
    const continuationPolicy = cleanText(parsed.continuationPolicy, 40)
    const requiredCompletionBasis = cleanText(parsed.requiredCompletionBasis, 80)
    const observationSummary = cleanText(parsed.observationSummary, 500)
    const completionEvidence = cleanText(parsed.completionEvidence, 1_000)
    const objectiveComplete = parsed.objectiveComplete === true
    if (!OUTCOMES.includes(outcome as typeof OUTCOMES[number])) return invalid('Robot action result outcome is not supported.')
    if (!reason || !objective || !observationSummary) return invalid('Robot action result requires a reason, objective, and observation summary.')
    if (!CONTINUATION_POLICIES.includes(continuationPolicy as typeof CONTINUATION_POLICIES[number])) {
      return invalid('Robot action result continuation policy is not supported.')
    }
    if (!COMPLETION_BASES.includes(requiredCompletionBasis as typeof COMPLETION_BASES[number])) {
      return invalid('Robot action result completion basis is not supported.')
    }
    if ((outcome === 'complete') !== objectiveComplete) {
      return invalid('Only a complete result may set objectiveComplete=true.')
    }
    if (objectiveComplete && continuationPolicy !== 'none') {
      return invalid('A completed objective must use continuationPolicy=none.')
    }

    return {
      taskDecision: {
        outcome,
        reason,
        objective,
        objectiveComplete,
        continuationPolicy,
        requiredCompletionBasis,
        observationSummary,
        completionEvidence,
      },
      response: cleanText(parsed.response, 500),
    }
  },
})
