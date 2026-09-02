/** Finite, profile-scoped generic inbox ingestion. */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  acquireLock,
  audit,
  auditAction,
  captureEventWithDetails,
  getTargetUser,
  storageClient,
  withUserContext,
  type CaptureResult,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export const DEFAULT_CHUNK_CHARS = 2_000
export const MAX_CHUNK_CHARS = 50_000
export const MAX_CHUNKS_PER_FILE = 500
export const MAX_FILE_BYTES = 1_000_000
export const MAX_FILES_PER_RUN = 1_000
export const SUPPORTED_INGESTOR_EXTENSIONS = ['.json', '.md', '.txt'] as const

const SUPPORTED_EXTENSIONS = new Set<string>(SUPPORTED_INGESTOR_EXTENSIONS)

export interface IngestorOptions {
  username?: string
  maxChars?: number
  limit?: number
  signal?: AbortSignal
}

export type IngestedChunkStatus = 'created' | 'deduplicated' | 'failed'

export interface IngestedChunkOutcome {
  index: number
  total: number
  status: IngestedChunkStatus
  idempotencyKey: string
  eventId?: string
  filePath?: string
  encryptionFallback?: boolean
  error?: string
}

export interface IngestedFileOutcome {
  file: string
  status: 'processed' | 'failed'
  bytes: number
  contentHash?: string
  archivePath?: string
  chunks: IngestedChunkOutcome[]
  warnings: string[]
  error?: string
}

export interface IngestorResult {
  success: boolean
  username?: string
  filesDiscovered: number
  filesProcessed: number
  filesFailed: number
  chunksCreated: number
  chunksDeduplicated: number
  outcomes: IngestedFileOutcome[]
  errors: string[]
}

export interface IngestorDependencies {
  captureEvent: (content: string, options: Parameters<typeof captureEventWithDetails>[1]) => CaptureResult
  archiveFile: (source: string, destination: string, sourceHash: string) => void
  resolveInboxPaths: () => InboxPaths
  recordAction: typeof auditAction
  now: () => Date
}

const DEFAULT_DEPENDENCIES: IngestorDependencies = {
  captureEvent: captureEventWithDetails,
  archiveFile: archiveSourceFile,
  resolveInboxPaths,
  recordAction: auditAction,
  now: () => new Date(),
}

export interface InboxPaths {
  inbox: string
  archive: string
}

interface InboxFile {
  content: string
  contentHash: string
  sourceHash: string
  bytes: number
  timestamp: string
}

function emptyResult(username?: string): IngestorResult {
  return {
    success: false,
    username,
    filesDiscovered: 0,
    filesProcessed: 0,
    filesFailed: 0,
    chunksCreated: 0,
    chunksDeduplicated: 0,
    outcomes: [],
    errors: [],
  }
}

function positiveInteger(value: unknown, field: string, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

export function parseIngestorOptions(
  args: string[] = [],
  structured: Record<string, unknown> = {},
): Pick<IngestorOptions, 'limit' | 'maxChars'> {
  const parsed: Pick<IngestorOptions, 'limit' | 'maxChars'> = {
    limit: positiveInteger(structured.limit, 'limit', MAX_FILES_PER_RUN),
    maxChars: positiveInteger(structured.maxChars, 'maxChars', MAX_CHUNK_CHARS),
  }

  for (const argument of args) {
    if (argument === '--') continue
    const match = /^--(limit|max-chars)=(.+)$/.exec(argument)
    if (!match) throw new Error(`Unknown ingestor option: ${argument}`)
    const value = Number(match[2])
    if (match[1] === 'limit') parsed.limit = positiveInteger(value, 'limit', MAX_FILES_PER_RUN)
    else parsed.maxChars = positiveInteger(value, 'maxChars', MAX_CHUNK_CHARS)
  }

  return parsed
}

export function resolveInboxPaths(): InboxPaths {
  const inboxResult = storageClient.resolvePath({ category: 'memory', subcategory: 'inbox' })
  if (!inboxResult.success || !inboxResult.path) {
    throw new Error('Cannot resolve the profile memory inbox')
  }
  return {
    inbox: inboxResult.path,
    archive: path.join(inboxResult.path, '_archive'),
  }
}

function hashBuffer(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeUtf8(buffer: Buffer, fileName: string): string {
  if (buffer.includes(0)) throw new Error(`${fileName} contains binary data`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(`${fileName} is not valid UTF-8 text`)
  }
}

export function readInboxFile(filePath: string): InboxFile {
  const fileName = path.basename(filePath)
  const extension = path.extname(fileName).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `${fileName} has unsupported extension ${extension || '(none)'}; supported extensions: ${SUPPORTED_INGESTOR_EXTENSIONS.join(', ')}`,
    )
  }

  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error(`${fileName} is not a regular file`)
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${fileName} exceeds the ${MAX_FILE_BYTES}-byte ingestion limit`)
  }

  const source = fs.readFileSync(filePath)
  if (source.byteLength > MAX_FILE_BYTES) {
    throw new Error(`${fileName} exceeds the ${MAX_FILE_BYTES}-byte ingestion limit`)
  }
  const decoded = decodeUtf8(source, fileName)
  let content = decoded
  if (extension === '.json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(decoded)
    } catch (error) {
      throw new Error(`${fileName} contains malformed JSON: ${(error as Error).message}`)
    }
    content = typeof parsed === 'string'
      ? parsed
      : parsed && typeof parsed === 'object' && typeof (parsed as { content?: unknown }).content === 'string'
        ? (parsed as { content: string }).content
        : JSON.stringify(parsed, null, 2)
  }

  if (!content.trim()) throw new Error(`${fileName} contains no ingestible text`)

  return {
    content,
    contentHash: hashBuffer(content),
    sourceHash: hashBuffer(source),
    bytes: source.byteLength,
    timestamp: stat.mtime.toISOString(),
  }
}

export function chunkText(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  positiveInteger(maxChars, 'maxChars', MAX_CHUNK_CHARS)
  const total = Math.ceil(text.length / maxChars)
  if (total > MAX_CHUNKS_PER_FILE) {
    throw new Error(`Content requires ${total} chunks; maximum is ${MAX_CHUNKS_PER_FILE}`)
  }
  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += maxChars) {
    chunks.push(text.slice(offset, offset + maxChars))
  }
  return chunks
}

function idempotencyKey(fileName: string, contentHash: string, index: number, total: number): string {
  const identity = `${fileName}\0${contentHash}\0${index}\0${total}`
  return `ingestor:${hashBuffer(identity)}`
}

function archiveName(fileName: string, sourceHash: string): string {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  return `${stem}.${sourceHash.slice(0, 12)}${extension}`
}

function archiveSourceFile(source: string, destination: string, sourceHash: string): void {
  const currentHash = hashBuffer(fs.readFileSync(source))
  if (currentHash !== sourceHash) {
    throw new Error(`${path.basename(source)} changed while it was being ingested`)
  }
  if (!fs.existsSync(destination)) {
    fs.renameSync(source, destination)
    return
  }
  const existingHash = hashBuffer(fs.readFileSync(destination))
  if (existingHash !== sourceHash) {
    throw new Error(`Archive collision at ${path.basename(destination)}`)
  }
  fs.unlinkSync(source)
}

function failedFile(file: string, error: unknown, partial: Partial<IngestedFileOutcome> = {}): IngestedFileOutcome {
  return {
    file,
    status: 'failed',
    bytes: partial.bytes ?? 0,
    contentHash: partial.contentHash,
    chunks: partial.chunks ?? [],
    warnings: partial.warnings ?? [],
    error: error instanceof Error ? error.message : String(error),
  }
}

export async function ingestFile(
  filePath: string,
  paths: InboxPaths,
  options: Pick<IngestorOptions, 'maxChars' | 'signal'> = {},
  dependencies: IngestorDependencies = DEFAULT_DEPENDENCIES,
): Promise<IngestedFileOutcome> {
  const fileName = path.basename(filePath)
  let source: InboxFile
  try {
    source = readInboxFile(filePath)
  } catch (error) {
    return failedFile(fileName, error)
  }

  let chunks: string[]
  try {
    chunks = chunkText(source.content, options.maxChars ?? DEFAULT_CHUNK_CHARS)
  } catch (error) {
    return failedFile(fileName, error, { bytes: source.bytes, contentHash: source.contentHash })
  }

  const outcomes: IngestedChunkOutcome[] = []
  const warnings: string[] = []
  for (let index = 0; index < chunks.length; index += 1) {
    if (options.signal?.aborted) {
      return failedFile(fileName, options.signal.reason || new DOMException('Ingestion cancelled', 'AbortError'), {
        bytes: source.bytes,
        contentHash: source.contentHash,
        chunks: outcomes,
        warnings,
      })
    }

    const key = idempotencyKey(fileName, source.contentHash, index, chunks.length)
    try {
      const capture = dependencies.captureEvent(chunks[index], {
        type: 'observation',
        timestamp: source.timestamp,
        idempotencyKey: key,
        tags: ['ingested', 'inbox'],
        links: [{
          type: 'source',
          target: chunks.length > 1 ? `${fileName} [${index + 1}/${chunks.length}]` : fileName,
        }],
        metadata: {
          sourceFile: fileName,
          sourceHash: source.sourceHash,
          contentHash: source.contentHash,
          chunkIndex: index + 1,
          chunkTotal: chunks.length,
        },
      })
      const status: IngestedChunkStatus = capture.deduplicated ? 'deduplicated' : 'created'
      outcomes.push({
        index: index + 1,
        total: chunks.length,
        status,
        idempotencyKey: key,
        eventId: capture.eventId,
        filePath: capture.filePath || undefined,
        encryptionFallback: capture.encryptionFallback,
      })
      if (capture.encryptionFallback) {
        warnings.push(`Chunk ${index + 1} used the memory owner's reported encryption fallback`)
      }
      dependencies.recordAction({
        skill: 'ingestor:capture',
        inputs: { file: fileName, chunk: index + 1, total: chunks.length, idempotencyKey: key },
        success: true,
        output: { eventId: capture.eventId, status, path: capture.filePath },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcomes.push({
        index: index + 1,
        total: chunks.length,
        status: 'failed',
        idempotencyKey: key,
        error: message,
      })
      dependencies.recordAction({
        skill: 'ingestor:capture',
        inputs: { file: fileName, chunk: index + 1, total: chunks.length, idempotencyKey: key },
        success: false,
        error: message,
      })
      return failedFile(fileName, error, {
        bytes: source.bytes,
        contentHash: source.contentHash,
        chunks: outcomes,
        warnings,
      })
    }
  }

  const archiveDir = path.join(paths.archive, dependencies.now().toISOString().slice(0, 10))
  const destination = path.join(archiveDir, archiveName(fileName, source.sourceHash))
  try {
    fs.mkdirSync(archiveDir, { recursive: true })
    dependencies.archiveFile(filePath, destination, source.sourceHash)
    dependencies.recordAction({
      skill: 'ingestor:archive',
      inputs: { source: fileName, sourceHash: source.sourceHash },
      success: true,
      output: { archivePath: destination, chunks: chunks.length },
    })
  } catch (error) {
    dependencies.recordAction({
      skill: 'ingestor:archive',
      inputs: { source: fileName, sourceHash: source.sourceHash },
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
    return failedFile(fileName, error, {
      bytes: source.bytes,
      contentHash: source.contentHash,
      chunks: outcomes,
      warnings,
    })
  }

  return {
    file: fileName,
    status: 'processed',
    bytes: source.bytes,
    contentHash: source.contentHash,
    archivePath: path.relative(paths.inbox, destination),
    chunks: outcomes,
    warnings,
  }
}

export async function processInbox(
  options: Pick<IngestorOptions, 'limit' | 'maxChars' | 'signal'> = {},
  dependencies: IngestorDependencies = DEFAULT_DEPENDENCIES,
): Promise<IngestorResult> {
  const limit = positiveInteger(options.limit, 'limit', MAX_FILES_PER_RUN)
  const maxChars = positiveInteger(options.maxChars, 'maxChars', MAX_CHUNK_CHARS) ?? DEFAULT_CHUNK_CHARS
  const paths = dependencies.resolveInboxPaths()
  fs.mkdirSync(paths.inbox, { recursive: true })
  fs.mkdirSync(paths.archive, { recursive: true })

  const discovered = fs.readdirSync(paths.inbox, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(paths.inbox, entry.name))
    .sort((left, right) => left.localeCompare(right))
  const files = limit === undefined ? discovered : discovered.slice(0, limit)
  const result = emptyResult()
  result.filesDiscovered = discovered.length

  for (const file of files) {
    const outcome = await ingestFile(file, paths, { maxChars, signal: options.signal }, dependencies)
    result.outcomes.push(outcome)
  }

  result.filesProcessed = result.outcomes.filter(outcome => outcome.status === 'processed').length
  result.filesFailed = result.outcomes.filter(outcome => outcome.status === 'failed').length
  result.chunksCreated = result.outcomes.flatMap(outcome => outcome.chunks)
    .filter(outcome => outcome.status === 'created').length
  result.chunksDeduplicated = result.outcomes.flatMap(outcome => outcome.chunks)
    .filter(outcome => outcome.status === 'deduplicated').length
  result.errors = result.outcomes.flatMap(outcome => outcome.error ? [`${outcome.file}: ${outcome.error}`] : [])
  result.success = result.filesFailed === 0
  return result
}

export async function runIngestor(options: IngestorOptions = {}): Promise<IngestorResult> {
  const result = emptyResult(options.username)
  let target: ReturnType<typeof getTargetUser>
  try {
    positiveInteger(options.limit, 'limit', MAX_FILES_PER_RUN)
    positiveInteger(options.maxChars, 'maxChars', MAX_CHUNK_CHARS)
    target = getTargetUser({ username: options.username })
    if (!target) throw new Error('Ingestor requires an explicit or active authenticated profile')
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error))
    return result
  }

  result.username = target.username
  const lockName = `ingestor-${hashBuffer(target.username).slice(0, 16)}`
  let lock: ReturnType<typeof acquireLock> | undefined
  try {
    lock = acquireLock(lockName, { exitOnSignal: false })
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'ingestor', mode: 'profile-scoped', username: target.username },
      actor: 'agent',
    })
    const processed = await withUserContext(
      { userId: target.userId, username: target.username, role: target.role },
      () => processInbox(options),
    )
    processed.username = target.username
    audit({
      level: processed.success ? 'info' : 'error',
      category: 'action',
      event: processed.success ? 'agent_cycle_completed' : 'agent_cycle_failed',
      details: {
        agent: 'ingestor',
        mode: 'profile-scoped',
        username: target.username,
        filesProcessed: processed.filesProcessed,
        filesFailed: processed.filesFailed,
        errors: processed.errors,
      },
      actor: 'agent',
    })
    return processed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(message)
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'ingestor', mode: 'profile-scoped', username: target.username, error: message },
      actor: 'agent',
    })
    return result
  } finally {
    lock?.release()
  }
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseIngestorOptions(input.args, input.options)
    const result = await runIngestor({ ...parsed, username: ctx.username, signal: ctx.signal })
    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      errors: result.errors,
      duration: Date.now() - startedAt,
      itemsProcessed: result.filesProcessed,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startedAt,
    }
  }
}
