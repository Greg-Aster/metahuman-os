import { audit } from '../../audit.js'
import type { Desire } from '../../agency/types.js'
import { callLLMText } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

export interface DesireFeasibilityResult {
  feasible: boolean
  confidence: number
  reasoning: string
  suggestedApproach?: string
  blockers?: string[]
}

export interface DesireFeasibilityDependencies {
  callModel: typeof callLLMText
}

const DEFAULT_DEPENDENCIES: DesireFeasibilityDependencies = { callModel: callLLMText }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseFeasibilityResponse(response: string): DesireFeasibilityResult {
  const match = response.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Feasibility response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch (error) {
    throw new Error(`Feasibility response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)
    || typeof parsed.feasible !== 'boolean'
    || typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)
    || parsed.confidence < 0 || parsed.confidence > 1
    || typeof parsed.reasoning !== 'string' || !parsed.reasoning.trim()) {
    throw new Error('Feasibility response is missing required typed fields')
  }
  if (parsed.suggestedApproach !== undefined && typeof parsed.suggestedApproach !== 'string') {
    throw new Error('Feasibility response suggestedApproach must be a string')
  }
  if (parsed.blockers !== undefined
    && (!Array.isArray(parsed.blockers) || parsed.blockers.some(blocker => typeof blocker !== 'string'))) {
    throw new Error('Feasibility response blockers must be an array of strings')
  }
  return {
    feasible: parsed.feasible,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning.trim(),
    ...(typeof parsed.suggestedApproach === 'string' && parsed.suggestedApproach.trim()
      ? { suggestedApproach: parsed.suggestedApproach.trim() }
      : {}),
    ...(Array.isArray(parsed.blockers)
      ? { blockers: parsed.blockers.map(blocker => String(blocker).trim()).filter(Boolean) }
      : {}),
  }
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Desire feasibility assessment cancelled', 'AbortError')
}

export async function executeDesireFeasibility(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: DesireFeasibilityDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const desire = inputs.desire as Desire | undefined
  const toolCatalog = typeof inputs.toolCatalog === 'string' ? inputs.toolCatalog.trim() : ''
  if (!desire?.id || !desire.title || !desire.description) {
    throw new Error('Desire feasibility assessment requires a typed desire')
  }
  if (!toolCatalog) throw new Error('Desire feasibility assessment requires the canonical tool catalog')
  if (context.feasibilityCheckEnabled === false) {
    const result: DesireFeasibilityResult = {
      feasible: true,
      confidence: 1,
      reasoning: 'Feasibility assessment is disabled by Agency configuration',
    }
    return { result, ...result }
  }
  const isLongRunning = desire.goalType === 'long_running'
  const goalContext = isLongRunning
    ? `This is a long-running goal. The user performs physical work; assess whether the system can support research, planning, tracking, reminders, or logistics. Completion criteria: ${desire.completionCriteria || 'not specified'}. Milestones: ${desire.milestones?.length || 0}.`
    : 'Assess whether meaningful progress can be completed in one bounded execution session.'
  const prompt = `Assess this desire using only the listed capabilities. Do not infer tools, permissions, or external effects that are absent.

Desire: ${desire.title}
Description: ${desire.description}
Reason: ${desire.reason || 'Not specified'}
Source: ${desire.source}
Goal type: ${desire.goalType || 'one_time'}
${goalContext}

Available capabilities:
${toolCatalog}

Return JSON only:
{"feasible":true,"confidence":0.0,"reasoning":"brief explanation","suggestedApproach":"optional approach","blockers":["specific blocker"]}`
  const response = await dependencies.callModel({
    role: 'orchestrator',
    messages: [{ role: 'user', content: prompt }],
    userId: typeof context.userId === 'string' ? context.userId : context.username,
  })
  throwIfAborted(context)
  const result = parseFeasibilityResponse(response)
  audit({
    category: 'agent',
    level: 'info',
    event: 'desire_feasibility_check',
    actor: 'desire-planner',
    details: {
      desireId: desire.id,
      title: desire.title,
      username: context.username,
      ...result,
    },
  })
  return { result, ...result }
}

export const DesireFeasibilityNode: NodeDefinition = defineNode({
  id: 'desire_feasibility',
  name: 'Assess Desire Feasibility',
  category: 'agency',
  inputs: [
    { name: 'desire', type: 'object' },
    { name: 'toolCatalog', type: 'string' },
  ],
  outputs: [
    { name: 'result', type: 'object' },
    { name: 'feasible', type: 'boolean' },
    { name: 'confidence', type: 'number' },
    { name: 'reasoning', type: 'string' },
    { name: 'suggestedApproach', type: 'string', optional: true },
    { name: 'blockers', type: 'array', optional: true },
  ],
  properties: {},
  description: 'Assesses one desire against the canonical tool catalog through the model router',
  execute: executeDesireFeasibility,
})
