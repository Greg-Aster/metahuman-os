import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext, type NodeExecutor } from '../types.js'

export type PreferenceLearningOperation = 'extract' | 'contradiction'

export interface ExtractedPreference {
  category: 'communication' | 'decision' | 'workflow' | 'interaction' | 'content' | 'timing' | 'style' | 'avoidance'
  description: string
  behavior: string
  confidence: number
}

export interface PreferenceContradiction {
  contradicts: boolean
  explanation?: string
}

export interface PreferenceLearningDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: PreferenceLearningDependencies = { callModel: callLLM }
const CATEGORIES = new Set<ExtractedPreference['category']>([
  'communication', 'decision', 'workflow', 'interaction', 'content', 'timing', 'style', 'avoidance',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error(`${label} response did not contain a JSON object`)
  try {
    const parsed = JSON.parse(json)
    if (!isRecord(parsed)) throw new Error('response is not an object')
    return parsed
  } catch (error) {
    throw new Error(`${label} response was not valid JSON: ${(error as Error).message}`)
  }
}

export function parseExtractedPreferences(text: string): ExtractedPreference[] {
  const parsed = parseJsonObject(text, 'Preference extraction')
  if (!Array.isArray(parsed.preferences) || parsed.preferences.length > 30) {
    throw new Error('Preference extraction requires a bounded preferences array')
  }
  return parsed.preferences.map((value, index) => {
    if (!isRecord(value)
      || typeof value.category !== 'string' || !CATEGORIES.has(value.category as ExtractedPreference['category'])
      || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 1_000
      || typeof value.behavior !== 'string' || !value.behavior.trim() || value.behavior.length > 1_000
      || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
      || value.confidence < 0 || value.confidence > 1) {
      throw new Error(`Preference extraction item ${index + 1} is invalid`)
    }
    return {
      category: value.category as ExtractedPreference['category'],
      description: value.description.trim(),
      behavior: value.behavior.trim(),
      confidence: value.confidence,
    }
  })
}

export function parsePreferenceContradiction(text: string): PreferenceContradiction {
  const parsed = parseJsonObject(text, 'Preference contradiction')
  if (typeof parsed.contradicts !== 'boolean'
    || (parsed.explanation !== undefined
      && (typeof parsed.explanation !== 'string' || parsed.explanation.length > 2_000))) {
    throw new Error('Preference contradiction response is missing required typed fields')
  }
  return {
    contradicts: parsed.contradicts,
    ...(typeof parsed.explanation === 'string' && parsed.explanation.trim()
      ? { explanation: parsed.explanation.trim() }
      : {}),
  }
}

const executeInput: NodeExecutor = async (_inputs, context) => {
  const operation = context.preferenceOperation
  if (operation !== 'extract' && operation !== 'contradiction') {
    throw new Error('Preference Learning Input requires an explicit operation')
  }
  if (operation === 'extract') {
    if (!Array.isArray(context.events) || context.events.length === 0 || context.events.length > 20) {
      throw new Error('Preference Learning Input requires 1-20 events')
    }
    return { operation, events: context.events, categories: context.preferenceCategories || [] }
  }
  if (!isRecord(context.preference1) || !isRecord(context.preference2)) {
    throw new Error('Preference Learning Input requires two preferences')
  }
  return { operation, preference1: context.preference1, preference2: context.preference2 }
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Preference learning cancelled', 'AbortError')
}

export async function executePreferenceLearning(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: PreferenceLearningDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const operation = inputs.operation
  if (operation === 'extract') {
    const events = Array.isArray(inputs.events) ? inputs.events : []
    const requestedCategories = Array.isArray(inputs.categories)
      ? inputs.categories.filter((value): value is string => typeof value === 'string')
      : []
    if (requestedCategories.some(value => !CATEGORIES.has(value as ExtractedPreference['category']))) {
      throw new Error('Preference extraction requested an unsupported category')
    }
    const allowedCategories = requestedCategories.length > 0
      ? requestedCategories.filter(value => CATEGORIES.has(value as ExtractedPreference['category']))
      : [...CATEGORIES]
    if (allowedCategories.length === 0) throw new Error('Preference extraction has no supported categories')
    const eventContext = events.map((event, index) => {
      if (!isRecord(event) || typeof event.content !== 'string' || !event.content.trim()) {
        throw new Error(`Preference extraction event ${index + 1} is invalid`)
      }
      return `[${String(event.type || 'unknown')}] ${event.content.trim().slice(0, 500)}`
    }).join('\n\n---\n\n')
    const response = await dependencies.callModel({
      role: 'curator',
      userId: typeof context.userId === 'string' ? context.userId : context.username,
      cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
      messages: [
        {
          role: 'system',
          content: `Extract only clearly evidenced user preferences in these categories: ${allowedCategories.join(', ')}. Return JSON only: {"preferences":[{"category":"one allowed category","description":"brief preference","behavior":"specific behavior to follow","confidence":0.75}]}. Return an empty array when no preference is supported.`,
        },
        { role: 'user', content: `Analyze these events:\n\n${eventContext}` },
      ],
      options: { temperature: 0.3, responseFormat: { type: 'json_object' } },
    })
    throwIfAborted(context)
    const preferences = parseExtractedPreferences(response.content)
    if (preferences.some(preference => !allowedCategories.includes(preference.category))) {
      throw new Error('Preference extraction returned a category outside the requested scope')
    }
    return { operation, preferences, count: preferences.length }
  }

  if (operation !== 'contradiction' || !isRecord(inputs.preference1) || !isRecord(inputs.preference2)) {
    throw new Error('Preference Learning requires valid graph inputs')
  }
  const response = await dependencies.callModel({
    role: 'curator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [{
      role: 'user',
      content: `Determine whether these two preferences directly, implicitly, or contextually conflict. Return JSON only: {"contradicts":true,"explanation":"brief explanation"}.\n\nPreference 1: ${JSON.stringify(inputs.preference1)}\nPreference 2: ${JSON.stringify(inputs.preference2)}`,
    }],
    options: { temperature: 0.1, responseFormat: { type: 'json_object' } },
  })
  throwIfAborted(context)
  const contradiction = parsePreferenceContradiction(response.content)
  return { operation, contradiction, ...contradiction }
}

export const PreferenceLearningInputNode: NodeDefinition = defineNode({
  id: 'preference_learning_input',
  name: 'Preference Learning Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'operation', type: 'string' },
    { name: 'events', type: 'array', optional: true },
    { name: 'categories', type: 'array', optional: true },
    { name: 'preference1', type: 'object', optional: true },
    { name: 'preference2', type: 'object', optional: true },
  ],
  properties: {},
  description: 'Admits bounded preference-learning evidence or one comparison pair',
  execute: executeInput,
})

export const PreferenceLearningNode: NodeDefinition = defineNode({
  id: 'preference_learning',
  name: 'Learn Preferences',
  category: 'persona',
  inputs: [
    { name: 'operation', type: 'string' },
    { name: 'events', type: 'array', optional: true },
    { name: 'categories', type: 'array', optional: true },
    { name: 'preference1', type: 'object', optional: true },
    { name: 'preference2', type: 'object', optional: true },
  ],
  outputs: [
    { name: 'operation', type: 'string' },
    { name: 'preferences', type: 'array', optional: true },
    { name: 'count', type: 'number', optional: true },
    { name: 'contradiction', type: 'object', optional: true },
    { name: 'contradicts', type: 'boolean', optional: true },
    { name: 'explanation', type: 'string', optional: true },
  ],
  properties: {},
  description: 'Extracts typed preferences or evaluates one potential contradiction',
  execute: executePreferenceLearning,
})
