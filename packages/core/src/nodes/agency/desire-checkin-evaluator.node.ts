import { callLLMText } from '../../model-router.js'
import type { Desire } from '../../agency/types.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

export interface DesireCheckinEvaluation {
  statusAssessment: string
  questionsForUser: string[]
  currentMilestoneComplete: boolean
  suggestedNextActions: string[]
  recommendation: 'continue' | 'advance_milestone' | 'adjust_plan' | 'escalate'
  recommendationReason?: string
}

export interface DesireCheckinEvaluatorDependencies {
  callModel: typeof callLLMText
}

const DEFAULT_DEPENDENCIES: DesireCheckinEvaluatorDependencies = { callModel: callLLMText }
const RECOMMENDATIONS = new Set<DesireCheckinEvaluation['recommendation']>([
  'continue',
  'advance_milestone',
  'adjust_plan',
  'escalate',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Desire check-in ${field} must be an array of strings`)
  }
  const items = value.map(item => item.trim()).filter(Boolean)
  if (items.length > limit) throw new Error(`Desire check-in ${field} exceeds ${limit} items`)
  return items
}

export function validateDesireCheckinEvaluation(value: unknown): DesireCheckinEvaluation {
  if (!isRecord(value)
    || typeof value.statusAssessment !== 'string' || !value.statusAssessment.trim()
    || value.statusAssessment.length > 2_000
    || typeof value.currentMilestoneComplete !== 'boolean'
    || typeof value.recommendation !== 'string'
    || !RECOMMENDATIONS.has(value.recommendation as DesireCheckinEvaluation['recommendation'])) {
    throw new Error('Desire check-in evaluation is missing required typed fields')
  }
  if (value.recommendationReason !== undefined
    && (typeof value.recommendationReason !== 'string' || value.recommendationReason.length > 1_000)) {
    throw new Error('Desire check-in recommendationReason must be a bounded string')
  }
  return {
    statusAssessment: value.statusAssessment.trim(),
    questionsForUser: stringList(value.questionsForUser, 'questionsForUser', 5),
    currentMilestoneComplete: value.currentMilestoneComplete,
    suggestedNextActions: stringList(value.suggestedNextActions, 'suggestedNextActions', 5),
    recommendation: value.recommendation as DesireCheckinEvaluation['recommendation'],
    ...(typeof value.recommendationReason === 'string' && value.recommendationReason.trim()
      ? { recommendationReason: value.recommendationReason.trim() }
      : {}),
  }
}

export function parseDesireCheckinEvaluation(text: string): DesireCheckinEvaluation {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Desire check-in response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Desire check-in response was not valid JSON: ${(error as Error).message}`)
  }
  return validateDesireCheckinEvaluation(parsed)
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Desire check-in cancelled', 'AbortError')
}

export async function executeDesireCheckinEvaluator(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: DesireCheckinEvaluatorDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const desire = inputs.desire as Desire | undefined
  const memories = Array.isArray(inputs.memories) ? inputs.memories.slice(0, 10) : []
  if (!desire?.id || desire.goalType !== 'long_running') {
    throw new Error('Desire check-in evaluator requires one long-running desire')
  }
  const currentMilestoneIndex = desire.goalProgress?.currentMilestone || 0
  const response = await dependencies.callModel({
    role: 'orchestrator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      {
        role: 'system',
        content: `Evaluate progress on one long-running user goal. Return exactly one JSON object with this shape:
{"statusAssessment":"brief assessment","questionsForUser":["optional question"],"currentMilestoneComplete":false,"suggestedNextActions":["optional action"],"recommendation":"continue|advance_milestone|adjust_plan|escalate","recommendationReason":"brief reason"}
Use only the supplied goal state and memory references. Do not claim work was completed without evidence. Ask concise questions when evidence is missing.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          goal: {
            id: desire.id,
            title: desire.title,
            description: desire.description,
            reason: desire.reason,
            status: desire.status,
          },
          progress: desire.goalProgress || null,
          currentMilestone: desire.milestones?.[currentMilestoneIndex] || null,
          milestones: desire.milestones || [],
          memoryReferences: memories,
        }),
      },
    ],
    options: { temperature: 0.3, maxTokens: 800 },
  })
  throwIfAborted(context)
  const evaluation = parseDesireCheckinEvaluation(response)
  return { evaluation, ...evaluation }
}

export const DesireCheckinEvaluatorNode: NodeDefinition = defineNode({
  id: 'desire_checkin_evaluator',
  name: 'Evaluate Desire Check-in',
  category: 'agency',
  inputs: [
    { name: 'desire', type: 'object' },
    { name: 'memories', type: 'array' },
  ],
  outputs: [
    { name: 'evaluation', type: 'object' },
    { name: 'statusAssessment', type: 'string' },
    { name: 'questionsForUser', type: 'array' },
    { name: 'currentMilestoneComplete', type: 'boolean' },
    { name: 'suggestedNextActions', type: 'array' },
    { name: 'recommendation', type: 'string' },
    { name: 'recommendationReason', type: 'string', optional: true },
  ],
  properties: {},
  description: 'Evaluates progress for one long-running desire using graph-supplied memory evidence',
  execute: executeDesireCheckinEvaluator,
})
