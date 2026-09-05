import { defineNode } from '../types.js'

const OBJECTIVE_STATES = [
  'achieved',
  'not_achieved',
  'step_failed',
  'awaiting_evidence',
] as const
const COMPLETION_BASES = [
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const

const ROBOT_ACTION_TASK_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'overallObjectiveState',
    'reason',
    'objective',
    'requiredCompletionBasis',
    'observationSummary',
    'completionEvidence',
  ],
  properties: {
    overallObjectiveState: {
      type: 'string',
      enum: [...OBJECTIVE_STATES],
      description: 'State of the entire saved objective after this action, not the execution status of the action itself.',
    },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    objective: { type: 'string', minLength: 1, maxLength: 1_000 },
    requiredCompletionBasis: { type: 'string', enum: [...COMPLETION_BASES] },
    observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
    completionEvidence: { type: 'string', maxLength: 1_000 },
  },
} as const

export const ROBOT_ACTION_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['response', 'taskDecision'],
  properties: {
    response: { type: 'string', maxLength: 500 },
    taskDecision: {
      anyOf: [
        { type: 'null' },
        ROBOT_ACTION_TASK_RESULT_JSON_SCHEMA,
      ],
    },
  },
} as const

const RESULT_FIELDS: ReadonlySet<string> = new Set(ROBOT_ACTION_RESULT_JSON_SCHEMA.required)
const TASK_FIELDS: ReadonlySet<string> = new Set(ROBOT_ACTION_TASK_RESULT_JSON_SCHEMA.required)

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
    { name: 'taskDecision', type: 'object', description: 'Validated task effect, or null when the returned action was standalone' },
    { name: 'response', type: 'string', description: 'Optional concise conversation authored by the LLM' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates one LLM interpretation of a correlated robot success or failure. It neither sends an action nor schedules another workflow.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const invalid = (error: string): never => { throw new Error(error) }
    if (!isRecord(parsed)) return invalid('Robot action result was not a JSON object.')
    if (Object.keys(parsed).length !== RESULT_FIELDS.size || Object.keys(parsed).some(field => !RESULT_FIELDS.has(field))) {
      return invalid('Robot action result contains unexpected or missing fields.')
    }
    const response = cleanText(parsed.response, 500)
    if (parsed.taskDecision === null) return { taskDecision: null, response }
    if (!isRecord(parsed.taskDecision)) return invalid('Robot action result taskDecision must be an object or null.')
    const decision = parsed.taskDecision
    if (Object.keys(decision).length !== TASK_FIELDS.size || Object.keys(decision).some(field => !TASK_FIELDS.has(field))) {
      return invalid('Robot action result taskDecision contains unexpected or missing fields.')
    }

    const overallObjectiveState = cleanText(decision.overallObjectiveState, 40)
    const reason = cleanText(decision.reason, 500)
    const objective = cleanText(decision.objective, 1_000)
    const requiredCompletionBasis = cleanText(decision.requiredCompletionBasis, 80)
    const observationSummary = cleanText(decision.observationSummary, 500)
    const completionEvidence = cleanText(decision.completionEvidence, 1_000)
    if (!OBJECTIVE_STATES.includes(overallObjectiveState as typeof OBJECTIVE_STATES[number])) {
      return invalid('Robot action result overall objective state is not supported.')
    }
    const outcome = overallObjectiveState === 'achieved'
      ? 'complete'
      : overallObjectiveState === 'not_achieved'
        ? 'incomplete'
        : overallObjectiveState === 'step_failed'
          ? 'failed'
          : 'wait'
    const objectiveComplete = overallObjectiveState === 'achieved'
    if (!reason || !objective || !observationSummary) return invalid('Robot action result requires a reason, objective, and observation summary.')
    if (!COMPLETION_BASES.includes(requiredCompletionBasis as typeof COMPLETION_BASES[number])) {
      return invalid('Robot action result completion basis is not supported.')
    }

    return {
      taskDecision: {
        outcome,
        reason,
        objective,
        objectiveComplete,
        requiredCompletionBasis,
        observationSummary,
        completionEvidence,
      },
      response,
    }
  },
})
