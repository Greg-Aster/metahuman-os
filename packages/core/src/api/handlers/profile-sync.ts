/** Thin profile-sync transport over the canonical Core owners. */

import type { EpisodicEvent } from '../../memory.js'
import { scanEpisodicMemoryRecords } from '../../memory.js'
import {
  exportProfileSyncBundle,
  importProfileSyncBundle,
} from '../../profile-sync.js'
import { verifyUserPassword } from '../../users.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

const MAX_MEMORY_PAGE_SIZE = 100
const MAX_EXCLUDED_MEMORY_IDS = 100
const MAX_MEMORY_DAYS = 3650

function authenticatedSyncUsername(req: UnifiedRequest): string | null {
  if (req.user.isAuthenticated) return req.user.username
  if (req.method !== 'POST' || !req.body) return null
  const { username, password } = req.body as { username?: unknown; password?: unknown }
  if (typeof username !== 'string' || typeof password !== 'string') return null
  return verifyUserPassword(username, password) ? username : null
}

function positiveInteger(value: unknown, field: string, maximum: number, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`${field} is required`)
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = value === undefined || value === null || value === '' ? 0 : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`)
  return parsed
}

function memoryQuery(req: UnifiedRequest): Record<string, unknown> {
  return req.method === 'POST' && req.body
    ? { ...(req.query ?? {}), ...req.body }
    : { ...(req.query ?? {}) }
}

function excludedIds(value: unknown): Set<string> {
  if (value === undefined || value === null || value === '') return new Set()
  const values = Array.isArray(value) ? value : String(value).split(',')
  if (values.length > MAX_EXCLUDED_MEMORY_IDS) {
    throw new Error(`exclude must contain at most ${MAX_EXCLUDED_MEMORY_IDS} memory ids`)
  }
  const normalized = values.map(item => String(item).trim()).filter(Boolean)
  if (normalized.some(item => item.length > 256)) throw new Error('Memory ids must not exceed 256 characters')
  return new Set(normalized)
}

function cutoffTimestamp(query: Record<string, unknown>): number | null {
  if (query.since !== undefined && query.since !== null && query.since !== '') {
    if (typeof query.since !== 'string') throw new Error('since must be an ISO timestamp')
    const parsed = Date.parse(query.since)
    if (Number.isNaN(parsed)) throw new Error('since must be an ISO timestamp')
    return parsed
  }
  if (query.days !== undefined && query.days !== null && query.days !== '') {
    const days = positiveInteger(query.days, 'days', MAX_MEMORY_DAYS)
    return Date.now() - days * 24 * 60 * 60 * 1000
  }
  return null
}

function collectMemories(username: string): EpisodicEvent[] {
  const memories: EpisodicEvent[] = []
  const failures: string[] = []
  for (const outcome of scanEpisodicMemoryRecords(username)) {
    if (outcome.status === 'record') memories.push(outcome.record.event)
    else failures.push(`${outcome.relativePath}: ${outcome.error}`)
  }
  if (failures.length > 0) throw new Error(`Cannot export all episodic memories: ${failures.join('; ')}`)
  return memories
}

/** POST /api/profile-sync/export-priority */
export async function handleExportPriorityProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = authenticatedSyncUsername(req)
  if (!username) return { status: 401, error: 'Valid profile credentials are required' }
  try {
    return successResponse(await exportProfileSyncBundle(username))
  } catch (error) {
    return { status: 500, error: (error as Error).message }
  }
}

/** POST /api/profile-sync/import */
export async function handleImportProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    const result = await importProfileSyncBundle(req.user.username, req.body, {
      expectedSourceUsername: req.user.username,
    })
    if (!result.success) {
      return { status: 500, data: result, error: result.errors.join('; ') }
    }
    return successResponse({ ...result, username: req.user.username })
  } catch (error) {
    return { status: 400, error: (error as Error).message }
  }
}

/** GET/POST /api/profile-sync/memories */
export async function handleGetProfileMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  const username = authenticatedSyncUsername(req)
  if (!username) return { status: 401, error: 'Valid profile credentials are required' }
  try {
    const query = memoryQuery(req)
    const offset = nonNegativeInteger(query.offset, 'offset')
    const limit = positiveInteger(query.limit, 'limit', MAX_MEMORY_PAGE_SIZE, MAX_MEMORY_PAGE_SIZE)
    const cutoff = cutoffTimestamp(query)
    const exclude = excludedIds(query.exclude)
    const memories = collectMemories(username)
      .filter(memory => cutoff === null || Date.parse(memory.timestamp) > cutoff)
      .filter(memory => !exclude.has(memory.id))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    const page = memories.slice(offset, offset + limit)
    return successResponse({
      memories: page,
      hasMore: offset + page.length < memories.length,
      total: memories.length,
      offset,
      limit,
      filtered: cutoff !== null,
    })
  } catch (error) {
    const message = (error as Error).message
    const validation = /must|required|at most|timestamp|ids/.test(message)
    return { status: validation ? 400 : 500, error: message }
  }
}
