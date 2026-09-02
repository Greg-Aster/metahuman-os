/** Finite coordinator for pulling one resolved profile through canonical Core owners. */

import {
  applySyncableCredentials,
  audit,
  auditAction,
  captureEventWithDetails,
  importProfileSyncBundle,
  loadProfileSyncConfig,
  updateProfileSyncCheckpoint,
  type CaptureEventOptions,
  type CaptureResult,
  type EpisodicEvent,
  type ProfileImportResult,
  type ProfileSyncBundle,
  type ProfileSyncConfig,
  type SyncableCredentials,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export const MAX_PROFILE_SYNC_DAYS = 3650
export const MAX_MEMORY_SYNC_PAGES = 1000
export const MEMORY_SYNC_PAGE_SIZE = 100
export const PROFILE_SYNC_REQUEST_TIMEOUT_MS = 30_000

export interface SyncProgress {
  phase: 'authenticating' | 'profile' | 'credentials' | 'memories' | 'complete' | 'error'
  message: string
  current?: number
  total?: number
}

export interface SyncOptions {
  memoriesOnly?: boolean
  profileOnly?: boolean
  days?: number
  fullSync?: boolean
  skipConfig?: boolean
  skipPersona?: boolean
  signal?: AbortSignal
}

export interface MemorySyncOutcome {
  id: string
  status: 'imported' | 'deduplicated' | 'failed'
  eventId?: string
  error?: string
}

export interface SyncResult {
  success: boolean
  profileFiles: number
  memoriesImported: number
  memoriesDeduplicated: number
  credentialsSynced: boolean
  profile?: ProfileImportResult
  memories: MemorySyncOutcome[]
  credentialKeys: string[]
  errors: string[]
}

interface AuthResult {
  success: boolean
  sessionId?: string
  error?: string
}

interface BundleResult {
  success: boolean
  bundle?: ProfileSyncBundle
  error?: string
}

interface CredentialsResult {
  status: 'available' | 'unavailable' | 'failed'
  credentials?: SyncableCredentials
  error?: string
}

interface MemoriesResult {
  success: boolean
  memories?: EpisodicEvent[]
  hasMore?: boolean
  total?: number
  error?: string
}

export interface ProfileSyncDependencies {
  loadConfig: (username: string) => Promise<ProfileSyncConfig | null>
  authenticate: typeof authenticateWithServer
  fetchBundle: typeof fetchProfileBundle
  importBundle: (username: string, bundle: unknown, options: Parameters<typeof importProfileSyncBundle>[2]) => Promise<ProfileImportResult>
  fetchCredentials: typeof fetchCredentials
  applyCredentials: (username: string, credentials: SyncableCredentials) => Promise<Awaited<ReturnType<typeof applySyncableCredentials>>>
  fetchMemories: typeof fetchMemories
  captureMemory: (content: string, options: CaptureEventOptions) => CaptureResult
  updateCheckpoint: typeof updateProfileSyncCheckpoint
  now: () => Date
}

const DEFAULT_DEPENDENCIES: ProfileSyncDependencies = {
  loadConfig: loadProfileSyncConfig,
  authenticate: authenticateWithServer,
  fetchBundle: fetchProfileBundle,
  importBundle: importProfileSyncBundle,
  fetchCredentials,
  applyCredentials: applySyncableCredentials,
  fetchMemories,
  captureMemory: captureEventWithDetails,
  updateCheckpoint: updateProfileSyncCheckpoint,
  now: () => new Date(),
}

function abortError(): DOMException {
  return new DOMException('Profile sync cancelled', 'AbortError')
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

async function fetchWithTimeout(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  assertNotAborted(signal)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Profile sync request timed out', 'TimeoutError')), PROFILE_SYNC_REQUEST_TIMEOUT_MS)
  timeout.unref?.()
  const abort = () => controller.abort(signal?.reason ?? abortError())
  signal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

function normalizedServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '')
}

async function responseError(response: Response, operation: string): Promise<string> {
  const text = await response.text().catch(() => '')
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/html') || /<html|<!doctype/i.test(text)) {
    if (/cloudflare|cloudflared/i.test(text)) {
      return `${operation} failed: remote server unavailable (Cloudflare ${response.status})`
    }
    return `${operation} failed: remote server returned HTML (${response.status})`
  }
  const compact = text.replace(/\s+/g, ' ').trim().slice(0, 300)
  return `${operation} failed (${response.status})${compact ? `: ${compact}` : ''}`
}

export async function authenticateWithServer(
  serverUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthResult> {
  try {
    const response = await fetchWithTimeout(`${normalizedServerUrl(serverUrl)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, signal)
    if (!response.ok) return { success: false, error: await responseError(response, 'Authentication') }
    const data = await response.json() as { success?: boolean; sessionId?: string; session?: string; error?: string }
    const sessionId = data.sessionId || data.session
    if (!data.success || !sessionId) return { success: false, error: data.error || 'Authentication returned no session' }
    return { success: true, sessionId }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

export async function fetchProfileBundle(
  serverUrl: string,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<BundleResult> {
  try {
    const response = await fetchWithTimeout(`${normalizedServerUrl(serverUrl)}/api/profile-sync/export-priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, signal)
    if (!response.ok) return { success: false, error: await responseError(response, 'Profile download') }
    return { success: true, bundle: await response.json() as ProfileSyncBundle }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

export async function fetchCredentials(
  serverUrl: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<CredentialsResult> {
  try {
    const response = await fetchWithTimeout(`${normalizedServerUrl(serverUrl)}/api/profile-sync/credentials`, {
      method: 'GET',
      headers: { Cookie: `mh_session=${sessionId}` },
    }, signal)
    if (response.status === 403) return { status: 'unavailable' }
    if (!response.ok) return { status: 'failed', error: await responseError(response, 'Credential download') }
    const data = await response.json() as { credentials?: SyncableCredentials }
    return data.credentials ? { status: 'available', credentials: data.credentials } : { status: 'unavailable' }
  } catch (error) {
    return { status: 'failed', error: (error as Error).message }
  }
}

export async function fetchMemories(
  serverUrl: string,
  username: string,
  password: string,
  options: { offset: number; limit: number; days?: number; since?: string },
  signal?: AbortSignal,
): Promise<MemoriesResult> {
  try {
    const response = await fetchWithTimeout(`${normalizedServerUrl(serverUrl)}/api/profile-sync/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, ...options }),
    }, signal)
    if (!response.ok) return { success: false, error: await responseError(response, 'Memory download') }
    const data = await response.json() as { memories?: EpisodicEvent[]; hasMore?: boolean; total?: number }
    if (!Array.isArray(data.memories)) return { success: false, error: 'Memory download returned an invalid page' }
    return { success: true, memories: data.memories, hasMore: data.hasMore === true, total: data.total }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

function positiveInteger(value: unknown, field: string, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

export function parseSyncOptions(
  args: string[] = [],
  structured: Record<string, unknown> = {},
): SyncOptions {
  const options: SyncOptions = {
    memoriesOnly: structured.memoriesOnly === true,
    profileOnly: structured.profileOnly === true,
    fullSync: structured.fullSync === true,
    skipConfig: structured.skipConfig === true,
    skipPersona: structured.skipPersona === true,
    days: positiveInteger(structured.days, 'days', MAX_PROFILE_SYNC_DAYS),
  }
  for (const argument of args) {
    if (argument === '--') continue
    if (argument === '--memories-only') options.memoriesOnly = true
    else if (argument === '--profile-only') options.profileOnly = true
    else if (argument === '--full') options.fullSync = true
    else if (argument === '--skip-config') options.skipConfig = true
    else if (argument === '--skip-persona') options.skipPersona = true
    else if (argument.startsWith('--days=')) {
      options.days = positiveInteger(Number(argument.slice('--days='.length)), 'days', MAX_PROFILE_SYNC_DAYS)
    } else {
      throw new Error(`Unknown profile-sync option: ${argument}`)
    }
  }
  if (options.memoriesOnly && options.profileOnly) {
    throw new Error('--memories-only and --profile-only are mutually exclusive')
  }
  return options
}

function validateRemoteMemory(value: unknown): EpisodicEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Memory must be an object')
  const memory = value as Partial<EpisodicEvent>
  if (typeof memory.id !== 'string' || !memory.id.trim()) throw new Error('Memory id is required')
  if (typeof memory.timestamp !== 'string' || Number.isNaN(Date.parse(memory.timestamp))) {
    throw new Error(`Memory ${memory.id} has an invalid timestamp`)
  }
  if (typeof memory.content !== 'string' || !memory.content) throw new Error(`Memory ${memory.id} has no content`)
  return memory as EpisodicEvent
}

function captureRemoteMemory(
  memory: EpisodicEvent,
  source: string,
  capture: ProfileSyncDependencies['captureMemory'],
): MemorySyncOutcome {
  try {
    const result = capture(memory.content, {
      timestamp: memory.timestamp,
      type: memory.type,
      response: memory.response,
      entities: memory.entities,
      tags: memory.tags,
      importance: memory.importance,
      links: memory.links,
      metadata: { ...memory.metadata, syncSource: source, remoteMemoryId: memory.id },
      idempotencyKey: `profile-sync:${source}:${memory.id}`,
    })
    return {
      id: memory.id,
      status: result.deduplicated ? 'deduplicated' : 'imported',
      eventId: result.eventId,
    }
  } catch (error) {
    return { id: memory.id, status: 'failed', error: (error as Error).message }
  }
}

function emptyResult(): SyncResult {
  return {
    success: false,
    profileFiles: 0,
    memoriesImported: 0,
    memoriesDeduplicated: 0,
    credentialsSynced: false,
    memories: [],
    credentialKeys: [],
    errors: [],
  }
}

export async function syncUserProfile(
  username: string,
  options: SyncOptions = {},
  onProgress?: (progress: SyncProgress) => void,
  dependencies: ProfileSyncDependencies = DEFAULT_DEPENDENCIES,
): Promise<SyncResult> {
  if (!username.trim()) throw new Error('Profile sync requires a resolved username')
  positiveInteger(options.days, 'days', MAX_PROFILE_SYNC_DAYS)
  if (options.memoriesOnly && options.profileOnly) {
    throw new Error('memoriesOnly and profileOnly are mutually exclusive')
  }
  const result = emptyResult()
  assertNotAborted(options.signal)
  const config = await dependencies.loadConfig(username)
  if (!config) {
    result.errors.push(`No sync server configured for ${username}`)
    onProgress?.({ phase: 'error', message: result.errors[0] })
    return result
  }

  onProgress?.({ phase: 'authenticating', message: 'Authenticating with the remote profile server' })
  const auth = await dependencies.authenticate(config.serverUrl, config.username, config.password, options.signal)
  if (!auth.success || !auth.sessionId) {
    result.errors.push(auth.error || 'Remote authentication failed')
    onProgress?.({ phase: 'error', message: result.errors[0] })
    return result
  }

  if (!options.memoriesOnly) {
    onProgress?.({ phase: 'profile', message: 'Downloading the validated profile bundle' })
    const bundle = await dependencies.fetchBundle(config.serverUrl, config.username, config.password, options.signal)
    if (!bundle.success || !bundle.bundle) {
      result.errors.push(bundle.error || 'Profile download failed')
    } else {
      try {
        const imported = await dependencies.importBundle(username, bundle.bundle, {
          skipConfig: options.skipConfig,
          skipPersona: options.skipPersona,
          expectedSourceUsername: config.username,
        })
        result.profile = imported
        result.profileFiles = imported.imported
        result.errors.push(...imported.errors)
      } catch (error) {
        result.errors.push((error as Error).message)
      }
    }

    if (!options.skipConfig) {
      onProgress?.({ phase: 'credentials', message: 'Synchronizing profile credentials' })
      const remoteCredentials = await dependencies.fetchCredentials(config.serverUrl, auth.sessionId, options.signal)
      if (remoteCredentials.status === 'failed') {
        result.errors.push(remoteCredentials.error || 'Credential download failed')
      } else if (remoteCredentials.status === 'available' && remoteCredentials.credentials) {
        const applied = await dependencies.applyCredentials(username, remoteCredentials.credentials)
        result.credentialKeys = applied.saved
        result.credentialsSynced = applied.saved.length > 0
        result.errors.push(...applied.errors)
      }
    }
  }

  let memoryCompletedAt: string | undefined
  if (!options.profileOnly) {
    onProgress?.({ phase: 'memories', message: 'Synchronizing episodic memories', current: 0 })
    const startedAt = dependencies.now().toISOString()
    const since = options.fullSync || options.days ? undefined : config.lastMemorySyncAt
    let offset = 0
    let pageCount = 0
    let hasMore = true
    while (hasMore) {
      assertNotAborted(options.signal)
      pageCount++
      if (pageCount > MAX_MEMORY_SYNC_PAGES) {
        result.errors.push(`Memory sync exceeded ${MAX_MEMORY_SYNC_PAGES} pages`)
        break
      }
      const page = await dependencies.fetchMemories(config.serverUrl, config.username, config.password, {
        offset,
        limit: MEMORY_SYNC_PAGE_SIZE,
        days: options.days,
        since,
      }, options.signal)
      if (!page.success || !page.memories) {
        result.errors.push(page.error || 'Memory download failed')
        break
      }
      if (page.hasMore && page.memories.length === 0) {
        result.errors.push('Remote memory pagination returned an empty non-terminal page')
        break
      }
      for (const rawMemory of page.memories) {
        try {
          const memory = validateRemoteMemory(rawMemory)
          const outcome = captureRemoteMemory(memory, config.serverUrl, dependencies.captureMemory)
          result.memories.push(outcome)
          if (outcome.status === 'failed') result.errors.push(`${outcome.id}: ${outcome.error}`)
        } catch (error) {
          const id = rawMemory && typeof rawMemory === 'object' && 'id' in rawMemory ? String(rawMemory.id) : 'unknown'
          const outcome = { id, status: 'failed' as const, error: (error as Error).message }
          result.memories.push(outcome)
          result.errors.push(`${id}: ${outcome.error}`)
        }
      }
      offset += page.memories.length
      hasMore = page.hasMore === true
      onProgress?.({
        phase: 'memories',
        message: `Processed ${offset} remote memories`,
        current: offset,
        total: page.total,
      })
    }
    result.memoriesImported = result.memories.filter(outcome => outcome.status === 'imported').length
    result.memoriesDeduplicated = result.memories.filter(outcome => outcome.status === 'deduplicated').length
    if (result.errors.length === 0 && !options.days) memoryCompletedAt = startedAt
  }

  if (result.errors.length === 0) {
    const completedAt = dependencies.now().toISOString()
    await dependencies.updateCheckpoint(username, completedAt, memoryCompletedAt)
    result.success = true
    onProgress?.({ phase: 'complete', message: 'Profile sync complete' })
  } else {
    onProgress?.({ phase: 'error', message: result.errors.join('; ') })
  }
  return result
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const options = parseSyncOptions(input.args || [], input.options || {})
    options.signal = ctx.signal
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      actor: 'agent',
      details: { agent: 'profile-sync', username: ctx.username, options },
    })
    const result = await syncUserProfile(ctx.username, options, progress => {
      ctx.log?.(`[${progress.phase}] ${progress.message}`, progress.phase === 'error' ? 'error' : 'info')
    })
    audit({
      level: result.success ? 'info' : 'error',
      category: 'action',
      event: result.success ? 'agent_cycle_completed' : 'agent_cycle_failed',
      actor: 'agent',
      details: {
        agent: 'profile-sync',
        username: ctx.username,
        profileFiles: result.profileFiles,
        memoriesImported: result.memoriesImported,
        memoriesDeduplicated: result.memoriesDeduplicated,
        errors: result.errors,
      },
    })
    auditAction({
      skill: 'profile-sync',
      inputs: options,
      success: result.success,
      output: result,
      error: result.success ? undefined : result.errors.join('; '),
    })
    return {
      success: result.success,
      data: result,
      error: result.success ? undefined : result.errors.join('; '),
      duration: Date.now() - startedAt,
      itemsProcessed: result.profileFiles + result.memoriesImported + result.memoriesDeduplicated,
    }
  } catch (error) {
    const message = (error as Error).message
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      actor: 'agent',
      details: { agent: 'profile-sync', username: ctx.username, error: message },
    })
    return { success: false, error: message, duration: Date.now() - startedAt }
  }
}
