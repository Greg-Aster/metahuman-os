import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export interface SelfHealingAnalysis {
  analysis: string
  suggestedFix: string
  diff?: string
  confidence: 'high' | 'medium' | 'low'
}

export interface SelfHealingAnalysisDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: SelfHealingAnalysisDependencies = { callModel: callLLM }
const CONFIDENCE = new Set<SelfHealingAnalysis['confidence']>(['high', 'medium', 'low'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseSelfHealingAnalysis(text: string): SelfHealingAnalysis {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Self-healing analysis did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Self-healing analysis was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)
    || typeof parsed.analysis !== 'string' || !parsed.analysis.trim() || parsed.analysis.length > 4_000
    || typeof parsed.suggestedFix !== 'string' || !parsed.suggestedFix.trim() || parsed.suggestedFix.length > 8_000
    || typeof parsed.confidence !== 'string' || !CONFIDENCE.has(parsed.confidence as SelfHealingAnalysis['confidence'])
    || (parsed.diff !== undefined && (typeof parsed.diff !== 'string' || parsed.diff.length > 20_000))) {
    throw new Error('Self-healing analysis is missing required typed fields')
  }
  return {
    analysis: parsed.analysis.trim(),
    suggestedFix: parsed.suggestedFix.trim(),
    confidence: parsed.confidence as SelfHealingAnalysis['confidence'],
    ...(typeof parsed.diff === 'string' && parsed.diff.trim() ? { diff: parsed.diff } : {}),
  }
}

const executeInput: NodeExecutor = async (_inputs, context) => {
  if (!isRecord(context.typeScriptError)
    || typeof context.typeScriptError.file !== 'string'
    || typeof context.typeScriptError.message !== 'string'
    || typeof context.errorContext !== 'string') {
    throw new Error('Self-healing Input requires one TypeScript error and source context')
  }
  return { error: context.typeScriptError, sourceContext: context.errorContext }
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Self-healing analysis cancelled', 'AbortError')
}

export async function executeSelfHealingAnalysis(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: SelfHealingAnalysisDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  if (!isRecord(inputs.error) || typeof inputs.sourceContext !== 'string') {
    throw new Error('Self-healing Analysis requires graph-supplied error context')
  }
  const response = await dependencies.callModel({
    role: 'orchestrator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      {
        role: 'system',
        content: 'Analyze one TypeScript compile error. Explain the root cause and propose one specific source repair. Do not claim the repair was applied.',
      },
      {
        role: 'user',
        content: `Error: ${JSON.stringify(inputs.error)}\n\nSource context:\n\`\`\`typescript\n${inputs.sourceContext}\n\`\`\`\n\nReturn JSON only: {"analysis":"root cause","suggestedFix":"specific change","diff":"optional before/after","confidence":"high|medium|low"}`,
      },
    ],
    options: { maxTokens: 1_024, temperature: 0.2 },
  })
  throwIfAborted(context)
  const result = parseSelfHealingAnalysis(response.content)
  return { result, ...result }
}

export const SelfHealingInputNode: NodeDefinition = defineNode({
  id: 'self_healing_input',
  name: 'Self-healing Error Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'error', type: 'object' },
    { name: 'sourceContext', type: 'string' },
  ],
  properties: {},
  description: 'Admits one TypeScript error and bounded source context for analysis',
  execute: executeInput,
})

export const SelfHealingAnalysisNode: NodeDefinition = defineNode({
  id: 'self_healing_analysis',
  name: 'Analyze TypeScript Error',
  category: 'active-operator',
  inputs: [
    { name: 'error', type: 'object' },
    { name: 'sourceContext', type: 'string' },
  ],
  outputs: [
    { name: 'result', type: 'object' },
    { name: 'analysis', type: 'string' },
    { name: 'suggestedFix', type: 'string' },
    { name: 'diff', type: 'string', optional: true },
    { name: 'confidence', type: 'string' },
  ],
  properties: {},
  description: 'Produces a typed, review-only TypeScript repair proposal',
  execute: executeSelfHealingAnalysis,
})
