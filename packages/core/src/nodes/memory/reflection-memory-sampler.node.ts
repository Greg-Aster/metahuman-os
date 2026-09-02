/**
 * Reflection Memory Sampler Node
 *
 * Owns profile-scoped memory selection for the Reflector graph. Generated
 * inner content is excluded so reflections cannot recursively treat prior
 * dreams or reflections as factual history.
 */

import { loadMemoryContentMode } from '../../memory-content-filter.js'
import { scanEpisodicMemoryRecords } from '../../memory.js'
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

export type ReflectionContentMode = 'all' | 'user' | 'agent'

export interface ReflectionMemoryExcerpt {
  id: string
  timestamp: string
  type: string
  text: string
}

export interface ReflectionMemoryCandidate extends ReflectionMemoryExcerpt {
  file: string
  keywords: string[]
}

const GENERATED_INNER_TYPES = new Set([
  'curiosity_question',
  'daydream',
  'dream',
  'inner_dialogue',
  'reasoning',
  'reflection',
  'reflection_summary',
])

const AGENT_TYPES = new Set([
  'action',
  'audit',
  'decision',
  'operator',
  'system',
  'tool_invocation',
])

const TECHNICAL_KEYWORDS = [
  'agent', 'astro', 'audit', 'codebase', 'development', 'llm', 'metahuman',
  'model', 'node graph', 'ollama', 'package.json', 'persona', 'typescript',
]

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being',
  'could', 'does', 'from', 'have', 'into', 'just', 'more', 'only', 'other',
  'should', 'some', 'than', 'that', 'their', 'there', 'these', 'they', 'this',
  'through', 'very', 'want', 'what', 'when', 'where', 'which', 'while', 'with',
  'would', 'your',
])

function normalizeType(memory: Record<string, any>): string {
  const value = memory.type ?? memory.metadata?.type ?? 'observation'
  return typeof value === 'string' ? value.trim().toLowerCase() : 'observation'
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function conversationParts(memory: Record<string, any>): { user: string; assistant: string } {
  const content = cleanText(memory.content)
  const response = cleanText(memory.response)
  const role = memory.metadata?.role
  if (role === 'user') {
    return { user: content.replace(/^(?:Me|User):\s*/i, '').trim(), assistant: '' }
  }
  if (role === 'assistant') {
    return { user: '', assistant: content.replace(/^(?:Assistant|AI|MetaHuman):\s*/i, '').trim() }
  }
  const assistantSeparator = /\n\n(?:Assistant|AI|MetaHuman):\s*/i

  if (assistantSeparator.test(content)) {
    const [userPart = '', assistantPart = ''] = content.split(assistantSeparator, 2)
    return {
      user: userPart.replace(/^(?:Me|User):\s*/i, '').replace(/^"|"$/g, '').trim(),
      assistant: response || assistantPart.trim(),
    }
  }

  return {
    user: content.replace(/^(?:Me|User):\s*/i, '').replace(/^"|"$/g, '').trim(),
    assistant: response,
  }
}

/** Extract only the portion of a stored event allowed by the selected mode. */
export function extractReflectionMemoryText(
  memory: Record<string, any>,
  mode: ReflectionContentMode,
): string | null {
  const type = normalizeType(memory)
  if (GENERATED_INNER_TYPES.has(type)) return null

  if (type === 'conversation') {
    const parts = conversationParts(memory)
    if (mode === 'user') return parts.user || null
    if (mode === 'agent') return parts.assistant || null
    const combined = [
      parts.user ? `User: ${parts.user}` : '',
      parts.assistant ? `Assistant: ${parts.assistant}` : '',
    ].filter(Boolean).join('\n')
    return combined || null
  }

  if (mode === 'user' && AGENT_TYPES.has(type)) return null
  if (mode === 'agent' && !AGENT_TYPES.has(type)) return null

  return cleanText(memory.content) || null
}

function extractKeywords(memory: Record<string, any>, text: string): string[] {
  const tags = Array.isArray(memory.tags) ? memory.tags : []
  const entities = Array.isArray(memory.entities) ? memory.entities : []
  const entityWords = entities.map(entity => typeof entity === 'string' ? entity : entity?.text)
  const textWords = text.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) || []
  const words = [...tags, ...entityWords, ...textWords]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 3 && !STOP_WORDS.has(value))

  return [...new Set(words)].slice(0, 24)
}

export function loadReflectionMemoryCandidates(
  username: string,
  mode: ReflectionContentMode,
  options: { maxFiles: number; maxFileSizeBytes: number; signal?: AbortSignal },
): {
  candidates: ReflectionMemoryCandidate[]
  failures: Array<{ relativePath: string; error: string }>
  filesConsidered: number
  scanLimited: boolean
} {
  const candidates: ReflectionMemoryCandidate[] = []
  const failures: Array<{ relativePath: string; error: string }> = []
  let filesConsidered = 0
  for (const outcome of scanEpisodicMemoryRecords(username, {
    maxFiles: options.maxFiles,
    maxFileSizeBytes: options.maxFileSizeBytes,
    newestFirst: true,
  })) {
    if (options.signal?.aborted) {
      throw new DOMException('Reflection memory sampling cancelled', 'AbortError')
    }
    filesConsidered += 1
    if (outcome.status === 'failed') {
      failures.push(outcome)
      continue
    }
    const memory = outcome.record.event as Record<string, any>
    const text = extractReflectionMemoryText(memory, mode)
    if (!text) continue
    candidates.push({
      id: memory.id,
      timestamp: new Date(memory.timestamp).toISOString(),
      type: normalizeType(memory),
      text,
      file: outcome.record.relativePath,
      keywords: extractKeywords(memory, text),
    })
  }
  return {
    candidates: candidates.sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    failures,
    filesConsidered,
    scanLimited: filesConsidered >= options.maxFiles,
  }
}

function weightedIndex(weights: number[], random: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return -1
  let cursor = random() * total
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index]
    if (cursor <= 0) return index
  }
  return weights.length - 1
}

/** Select distinct, recent memories while favoring explicit shared terms. */
export function selectReflectionMemories(
  candidates: ReflectionMemoryCandidate[],
  count: number,
  recencyHalfLifeDays: number,
  associationBoost: number,
  random: () => number = Math.random,
): ReflectionMemoryExcerpt[] {
  const remaining = [...candidates]
  const selected: ReflectionMemoryCandidate[] = []
  const now = Date.now()
  const halfLife = Math.max(1, recencyHalfLifeDays)

  while (remaining.length > 0 && selected.length < count) {
    const selectedKeywords = new Set(selected.flatMap(memory => memory.keywords))
    const weights = remaining.map(memory => {
      const timestamp = new Date(memory.timestamp).getTime()
      const ageDays = Math.max(0, now - timestamp) / 86_400_000
      let weight = Math.exp(-Math.LN2 * ageDays / halfLife)
      if (TECHNICAL_KEYWORDS.some(keyword => memory.text.toLowerCase().includes(keyword))) {
        weight *= 0.35
      }
      if (selectedKeywords.size > 0) {
        const sharedTerms = memory.keywords.filter(keyword => selectedKeywords.has(keyword)).length
        weight *= 1 + Math.min(sharedTerms, 4) * Math.max(0, associationBoost)
      }
      return weight
    })

    const index = weightedIndex(weights, random)
    if (index < 0) break
    selected.push(remaining[index])
    remaining.splice(index, 1)
  }

  return selected.map(({ id, timestamp, type, text }) => ({ id, timestamp, type, text }))
}

async function resolveContentMode(properties: Record<string, any>): Promise<ReflectionContentMode> {
  const configured = properties.contentMode
  if (configured === 'all' || configured === 'user' || configured === 'agent') return configured
  if (configured !== 'configured') throw new Error('Reflection contentMode must be configured, user, agent, or all')
  return loadMemoryContentMode()
}

function integerProperty(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || Number(resolved) < minimum || Number(resolved) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(resolved)
}

function numberProperty(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
): number {
  const resolved = value ?? fallback
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < minimum) {
    throw new Error(`${name} must be a finite number greater than or equal to ${minimum}`)
  }
  return resolved
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = typeof context.username === 'string' && context.username.trim()
    ? context.username.trim()
    : typeof context.userId === 'string' ? context.userId.trim() : ''
  if (!username || username === 'anonymous') {
    return { memories: [], count: 0, ready: false, error: 'No authenticated username' }
  }

  try {
    const contentMode = await resolveContentMode(properties || {})
    const memoryCount = integerProperty(properties?.memoryCount, 4, 'memoryCount', 2, 8)
    const maxCandidateFiles = integerProperty(
      properties?.maxCandidateFiles,
      2_000,
      'maxCandidateFiles',
      2,
      10_000,
    )
    const maxFileSizeBytes = integerProperty(
      properties?.maxFileSizeBytes,
      2 * 1024 * 1024,
      'maxFileSizeBytes',
      1,
      16 * 1024 * 1024,
    )
    const recencyHalfLifeDays = numberProperty(
      properties?.recencyHalfLifeDays,
      14,
      'recencyHalfLifeDays',
      Number.EPSILON,
    )
    const associationBoost = numberProperty(
      properties?.associationBoost,
      1.5,
      'associationBoost',
      0,
    )
    const maxMemoryChars = integerProperty(
      properties?.maxMemoryChars,
      1_200,
      'maxMemoryChars',
      200,
      10_000,
    )
    const scan = loadReflectionMemoryCandidates(username, contentMode, {
      maxFiles: maxCandidateFiles,
      maxFileSizeBytes,
      signal: context.abortSignal as AbortSignal | undefined,
    })
    const memories = selectReflectionMemories(
      scan.candidates,
      memoryCount,
      recencyHalfLifeDays,
      associationBoost,
    ).map(memory => ({
      ...memory,
      text: memory.text.slice(0, maxMemoryChars),
    }))

    const error = memories.length < 2 && scan.failures.length > 0
      ? `${scan.failures.length} episodic memory file(s) failed validation while fewer than 2 usable memories remained`
      : undefined

    return {
      memories,
      count: memories.length,
      candidateCount: scan.candidates.length,
      filesConsidered: scan.filesConsidered,
      failedCount: scan.failures.length,
      failures: scan.failures.slice(0, 20),
      scanLimited: scan.scanLimited,
      contentMode,
      ready: memories.length >= 2 && !error,
      ...(error ? { error } : {}),
      username,
    }
  } catch (error) {
    console.error('[ReflectionMemorySampler] Error:', error)
    return {
      memories: [],
      count: 0,
      ready: false,
      error: (error as Error).message,
      username,
    }
  }
}

export const ReflectionMemorySamplerNode: NodeDefinition = defineNode({
  id: 'reflection_memory_sampler',
  name: 'Reflection Memory Sampler',
  category: 'memory',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Distinct profile-scoped historical excerpts' },
    { name: 'count', type: 'number' },
    { name: 'candidateCount', type: 'number' },
    { name: 'filesConsidered', type: 'number' },
    { name: 'failedCount', type: 'number' },
    { name: 'failures', type: 'array' },
    { name: 'scanLimited', type: 'boolean' },
    { name: 'contentMode', type: 'string' },
    { name: 'ready', type: 'boolean' },
  ],
  properties: {
    memoryCount: 4,
    contentMode: 'configured',
    maxCandidateFiles: 2000,
    maxFileSizeBytes: 2097152,
    recencyHalfLifeDays: 14,
    associationBoost: 1.5,
    maxMemoryChars: 1200,
  },
  propertySchemas: {
    memoryCount: { type: 'slider', default: 4, label: 'Memory Count', min: 2, max: 8, step: 1 },
    contentMode: {
      type: 'select',
      default: 'configured',
      label: 'Content Mode',
      options: ['configured', 'user', 'agent', 'all'],
    },
    maxCandidateFiles: { type: 'number', default: 2000, label: 'Maximum Candidate Files' },
    maxFileSizeBytes: { type: 'number', default: 2097152, label: 'Maximum File Size (bytes)' },
    recencyHalfLifeDays: { type: 'number', default: 14, label: 'Recency Half-life (days)' },
    associationBoost: { type: 'number', default: 1.5, label: 'Shared-term Association Boost' },
    maxMemoryChars: { type: 'number', default: 1200, label: 'Maximum Characters per Memory' },
  },
  description: 'Selects multiple distinct historical excerpts from the authenticated profile for grounded reflection',
  execute,
})
