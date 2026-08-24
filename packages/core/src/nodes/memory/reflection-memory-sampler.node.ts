/**
 * Reflection Memory Sampler Node
 *
 * Owns profile-scoped memory selection for the Reflector graph. Generated
 * inner content is excluded so reflections cannot recursively treat prior
 * dreams or reflections as factual history.
 */

import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { systemPaths } from '../../path-builder.js'
import { storageClient } from '../../storage-client.js'
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

async function loadCandidates(mode: ReflectionContentMode): Promise<ReflectionMemoryCandidate[]> {
  const result = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' })
  if (!result.success || !result.path) return []

  const candidates: ReflectionMemoryCandidate[] = []

  async function walk(directory: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue

      try {
        const memory = JSON.parse(await fs.readFile(fullPath, 'utf8')) as Record<string, any>
        const text = extractReflectionMemoryText(memory, mode)
        if (!text) continue

        const parsedTimestamp = new Date(memory.timestamp)
        const timestamp = Number.isFinite(parsedTimestamp.getTime())
          ? parsedTimestamp.toISOString()
          : new Date(0).toISOString()

        candidates.push({
          id: cleanText(memory.id) || path.basename(entry.name, '.json'),
          timestamp,
          type: normalizeType(memory),
          text,
          file: fullPath,
          keywords: extractKeywords(memory, text),
        })
      } catch {
        // A malformed or encrypted record is not usable as prompt evidence.
      }
    }
  }

  await walk(result.path)
  return candidates.sort((left, right) => right.timestamp.localeCompare(left.timestamp))
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

  const fallback = properties.fallbackContentMode === 'all' || properties.fallbackContentMode === 'agent'
    ? properties.fallbackContentMode as ReflectionContentMode
    : 'user'

  try {
    const result = storageClient.resolvePath({ category: 'config', subcategory: 'agents' })
    const profileAgentsPath = result.success && result.path
      ? result.path.endsWith('.json') ? result.path : path.join(result.path, 'agents.json')
      : null
    const configPaths = [profileAgentsPath, path.join(systemPaths.etc, 'agents.json')]
      .filter((value): value is string => Boolean(value))

    for (const configPath of [...new Set(configPaths)]) {
      try {
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
        const mode = config.globalSettings?.memoryContentMode ?? config.agents?.reflector?.contentMode
        if (mode === 'all' || mode === 'user' || mode === 'agent') return mode
      } catch {
        // Continue from a missing profile override to the system owner.
      }
    }
    return fallback
  } catch {
    return fallback
  }
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
    const memoryCount = Math.max(2, Math.min(8, Number(properties?.memoryCount) || 4))
    const candidates = await loadCandidates(contentMode)
    const memories = selectReflectionMemories(
      candidates,
      memoryCount,
      Number(properties?.recencyHalfLifeDays) || 14,
      Number(properties?.associationBoost) || 1.5,
    ).map(memory => ({
      ...memory,
      text: memory.text.slice(0, Math.max(200, Number(properties?.maxMemoryChars) || 1200)),
    }))

    return {
      memories,
      count: memories.length,
      candidateCount: candidates.length,
      contentMode,
      ready: memories.length >= 2,
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
    { name: 'contentMode', type: 'string' },
    { name: 'ready', type: 'boolean' },
  ],
  properties: {
    memoryCount: 4,
    contentMode: 'profile',
    fallbackContentMode: 'user',
    recencyHalfLifeDays: 14,
    associationBoost: 1.5,
    maxMemoryChars: 1200,
  },
  propertySchemas: {
    memoryCount: { type: 'slider', default: 4, label: 'Memory Count', min: 2, max: 8, step: 1 },
    contentMode: {
      type: 'select',
      default: 'profile',
      label: 'Content Mode',
      options: ['profile', 'user', 'agent', 'all'],
    },
    fallbackContentMode: {
      type: 'select',
      default: 'user',
      label: 'Fallback Content Mode',
      options: ['user', 'agent', 'all'],
    },
    recencyHalfLifeDays: { type: 'number', default: 14, label: 'Recency Half-life (days)' },
    associationBoost: { type: 'number', default: 1.5, label: 'Shared-term Association Boost' },
    maxMemoryChars: { type: 'number', default: 1200, label: 'Maximum Characters per Memory' },
  },
  description: 'Selects multiple distinct historical excerpts from the authenticated profile for grounded reflection',
  execute,
})
