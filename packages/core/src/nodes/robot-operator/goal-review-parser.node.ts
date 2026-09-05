import { defineNode } from '../types.js'
import type { RobotOperatorDecision } from './decision-parser.node.js'

const OUTCOMES = ['complete', 'continue', 'wait', 'request_user', 'abandon'] as const
const COMPLETION_BASES = [
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const

export const ROBOT_GOAL_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'response',
    'outcome',
    'reason',
    'objective',
    'requiredCompletionBasis',
    'observationSummary',
    'completionEvidence',
    'nextInstruction',
  ],
  properties: {
    response: { type: 'string', maxLength: 500 },
    outcome: { type: 'string', enum: [...OUTCOMES] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    objective: { type: 'string', minLength: 1, maxLength: 1_000 },
    requiredCompletionBasis: { type: 'string', enum: [...COMPLETION_BASES] },
    observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
    completionEvidence: { type: 'string', maxLength: 1_000 },
    nextInstruction: { type: 'string', maxLength: 1_000 },
  },
} as const

const FIELDS: ReadonlySet<string> = new Set(ROBOT_GOAL_REVIEW_JSON_SCHEMA.required)

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

export const robotGoalReviewParserNode = defineNode({
  id: 'robot_goal_review_parser',
  name: 'Validate Robot Goal Review',
  category: 'operator',
  inputs: [
    { name: 'response', type: 'any', description: 'Strict JSON from the Robot Goal Review LLM' },
  ],
  outputs: [
    { name: 'executorDecision', type: 'object', description: 'High-level next instruction only when the LLM chose to continue through Robot Autonomy Executor' },
    { name: 'taskDecision', type: 'object', description: 'Validated LLM assessment persisted to Robot Status' },
    { name: 'response', type: 'string', description: 'Optional concise conversation authored by the LLM' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates one LLM goal review and exposes a next instruction only when the LLM chose continuation.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const invalid = (error: string): never => { throw new Error(error) }
    if (!isRecord(parsed)) return invalid('Robot goal review was not a JSON object.')
    if (Object.keys(parsed).length !== FIELDS.size || Object.keys(parsed).some(field => !FIELDS.has(field))) {
      return invalid('Robot goal review contains unexpected or missing fields.')
    }

    const outcome = cleanText(parsed.outcome, 40)
    const reason = cleanText(parsed.reason, 500)
    const objective = cleanText(parsed.objective, 1_000)
    const requiredCompletionBasis = cleanText(parsed.requiredCompletionBasis, 80)
    const observationSummary = cleanText(parsed.observationSummary, 500)
    const completionEvidence = cleanText(parsed.completionEvidence, 1_000)
    const nextInstruction = cleanText(parsed.nextInstruction, 1_000)
    if (!OUTCOMES.includes(outcome as typeof OUTCOMES[number])) return invalid('Robot goal review outcome is not supported.')
    const objectiveComplete = outcome === 'complete'
    if (!reason || !objective || !observationSummary) return invalid('Robot goal review requires a reason, objective, and observation summary.')
    if (!COMPLETION_BASES.includes(requiredCompletionBasis as typeof COMPLETION_BASES[number])) {
      return invalid('Robot goal review completion basis is not supported.')
    }
    if (outcome === 'continue' && !nextInstruction) {
      return invalid('A continuing goal review requires one next instruction.')
    }
    const executorDecision: RobotOperatorDecision | null = outcome === 'continue'
      ? { observed: observationSummary, instruction: nextInstruction, reason }
      : null
    return {
      executorDecision,
      taskDecision: {
        outcome,
        reason,
        objective,
        objectiveComplete,
        requiredCompletionBasis,
        observationSummary,
        completionEvidence,
        ...(outcome === 'continue' ? { nextInstruction } : {}),
      },
      response: cleanText(parsed.response, 500),
    }
  },
})
