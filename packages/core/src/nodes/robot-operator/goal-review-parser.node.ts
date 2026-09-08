import { defineNode } from '../types.js'
import { buildRobotAutonomyControllerJsonSchema, parseRobotAutonomyChoice } from './autonomy-controller-parser.node.js'

const OUTCOMES = ['complete', 'continue', 'wait', 'request_user', 'abandon'] as const
const COMPLETION_BASES = [
  'action_result',
  'visual_observation',
  'environment_state',
  'user_input',
] as const

export function buildRobotGoalReviewJsonSchema(tasks: unknown) {
  const choice = buildRobotAutonomyControllerJsonSchema(tasks)
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'response',
      'outcome',
      'reason',
      'requiredCompletionBasis',
      'observationSummary',
      'completionEvidence',
      'taskId',
      'instruction',
    ],
    properties: {
      ...choice.properties,
      response: {
        type: 'string',
        maxLength: 500,
        description: 'Optional natural language addressed to the user. Leave empty when there is nothing useful to say; never place an outcome token, workflow name, agent name, or internal next instruction here.',
      },
      outcome: {
        type: 'string',
        enum: [...OUTCOMES],
        description: 'Internal objective-lifecycle decision. This field controls routing and is not spoken.',
      },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
      requiredCompletionBasis: { type: 'string', enum: [...COMPLETION_BASES] },
      observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
      completionEvidence: { type: 'string', maxLength: 1_000, description: 'Concrete supplied evidence establishing completion; required to be non-empty only for outcome complete.' },
    },
  } as const
}

const FIELDS: ReadonlySet<string> = new Set(buildRobotGoalReviewJsonSchema([]).required)

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
    { name: 'response', type: 'any', description: 'Strict JSON from the Robot Goal Review LLM' },
    { name: 'execution', type: 'object', description: 'Checkpointed execution whose objective is being reviewed' },
    { name: 'availableTasks', type: 'array', description: 'Same capability catalog used for the initial autonomy decision' },
  ],
  outputs: [
    { name: 'hasSelection', type: 'boolean', description: 'The LLM selected a capability to authorize before dispatch' },
    { name: 'awaitContinuation', type: 'boolean', description: 'The LLM chose to wait for a new event or user input' },
    { name: 'executorDecision', type: 'object', description: 'High-level instruction when the LLM selected Robot Autonomy Executor' },
    { name: 'agentDecision', type: 'object', description: 'Selected specialist and its LLM-authored purpose, or null' },
    { name: 'taskDecision', type: 'object', description: 'Validated LLM assessment persisted to Robot Status' },
    { name: 'response', type: 'string', description: 'Optional concise conversation authored by the LLM' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates the objective assessment and optional next capability chosen by the LLM; neither choice is inferred from the other.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const invalid = (error: string): never => { throw new Error(error) }
    if (!isRecord(parsed)) return invalid('Robot goal review was not a JSON object.')
    if (Object.keys(parsed).length !== FIELDS.size || Object.keys(parsed).some(field => !FIELDS.has(field))) {
      return invalid('Robot goal review contains unexpected or missing fields.')
    }

    const outcome = cleanText(parsed.outcome, 40)
    const reason = cleanText(parsed.reason, 500)
    const objective = currentObjective(inputs.execution)
    const requiredCompletionBasis = cleanText(parsed.requiredCompletionBasis, 80)
    const observationSummary = cleanText(parsed.observationSummary, 500)
    const completionEvidence = cleanText(parsed.completionEvidence, 1_000)
    if (!OUTCOMES.includes(outcome as typeof OUTCOMES[number])) return invalid('Robot goal review outcome is not supported.')
    const objectiveComplete = outcome === 'complete'
    if (!objective) return invalid('Robot goal review requires one current execution objective.')
    if (!reason || !observationSummary) return invalid('Robot goal review requires a reason and observation summary.')
    if (!COMPLETION_BASES.includes(requiredCompletionBasis as typeof COMPLETION_BASES[number])) {
      return invalid('Robot goal review completion basis is not supported.')
    }
    if (outcome === 'complete' && !completionEvidence) {
      return invalid('A completed goal review requires supplied completion evidence.')
    }
    const choice = parseRobotAutonomyChoice(JSON.stringify({
      response: parsed.response, taskId: parsed.taskId, instruction: parsed.instruction,
      reason: parsed.reason, observationSummary: parsed.observationSummary,
    }), inputs.availableTasks)
    return {
      hasSelection: Boolean(choice.taskDecision || choice.executorDecision),
      awaitContinuation: !choice.taskDecision && !choice.executorDecision
        && ['continue', 'wait', 'request_user'].includes(outcome),
      executorDecision: choice.executorDecision,
      agentDecision: choice.taskDecision,
      taskDecision: {
        outcome,
        reason,
        objective,
        objectiveComplete,
        requiredCompletionBasis,
        observationSummary,
        completionEvidence,
      },
      response: cleanText(parsed.response, 500),
    }
  },
})
