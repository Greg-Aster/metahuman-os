/** Bounded, profile-scoped memory sampling shared by curiosity workflows. */

import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { storageClient } from './storage-client.js'

export const DEFAULT_CURIOSITY_SAMPLE_SIZE = 5
export const DEFAULT_CURIOSITY_DECAY_DAYS = 14
export const DEFAULT_CURIOSITY_CANDIDATE_LIMIT = 250
export const DEFAULT_CURIOSITY_MEMORY_BYTES = 256_000
export const DEFAULT_CURIOSITY_MEMORY_CHARS = 4_000
export const MAX_CURIOSITY_SAMPLE_SIZE = 20
export const MAX_CURIOSITY_CANDIDATE_LIMIT = 1_000

const GENERATED_INNER_TYPES = new Set([
  'curiosity_question',
  'daydream',
  'dream',
  'inner_dialogue',
  'reasoning',
  'reflection',
  'reflection_summary',
])

const TECHNICAL_KEYWORDS = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development',
]

export interface CuriosityMemoryEvidence {
  __memoryId: string
  id: string
  timestamp: string
  type: string
  content: string
}

export interface CuriosityMemorySamplingDiagnostics {
  filesConsidered: number
  filesRead: number
  skippedMalformed: number
  skippedOversize: number
  skippedGenerated: number
  skippedEmpty: number
  truncatedContent: number
}

export interface CuriosityMemorySample {
  memories: CuriosityMemoryEvidence[]
  diagnostics: CuriosityMemorySamplingDiagnostics
}

export interface CuriosityMemorySamplingOptions {
  username: string
  sampleSize?: number
  decayDays?: number
  candidateLimit?: number
  maxFileBytes?: number
  maxContentChars?: number
  now?: number
  random?: () => number
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`)
  }
  return resolved
}

function positiveNumber(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${field} must be a positive number`)
  }
  return resolved
}

function normalizeType(memory: Record<string, unknown>): string {
  const metadata = memory.metadata && typeof memory.metadata === 'object'
    ? memory.metadata as Record<string, unknown>
    : undefined
  const value = memory.type ?? metadata?.type ?? 'observation'
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'observation'
}

async function collectNewestJsonFiles(directory: string, limit: number): Promise<string[]> {
  const files: string[] = []

  async function walk(current: string): Promise<void> {
    if (files.length >= limit) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    entries.sort((left, right) => right.name.localeCompare(left.name))
    for (const entry of entries) {
      if (files.length >= limit) break
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(fullPath)
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath)
    }
  }

  await walk(directory)
  return files
}

function weightedIndex(weights: number[], random: () => number): number {
  const sample = random()
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('Curiosity memory random source must return a number from 0 up to but not including 1')
  }
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return -1
  let cursor = sample * total
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index]
    if (cursor <= 0) return index
  }
  return weights.length - 1
}

export function selectCuriosityMemories(
  candidates: CuriosityMemoryEvidence[],
  sampleSize: number,
  decayDays: number,
  now: number,
  random: () => number = Math.random,
): CuriosityMemoryEvidence[] {
  positiveInteger(sampleSize, DEFAULT_CURIOSITY_SAMPLE_SIZE, MAX_CURIOSITY_SAMPLE_SIZE, 'sampleSize')
  positiveNumber(decayDays, DEFAULT_CURIOSITY_DECAY_DAYS, 'decayDays')
  if (!Number.isFinite(now) || now < 0) throw new Error('now must be a non-negative timestamp')
  const remaining = [...candidates]
  const selected: CuriosityMemoryEvidence[] = []

  while (remaining.length > 0 && selected.length < sampleSize) {
    const weights = remaining.map(memory => {
      const ageDays = Math.max(0, now - Date.parse(memory.timestamp)) / 86_400_000
      let weight = Math.exp(-ageDays / decayDays)
      const content = memory.content.toLowerCase()
      if (TECHNICAL_KEYWORDS.some(keyword => content.includes(keyword))) weight *= 0.3
      return weight
    })
    const index = weightedIndex(weights, random)
    if (index < 0) break
    selected.push(remaining.splice(index, 1)[0])
  }

  return selected
}

/**
 * Read only the newest bounded candidate set, then select distinct memories by
 * recency weight. Unusable records are counted rather than silently accepted.
 */
export async function sampleCuriosityMemories(
  options: CuriosityMemorySamplingOptions,
): Promise<CuriosityMemorySample> {
  const username = options.username.trim()
  if (!username) throw new Error('Curiosity memory sampling requires a username')
  const sampleSize = positiveInteger(options.sampleSize, DEFAULT_CURIOSITY_SAMPLE_SIZE, MAX_CURIOSITY_SAMPLE_SIZE, 'sampleSize')
  const candidateLimit = positiveInteger(
    options.candidateLimit,
    DEFAULT_CURIOSITY_CANDIDATE_LIMIT,
    MAX_CURIOSITY_CANDIDATE_LIMIT,
    'candidateLimit',
  )
  if (candidateLimit < sampleSize) throw new Error('candidateLimit must be at least sampleSize')
  const decayDays = positiveNumber(options.decayDays, DEFAULT_CURIOSITY_DECAY_DAYS, 'decayDays')
  const maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_CURIOSITY_MEMORY_BYTES, 10_000_000, 'maxFileBytes')
  const maxContentChars = positiveInteger(options.maxContentChars, DEFAULT_CURIOSITY_MEMORY_CHARS, 50_000, 'maxContentChars')
  const now = options.now ?? Date.now()
  if (!Number.isFinite(now) || now < 0) throw new Error('now must be a non-negative timestamp')

  const resolved = storageClient.resolvePath({ username, category: 'memory', subcategory: 'episodic' })
  if (!resolved.success || !resolved.path) throw new Error(`Cannot resolve episodic memory for ${username}`)

  const diagnostics: CuriosityMemorySamplingDiagnostics = {
    filesConsidered: 0,
    filesRead: 0,
    skippedMalformed: 0,
    skippedOversize: 0,
    skippedGenerated: 0,
    skippedEmpty: 0,
    truncatedContent: 0,
  }
  const candidates: CuriosityMemoryEvidence[] = []
  const files = await collectNewestJsonFiles(resolved.path, candidateLimit)
  diagnostics.filesConsidered = files.length

  for (const file of files) {
    let stat
    try {
      stat = await fs.stat(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        diagnostics.skippedMalformed += 1
        continue
      }
      throw error
    }
    if (!stat.isFile()) continue
    if (stat.size > maxFileBytes) {
      diagnostics.skippedOversize += 1
      continue
    }

    let memory: Record<string, unknown>
    try {
      diagnostics.filesRead += 1
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Memory must be an object')
      memory = parsed as Record<string, unknown>
    } catch {
      diagnostics.skippedMalformed += 1
      continue
    }

    const type = normalizeType(memory)
    if (GENERATED_INNER_TYPES.has(type)) {
      diagnostics.skippedGenerated += 1
      continue
    }
    const content = typeof memory.content === 'string' ? memory.content.trim() : ''
    const timestamp = typeof memory.timestamp === 'string' ? memory.timestamp : ''
    if (!content || !timestamp || Number.isNaN(Date.parse(timestamp))) {
      diagnostics.skippedEmpty += 1
      continue
    }
    const boundedContent = content.slice(0, maxContentChars)
    if (boundedContent.length < content.length) diagnostics.truncatedContent += 1
    const id = typeof memory.id === 'string' && memory.id.trim()
      ? memory.id.trim()
      : path.basename(file, '.json')
    candidates.push({
      __memoryId: id,
      id,
      timestamp: new Date(timestamp).toISOString(),
      type,
      content: boundedContent,
    })
  }

  candidates.sort((left, right) => right.timestamp.localeCompare(left.timestamp))
  return {
    memories: selectCuriosityMemories(candidates, sampleSize, decayDays, now, options.random),
    diagnostics,
  }
}
