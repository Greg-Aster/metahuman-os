import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export interface GoalReviewInsights {
  insights: string[]
  recommendations: string[]
  focusAreas: string[]
  celebrateWins: string[]
  concernAreas: string[]
}

export interface GoalReviewInsightsDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: GoalReviewInsightsDependencies = { callModel: callLLM }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit || value.some(item => typeof item !== 'string')) {
    throw new Error(`Goal review ${field} must be a bounded string array`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

export function parseGoalReviewInsights(text: string): GoalReviewInsights {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Goal review response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Goal review response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)) throw new Error('Goal review response must be an object')
  return {
    insights: stringList(parsed.insights, 'insights', 10),
    recommendations: stringList(parsed.recommendations, 'recommendations', 10),
    focusAreas: stringList(parsed.focusAreas, 'focusAreas', 10),
    celebrateWins: stringList(parsed.celebrateWins, 'celebrateWins', 10),
    concernAreas: stringList(parsed.concernAreas, 'concernAreas', 10),
  }
}

const executeInput: NodeExecutor = async (_inputs, context) => {
  if (!Array.isArray(context.projects) || !isRecord(context.overallProgress)) {
    throw new Error('Goal Review Input requires project and overall progress data')
  }
  return { projects: context.projects, overallProgress: context.overallProgress }
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Goal review cancelled', 'AbortError')
}

export async function executeGoalReviewInsights(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: GoalReviewInsightsDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const projects = Array.isArray(inputs.projects) ? inputs.projects : []
  if (!isRecord(inputs.overallProgress)) throw new Error('Goal Review Insights requires overall progress')
  if (projects.length === 0) {
    const result: GoalReviewInsights = {
      insights: ['No active projects to review.'],
      recommendations: ['Consider creating projects to organize your goals.'],
      focusAreas: [],
      celebrateWins: [],
      concernAreas: [],
    }
    return { result, ...result }
  }
  if (projects.length > 100) throw new Error('Goal Review Insights accepts at most 100 projects')
  const response = await dependencies.callModel({
    role: 'curator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [{
      role: 'user',
      content: `Analyze this weekly project progress. Provide specific, actionable, evidence-grounded insights. Return JSON only with bounded arrays named insights, recommendations, focusAreas, celebrateWins, and concernAreas.\n\n${JSON.stringify({ projects, overall: inputs.overallProgress })}`,
    }],
    options: { temperature: 0.5, responseFormat: { type: 'json_object' } },
  })
  throwIfAborted(context)
  const result = parseGoalReviewInsights(response.content)
  return { result, ...result }
}

export const GoalReviewInputNode: NodeDefinition = defineNode({
  id: 'goal_review_input',
  name: 'Goal Review Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'projects', type: 'array' },
    { name: 'overallProgress', type: 'object' },
  ],
  properties: {},
  description: 'Admits deterministic weekly project progress into the goal-review graph',
  execute: executeInput,
})

export const GoalReviewInsightsNode: NodeDefinition = defineNode({
  id: 'goal_review_insights',
  name: 'Generate Goal Review Insights',
  category: 'agent',
  inputs: [
    { name: 'projects', type: 'array' },
    { name: 'overallProgress', type: 'object' },
  ],
  outputs: [
    { name: 'result', type: 'object' },
    { name: 'insights', type: 'array' },
    { name: 'recommendations', type: 'array' },
    { name: 'focusAreas', type: 'array' },
    { name: 'celebrateWins', type: 'array' },
    { name: 'concernAreas', type: 'array' },
  ],
  properties: {},
  description: 'Generates typed weekly goal insights from graph-supplied progress evidence',
  execute: executeGoalReviewInsights,
})
