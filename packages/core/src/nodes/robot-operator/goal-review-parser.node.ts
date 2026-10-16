import { defineNode, NodeInputValidationError } from '../types.js'
import { visualObservationOutput } from '../environment/visual-observation-output.js'

const OUTCOMES = ['complete', 'wait', 'request_user', 'abandon'] as const
const COMPLETION_BASES = [
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const
const FIELDS = new Set([
  'outcome', 'reason', 'objective', 'completionCriteria', 'requiredCompletionBasis',
  'observationSummary', 'completionEvidence',
])

export function buildRobotGoalReviewJsonSchema() {
  return { anyOf: [false, true].map(complete => ({
    type: 'object',
    additionalProperties: false,
    required: [...FIELDS],
    properties: {
      outcome: {
        type: 'string',
        enum: complete ? ['complete'] : OUTCOMES.filter(outcome => outcome !== 'complete'),
        description: 'Internal objective-lifecycle decision.',
      },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
      objective: { type: 'string', minLength: 1, maxLength: 1_000 },
      completionCriteria: { type: 'string', minLength: 1, maxLength: 2_000 },
      requiredCompletionBasis: { type: 'string', enum: [...COMPLETION_BASES] },
      observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
      completionEvidence: { type: 'string', maxLength: 1_000, ...(complete ? { minLength: 1 } : {}),
        description: 'Concrete supplied evidence establishing completion; required to be non-empty only for outcome complete.' },
    },
  })) }
}

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

function currentObjective(value: unknown): string {
  const status = isRecord(value) ? value : null
  const task = isRecord(status?.task) ? status.task : null
  return cleanText(task?.objective, 1_000)
}

export const robotGoalReviewParserNode = defineNode({
  id: 'robot_goal_review_parser',
  name: 'Validate Robot Goal Review',
  category: 'operator',
  inputs: [
    { name: 'frames', type: 'array', optional: true, description: 'Exact images supplied to the goal-review model' },
    { name: 'response', type: 'any', description: 'Strict JSON from the Robot Goal Review LLM' },
    { name: 'execution', type: 'object', description: 'Checkpointed execution whose objective is being reviewed' },
  ],
  outputs: [
    { name: 'visualObservation', type: 'object', description: 'Optional image interpretation independent of goal progress' },
    { name: 'taskDecision', type: 'object', description: 'Validated LLM assessment persisted to Robot Status' },
    { name: 'assessment', type: 'object', description: 'Goal assessment and evidence for the final conversation context' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates confirmation of the current objective without selecting another activity.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const invalid = (error: string): never => { throw new NodeInputValidationError('response', error) }
    if (!isRecord(parsed)) return invalid('Robot goal review was not a JSON object.')
    if ([...FIELDS].some(field => !(field in parsed)) || Object.keys(parsed).some(field => !FIELDS.has(field) && field !== 'visualObservation')) {
      return invalid('Robot goal review contains unexpected or missing fields.')
    }

    const outcome = cleanText(parsed.outcome, 40)
    const reason = cleanText(parsed.reason, 500)
    const objective = cleanText(parsed.objective, 1_000)
    const completionCriteria = cleanText(parsed.completionCriteria, 2_000)
    const requiredCompletionBasis = cleanText(parsed.requiredCompletionBasis, 80)
    const observationSummary = cleanText(parsed.observationSummary, 500)
    const completionEvidence = cleanText(parsed.completionEvidence, 1_000)
    if (!OUTCOMES.includes(outcome as typeof OUTCOMES[number])) return invalid('Robot goal review outcome is not supported.')
    const objectiveComplete = outcome === 'complete'
    if (!currentObjective(inputs.execution)) throw new Error('Robot goal review requires one current execution objective.')
    if (!objective || !completionCriteria) return invalid('Robot goal review requires an objective and completion criteria.')
    if (!reason || !observationSummary) return invalid('Robot goal review requires a reason and observation summary.')
    if (!COMPLETION_BASES.includes(requiredCompletionBasis as typeof COMPLETION_BASES[number])) {
      return invalid('Robot goal review completion basis is not supported.')
    }
    if (outcome === 'complete' && !completionEvidence) {
      return invalid('A completed goal review requires supplied completion evidence.')
    }
    return {
      visualObservation: visualObservationOutput(parsed.visualObservation, inputs.frames),
      taskDecision: {
        outcome,
        reason,
        objective,
        completionCriteria,
        objectiveComplete,
        requiredCompletionBasis,
        observationSummary,
        completionEvidence,
      },
      assessment: parsed,
    }
  },
})
