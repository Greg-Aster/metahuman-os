import { callLLM } from '../../model-router.js'
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js'

export interface ExtractedTaskSuggestion {
  title: string
  description: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  tags: string[]
  confidence: number
  project?: string
  dependencies?: string[]
}

export interface TaskSuggestionExtractorDependencies {
  callModel: typeof callLLM
}

const DEFAULT_DEPENDENCIES: TaskSuggestionExtractorDependencies = { callModel: callLLM }
const PRIORITIES = new Set<ExtractedTaskSuggestion['priority']>(['P0', 'P1', 'P2', 'P3'])
const EXTRACTION_PROMPT = `You are analyzing a reflection or inner dialogue to extract actionable tasks.

For each clearly actionable item, return a concise imperative title, a description, priority P0-P3, tags, confidence from 0 to 1, and optional project and dependencies. Do not extract vague musings, completed items, or observations without intent.

Return JSON only:
{"tasks":[{"title":"Task title","description":"What needs to be done","priority":"P2","tags":["tag"],"confidence":0.8,"project":null,"dependencies":null}]}
Return {"tasks":[]} when there are no actionable tasks.`

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalStrings(value: unknown, field: string, limit: number): string[] | undefined {
  if (value === null || value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Task extraction ${field} must be an array of strings`)
  }
  const values = value.map(item => item.trim()).filter(Boolean)
  if (values.length > limit) throw new Error(`Task extraction ${field} exceeds ${limit} items`)
  return values
}

export function parseExtractedTaskSuggestions(text: string): ExtractedTaskSuggestion[] {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('Task extraction response did not contain a JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Task extraction response was not valid JSON: ${(error as Error).message}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks) || parsed.tasks.length > 20) {
    throw new Error('Task extraction response requires a bounded tasks array')
  }
  return parsed.tasks.map((value, index) => {
    if (!isRecord(value)
      || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200
      || typeof value.description !== 'string' || !value.description.trim() || value.description.length > 2_000
      || typeof value.priority !== 'string' || !PRIORITIES.has(value.priority as ExtractedTaskSuggestion['priority'])
      || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
      || value.confidence < 0 || value.confidence > 1) {
      throw new Error(`Task extraction item ${index + 1} is invalid`)
    }
    if (value.project !== null && value.project !== undefined
      && (typeof value.project !== 'string' || value.project.length > 200)) {
      throw new Error(`Task extraction item ${index + 1} has an invalid project`)
    }
    const dependencies = optionalStrings(value.dependencies, `item ${index + 1} dependencies`, 20)
    return {
      title: value.title.trim(),
      description: value.description.trim(),
      priority: value.priority as ExtractedTaskSuggestion['priority'],
      tags: optionalStrings(value.tags, `item ${index + 1} tags`, 20) || [],
      confidence: value.confidence,
      ...(typeof value.project === 'string' && value.project.trim() ? { project: value.project.trim() } : {}),
      ...(dependencies ? { dependencies } : {}),
    }
  })
}

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Task suggestion extraction cancelled', 'AbortError')
}

export async function executeTaskSuggestionExtractor(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  _properties: Record<string, unknown> = {},
  dependencies: TaskSuggestionExtractorDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context)
  const content = typeof inputs.content === 'string' ? inputs.content.trim() : ''
  if (!content) throw new Error('Task Suggestion Extractor requires reflection content')
  const response = await dependencies.callModel({
    role: 'curator',
    userId: typeof context.userId === 'string' ? context.userId : context.username,
    cognitiveMode: typeof context.cognitiveMode === 'string' ? context.cognitiveMode : undefined,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Analyze this reflection:\n\n${content}` },
    ],
    options: { temperature: 0.3, responseFormat: { type: 'json_object' } },
  })
  throwIfAborted(context)
  const tasks = parseExtractedTaskSuggestions(response.content)
  return { tasks, count: tasks.length }
}

export const TaskSuggestionExtractorNode: NodeDefinition = defineNode({
  id: 'task_suggestion_extractor',
  name: 'Extract Task Suggestions',
  category: 'agent',
  inputs: [{ name: 'content', type: 'string' }],
  outputs: [
    { name: 'tasks', type: 'array' },
    { name: 'count', type: 'number' },
  ],
  properties: {},
  description: 'Extracts typed task suggestions from one reflection without creating tasks',
  execute: executeTaskSuggestionExtractor,
})
