import { callLLMText } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export interface SemanticTurnDecision {
  complete: boolean
  confidence: number
  reason: string
}

export interface SemanticTurnClassifierDependencies {
  callModel: typeof callLLMText
}

const DEFAULT_DEPENDENCIES: SemanticTurnClassifierDependencies = { callModel: callLLMText }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseSemanticTurnDecision(text: string): SemanticTurnDecision {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Semantic turn response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Semantic turn response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed)
    || typeof parsed.complete !== 'boolean'
    || typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)
    || parsed.confidence < 0 || parsed.confidence > 1
    || typeof parsed.reason !== 'string' || !parsed.reason.trim() || parsed.reason.length > 500) {
    throw new Error('Semantic turn response is missing required typed fields')
  }
  return {
    complete: parsed.complete,
    confidence: parsed.confidence,
    reason: parsed.reason.trim(),
  }
}

const executeInput: NodeExecutor = async (_inputs, context) => {
  if (typeof context.transcript !== 'string' || !context.transcript.trim()
    || context.transcript.length > 20_000) {
    throw new Error('Semantic Turn Input requires a bounded transcript')
  }
  if (context.previousContext !== undefined
    && (typeof context.previousContext !== 'string' || context.previousContext.length > 20_000)) {
    throw new Error('Semantic Turn Input previous context must be a bounded string')
  }
  return {
    transcript: context.transcript.trim(),
    previousContext: typeof context.previousContext === 'string'
      ? context.previousContext.trim()
      : '',
  }
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Semantic turn classification cancelled', 'AbortError')
}

export async function executeSemanticTurnClassifier(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: SemanticTurnClassifierDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const transcript = typeof inputs.transcript === 'string' ? inputs.transcript.trim() : ''
  const previousContext = typeof inputs.previousContext === 'string' ? inputs.previousContext.trim() : ''
  if (!transcript) throw new Error('Semantic Turn Classifier requires a transcript')
  if (transcript.length < 3) {
    const decision: SemanticTurnDecision = { complete: false, confidence: 0.9, reason: 'too short' }
    return { decision, ...decision }
  }
  const response = await dependencies.callModel({
    role: 'orchestrator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      {
        role: 'system',
        content: 'Classify whether the user has completed the current spoken utterance or is likely to continue. Trailing conjunctions, prepositions, filler, setup phrases, and incomplete lists indicate incomplete. Complete questions, commands, statements, greetings, and acknowledgments indicate complete. Return JSON only: {"complete":true,"confidence":0.0,"reason":"brief reason"}.',
      },
      {
        role: 'user',
        content: `${previousContext ? `Previous context: ${previousContext}\n\n` : ''}User: ${transcript}`,
      },
    ],
    options: { temperature: 0.1, max_tokens: 100 },
  })
  throwIfAborted(context)
  const decision = parseSemanticTurnDecision(response)
  return { decision, ...decision }
}

export const SemanticTurnInputNode: NodeDefinition = defineNode({
  id: 'semantic_turn_input',
  name: 'Semantic Turn Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'transcript', type: 'string' },
    { name: 'previousContext', type: 'string' },
  ],
  properties: {},
  description: 'Admits one bounded voice transcript and optional preceding context',
  execute: executeInput,
})

export const SemanticTurnClassifierNode: NodeDefinition = defineNode({
  id: 'semantic_turn_classifier',
  name: 'Classify Semantic Turn',
  category: 'agent',
  inputs: [
    { name: 'transcript', type: 'string' },
    { name: 'previousContext', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'decision', type: 'object' },
    { name: 'complete', type: 'boolean' },
    { name: 'confidence', type: 'number' },
    { name: 'reason', type: 'string' },
  ],
  properties: {},
  description: 'Classifies whether a spoken utterance is complete through the graph runtime',
  execute: executeSemanticTurnClassifier,
})
