/** Canonical finite owner for private, self-directed curiosity Q&A. */

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  audit,
  callLLM,
  cognitiveGraphPath,
  getFirstFailedNode,
  getProfilePaths,
  getTargetUser,
  loadCuriosityConfig,
  loadGraphFile,
  loadPersonaCore,
  queryIndexWithReconciliation,
  runGraph,
  safeReadJSON,
  safeWriteJSON,
  sampleCuriosityMemories,
  submitInnerReflection,
  withUserContext,
  type CuriosityMemoryEvidence,
  type CuriosityMemorySample,
  type CuriosityConfig,
  type VectorIndexItem,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

const LOG_PREFIX = '[inner-curiosity]'
const RECEIPT_SCHEMA_VERSION = 1
const MAX_RECEIPTS = 768
const MAX_EXECUTION_ID_CHARS = 400

export type InnerCuriositySkipReason = 'disabled' | 'no-memories'

export interface InnerCuriosityOptions {
  username?: string
  executionId?: string
  executionTimestamp?: string
  signal?: AbortSignal
}

export type InnerCuriosityOutcome =
  | {
    status: 'generated'
    username: string
    executionId: string
    deduplicated: boolean
    memoriesConsidered: number
    searchResults: number
  }
  | {
    status: 'skipped'
    username: string
    executionId: string
    reason: InnerCuriositySkipReason
  }

export interface InnerCuriosityResult {
  success: boolean
  questionsGenerated: number
  questionsSkipped: number
  userCount: number
  outcome?: InnerCuriosityOutcome
  errors: string[]
}

interface InnerCuriosityReceiptBase {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION
  kind: 'inner-curiosity-execution'
  executionId: string
  idempotencyKey: string
  username: string
  timestamp: string
  question: string
  answer: string
  innerDialogue: string
  sourceMemoryIds: string[]
  searchResultIds: string[]
  sampling: CuriosityMemorySample['diagnostics']
}

export interface PreparedInnerCuriosityReceipt extends InnerCuriosityReceiptBase {
  status: 'prepared'
  preparedAt: string
}

export interface CompletedInnerCuriosityReceipt extends InnerCuriosityReceiptBase {
  status: 'completed'
  preparedAt: string
  completedAt: string
}

export type InnerCuriosityReceipt = PreparedInnerCuriosityReceipt | CompletedInnerCuriosityReceipt

export interface InnerCuriosityDependencies {
  loadConfig: (username: string) => CuriosityConfig
  sampleMemories: (username: string) => Promise<CuriosityMemorySample>
  loadPersonaName: () => string
  generateQuestion: (
    memories: CuriosityMemoryEvidence[],
    personaName: string,
    signal?: AbortSignal,
  ) => Promise<string>
  searchMemories: (question: string, username: string, signal?: AbortSignal) => Promise<VectorIndexItem[]>
  generateAnswer: (
    question: string,
    memories: CuriosityMemoryEvidence[],
    searchResults: VectorIndexItem[],
    personaName: string,
    signal?: AbortSignal,
  ) => Promise<string>
  loadReceipt: (username: string, idempotencyKey: string) => InnerCuriosityReceipt | null
  saveReceipt: (receipt: InnerCuriosityReceipt) => void
  persistDialogue: (receipt: PreparedInnerCuriosityReceipt, signal?: AbortSignal) => Promise<void>
  triggerFollowOn: (receipt: PreparedInnerCuriosityReceipt, signal?: AbortSignal) => Promise<void>
  auditGenerated: (receipt: CompletedInnerCuriosityReceipt, deduplicated: boolean) => void
  now: () => Date
  newExecutionId: () => string
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Inner Curiosity execution cancelled', 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireBoundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} returned empty content`)
  const text = value.trim()
  if (text.length > maximum) throw new Error(`${label} exceeded the ${maximum}-character limit`)
  return text
}

function validateExecutionId(value: string): string {
  const executionId = value.trim()
  if (!executionId) throw new Error('Inner Curiosity executionId must not be empty')
  if (executionId.length > MAX_EXECUTION_ID_CHARS) {
    throw new Error(`Inner Curiosity executionId must not exceed ${MAX_EXECUTION_ID_CHARS} characters`)
  }
  return executionId
}

function validateTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) throw new Error('Inner Curiosity executionTimestamp must be a valid date')
  return new Date(value).toISOString()
}

function executionIdentity(
  username: string,
  options: InnerCuriosityOptions,
  dependencies: InnerCuriosityDependencies,
): { executionId: string; idempotencyKey: string; requestedTimestamp?: string } {
  const executionId = validateExecutionId(options.executionId || dependencies.newExecutionId())
  return {
    executionId,
    idempotencyKey: `inner-curiosity:${username}:${executionId}`,
    requestedTimestamp: options.executionTimestamp
      ? validateTimestamp(options.executionTimestamp)
      : undefined,
  }
}

function receiptFile(username: string, idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex')
  return path.join(getProfilePaths(username).state, 'inner-curiosity', `${digest}.json`)
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid Inner Curiosity receipt ${field}`)
  }
  return value.map(item => String(item).trim())
}

function parseSamplingDiagnostics(value: unknown): CuriosityMemorySample['diagnostics'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Inner Curiosity receipt sampling diagnostics')
  }
  const record = value as Record<string, unknown>
  const fields = [
    'filesConsidered',
    'filesRead',
    'skippedMalformed',
    'skippedOversize',
    'skippedGenerated',
    'skippedEmpty',
    'truncatedContent',
  ] as const
  for (const field of fields) {
    if (!Number.isSafeInteger(record[field]) || Number(record[field]) < 0) {
      throw new Error(`Invalid Inner Curiosity receipt sampling.${field}`)
    }
  }
  return {
    filesConsidered: Number(record.filesConsidered),
    filesRead: Number(record.filesRead),
    skippedMalformed: Number(record.skippedMalformed),
    skippedOversize: Number(record.skippedOversize),
    skippedGenerated: Number(record.skippedGenerated),
    skippedEmpty: Number(record.skippedEmpty),
    truncatedContent: Number(record.truncatedContent),
  }
}

function parseReceipt(value: unknown): InnerCuriosityReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Inner Curiosity receipt object')
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== RECEIPT_SCHEMA_VERSION || record.kind !== 'inner-curiosity-execution') {
    throw new Error('Unsupported Inner Curiosity receipt schema')
  }
  if (record.status !== 'prepared' && record.status !== 'completed') {
    throw new Error('Invalid Inner Curiosity receipt status')
  }
  const requiredStrings = [
    'executionId', 'idempotencyKey', 'username', 'timestamp', 'question',
    'answer', 'innerDialogue', 'preparedAt',
  ] as const
  for (const field of requiredStrings) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      throw new Error(`Invalid Inner Curiosity receipt ${field}`)
    }
  }
  validateTimestamp(String(record.timestamp))
  validateTimestamp(String(record.preparedAt))
  const common: InnerCuriosityReceiptBase & { preparedAt: string } = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'inner-curiosity-execution' as const,
    executionId: String(record.executionId),
    idempotencyKey: String(record.idempotencyKey),
    username: String(record.username),
    timestamp: String(record.timestamp),
    question: String(record.question),
    answer: String(record.answer),
    innerDialogue: String(record.innerDialogue),
    sourceMemoryIds: requireStringArray(record.sourceMemoryIds, 'sourceMemoryIds'),
    searchResultIds: requireStringArray(record.searchResultIds, 'searchResultIds'),
    sampling: parseSamplingDiagnostics(record.sampling),
    preparedAt: String(record.preparedAt),
  }
  if (record.status === 'prepared') return { ...common, status: 'prepared' }
  if (typeof record.completedAt !== 'string' || !record.completedAt.trim()) {
    throw new Error('Invalid Inner Curiosity receipt completedAt')
  }
  validateTimestamp(record.completedAt)
  return { ...common, status: 'completed', completedAt: record.completedAt }
}

function loadReceipt(username: string, idempotencyKey: string): InnerCuriosityReceipt | null {
  const file = receiptFile(username, idempotencyKey)
  if (!fs.existsSync(file)) return null
  const receipt = parseReceipt(safeReadJSON<unknown>(file))
  if (receipt.username !== username || receipt.idempotencyKey !== idempotencyKey) {
    throw new Error('Inner Curiosity receipt identity does not match the requested execution')
  }
  return receipt
}

function pruneReceipts(username: string): void {
  const directory = path.join(getProfilePaths(username).state, 'inner-curiosity')
  if (!fs.existsSync(directory)) return
  const receipts = fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)
  let excess = receipts.length - MAX_RECEIPTS
  for (const receipt of receipts.slice().reverse()) {
    if (excess <= 0) break
    const file = path.join(directory, receipt.name)
    const parsed = parseReceipt(safeReadJSON<unknown>(file))
    if (parsed.status !== 'completed') continue
    fs.unlinkSync(file)
    excess -= 1
    const backupDirectory = path.join(directory, '.backups')
    if (!fs.existsSync(backupDirectory)) continue
    for (const backup of fs.readdirSync(backupDirectory)) {
      if (backup.startsWith(`${receipt.name}.`) && backup.endsWith('.bak')) {
        fs.unlinkSync(path.join(backupDirectory, backup))
      }
    }
  }
}

function saveReceipt(receipt: InnerCuriosityReceipt): void {
  safeWriteJSON(receiptFile(receipt.username, receipt.idempotencyKey), receipt)
  if (receipt.status === 'completed') pruneReceipts(receipt.username)
}

async function generateQuestion(
  memories: CuriosityMemoryEvidence[],
  personaName: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const memoriesText = memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')
  const response = await callLLM({
    role: 'persona',
    messages: [
      {
        role: 'system',
        content: `You are ${personaName}'s internal curiosity. Generate one private, self-directed question that explores deeper patterns, connections, meanings, or implications in recent experiences. Ask yourself rather than the user. Keep it under 100 words.`,
      },
      {
        role: 'user',
        content: `Recent experiences:\n${memoriesText}\n\nWhat question should I ask myself to deepen my understanding?`,
      },
    ],
    options: { temperature: 0.8, maxTokens: 192 },
  })
  throwIfAborted(signal)
  return requireBoundedText(response.content, 'Inner Curiosity question model', 1_500)
}

function searchTerms(question: string): string[] {
  const stopWords = new Set(['about', 'could', 'should', 'their', 'there', 'these', 'think', 'through', 'what', 'when', 'where', 'which', 'would'])
  return [...new Set(question.toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) || [])]
    .filter(word => !stopWords.has(word))
    .slice(0, 3)
}

async function searchMemories(
  question: string,
  username: string,
  signal?: AbortSignal,
): Promise<VectorIndexItem[]> {
  const results: VectorIndexItem[] = []
  for (const term of searchTerms(question)) {
    throwIfAborted(signal)
    const matches = await queryIndexWithReconciliation(term, {
      topK: 3,
      username,
      reconciliationSource: 'inner-curiosity',
    })
    results.push(...matches.map(match => match.item))
  }
  throwIfAborted(signal)
  return [...new Map(results.map(result => [result.id, result])).values()].slice(0, 9)
}

async function generateAnswer(
  question: string,
  memories: CuriosityMemoryEvidence[],
  searchResults: VectorIndexItem[],
  personaName: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal)
  const memoriesText = memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')
  const searchContext = searchResults.length > 0
    ? `\n\nRelevant indexed memories:\n${searchResults.map((result, index) => `${index + 1}. ${result.text.slice(0, 500)}`).join('\n')}`
    : ''
  const response = await callLLM({
    role: 'persona',
    messages: [
      {
        role: 'system',
        content: `You are ${personaName} privately contemplating a self-directed question. Answer from the supplied memories. Be thoughtful, exploratory, and explicit about uncertainty or missing evidence.`,
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nRecent experiences:\n${memoriesText}${searchContext}\n\nWhat grounded insights or patterns emerge?`,
      },
    ],
    options: { temperature: 0.7, maxTokens: 768 },
  })
  throwIfAborted(signal)
  return requireBoundedText(response.content, 'Inner Curiosity answer model', 10_000)
}

async function persistDialogue(receipt: PreparedInnerCuriosityReceipt, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const persisted = await submitInnerReflection(receipt.username, receipt.innerDialogue, {
    dialogueSource: 'inner-curiosity',
    displayColor: '#8b5cf6',
    type: 'inner_question',
    tags: ['inner-curiosity', 'self-directed-question', 'inner'],
    idempotencyKey: receipt.idempotencyKey,
    skipDedup: true,
    innerCuriosity: {
      question: receipt.question,
      answer: receipt.answer,
      sourceMemoryIds: receipt.sourceMemoryIds,
      searchResultIds: receipt.searchResultIds,
    },
  }, {
    idempotencyKey: receipt.idempotencyKey,
    memoryTimestamp: receipt.timestamp,
  })
  throwIfAborted(signal)
  if (!persisted) throw new Error('Inner Buffer admission completed without durable persistence')
}

async function triggerFollowOn(receipt: PreparedInnerCuriosityReceipt, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  const loaded = await loadGraphFile(cognitiveGraphPath('inner-curiosity-follow-on.json'), {
    logPrefix: LOG_PREFIX,
  })
  if (!loaded) throw new Error('Inner Curiosity follow-on graph could not be loaded')
  const result = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      userId: receipt.username,
      username: receipt.username,
      cognitiveMode: 'agent',
      allowMemoryWrites: false,
      followOnSeed: receipt.innerDialogue,
      idempotencyKey: receipt.idempotencyKey,
      executionId: receipt.executionId,
      abortSignal: signal,
    },
  })
  throwIfAborted(signal)
  if (result.status !== 'completed') {
    const failure = getFirstFailedNode(result)
    throw new Error(
      failure
        ? `Inner Curiosity follow-on failed at node ${failure.nodeId}: ${failure.error}`
        : 'Inner Curiosity follow-on graph did not complete',
    )
  }
}

function auditGenerated(receipt: CompletedInnerCuriosityReceipt, deduplicated: boolean): void {
  audit({
    category: 'action',
    level: 'info',
    event: 'inner_question_generated',
    actor: 'inner-curiosity',
    details: {
      executionId: receipt.executionId,
      memoriesConsidered: receipt.sourceMemoryIds.length,
      searchResults: receipt.searchResultIds.length,
      skippedMemories: receipt.sampling.skippedMalformed
        + receipt.sampling.skippedOversize
        + receipt.sampling.skippedEmpty,
      deduplicated,
      username: receipt.username,
    },
  })
}

const DEFAULT_DEPENDENCIES: InnerCuriosityDependencies = {
  loadConfig: loadCuriosityConfig,
  sampleMemories: username => sampleCuriosityMemories({ username }),
  loadPersonaName: () => requireBoundedText(loadPersonaCore().identity.name, 'Persona identity name', 200),
  generateQuestion,
  searchMemories,
  generateAnswer,
  loadReceipt,
  saveReceipt,
  persistDialogue,
  triggerFollowOn,
  auditGenerated,
  now: () => new Date(),
  newExecutionId: randomUUID,
}

/**
 * Execute one already-authenticated profile cycle. Exported for focused tests;
 * production callers use runInnerCuriosity(), which resolves real identity.
 */
export async function executeInnerCuriosityForUser(
  username: string,
  options: InnerCuriosityOptions = {},
  dependencies: InnerCuriosityDependencies = DEFAULT_DEPENDENCIES,
): Promise<InnerCuriosityOutcome> {
  throwIfAborted(options.signal)
  const identity = executionIdentity(username, options, dependencies)
  const existing = dependencies.loadReceipt(username, identity.idempotencyKey)
  if (existing) {
    if (
      existing.executionId !== identity.executionId
      || (identity.requestedTimestamp && existing.timestamp !== identity.requestedTimestamp)
    ) {
      throw new Error('Inner Curiosity execution identity conflicts with its durable receipt')
    }
    if (existing.status === 'completed') {
      return {
        status: 'generated',
        username,
        executionId: identity.executionId,
        deduplicated: true,
        memoriesConsidered: existing.sourceMemoryIds.length,
        searchResults: existing.searchResultIds.length,
      }
    }
    await dependencies.persistDialogue(existing, options.signal)
    await dependencies.triggerFollowOn(existing, options.signal)
    const completed: CompletedInnerCuriosityReceipt = {
      ...existing,
      status: 'completed',
      completedAt: dependencies.now().toISOString(),
    }
    dependencies.saveReceipt(completed)
    dependencies.auditGenerated(completed, true)
    return {
      status: 'generated',
      username,
      executionId: identity.executionId,
      deduplicated: true,
      memoriesConsidered: existing.sourceMemoryIds.length,
      searchResults: existing.searchResultIds.length,
    }
  }

  const config = dependencies.loadConfig(username)
  if (config.innerQuestionMode === 'off') {
    return { status: 'skipped', username, executionId: identity.executionId, reason: 'disabled' }
  }
  if (config.innerQuestionMode !== 'local') {
    throw new Error(`Unsupported Inner Curiosity mode: ${String(config.innerQuestionMode)}`)
  }

  const sample = await dependencies.sampleMemories(username)
  throwIfAborted(options.signal)
  if (sample.memories.length === 0) {
    return { status: 'skipped', username, executionId: identity.executionId, reason: 'no-memories' }
  }

  const personaName = dependencies.loadPersonaName()
  const question = await dependencies.generateQuestion(sample.memories, personaName, options.signal)
  const searchResults = await dependencies.searchMemories(question, username, options.signal)
  const answer = await dependencies.generateAnswer(
    question,
    sample.memories,
    searchResults,
    personaName,
    options.signal,
  )
  throwIfAborted(options.signal)

  const preparedAt = dependencies.now().toISOString()
  const timestamp = identity.requestedTimestamp || preparedAt
  const prepared: PreparedInnerCuriosityReceipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    kind: 'inner-curiosity-execution',
    status: 'prepared',
    executionId: identity.executionId,
    idempotencyKey: identity.idempotencyKey,
    username,
    timestamp,
    question,
    answer,
    innerDialogue: `🤔 ${question}\n\n💭 ${answer}`,
    sourceMemoryIds: sample.memories.map(memory => memory.id),
    searchResultIds: searchResults.map(result => result.id),
    sampling: sample.diagnostics,
    preparedAt,
  }
  dependencies.saveReceipt(prepared)
  await dependencies.persistDialogue(prepared, options.signal)
  await dependencies.triggerFollowOn(prepared, options.signal)
  const completed: CompletedInnerCuriosityReceipt = {
    ...prepared,
    status: 'completed',
    completedAt: dependencies.now().toISOString(),
  }
  dependencies.saveReceipt(completed)
  dependencies.auditGenerated(completed, false)
  return {
    status: 'generated',
    username,
    executionId: identity.executionId,
    deduplicated: false,
    memoriesConsidered: prepared.sourceMemoryIds.length,
    searchResults: prepared.searchResultIds.length,
  }
}

/** Canonical execution contract used by CLI, agent-runtime, and mobile. */
export async function runInnerCuriosity(options: InnerCuriosityOptions): Promise<InnerCuriosityOutcome> {
  const username = options.username?.trim()
  if (!username) throw new Error('Inner Curiosity requires a resolved username')
  const user = getTargetUser({ username })
  if (!user) throw new Error(`No authenticated user found for Inner Curiosity profile ${username}`)
  return withUserContext(user, () => executeInnerCuriosityForUser(username, options))
}

export function parseInnerCuriosityArgs(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): InnerCuriosityOptions {
  const unsupported = args.filter(argument => argument !== '--')
  if (unsupported.length > 0) throw new Error(`Unknown inner-curiosity option: ${unsupported[0]}`)
  return {
    username: environment.MH_TRIGGER_USERNAME?.trim() || undefined,
    executionId: environment.MH_TASK_ID?.trim() || undefined,
    executionTimestamp: environment.MH_TASK_CREATED_AT?.trim() || undefined,
  }
}

/** Run one bounded scheduled or manual cycle. */
export async function runCycle(options: InnerCuriosityOptions = {}): Promise<InnerCuriosityResult> {
  const result: InnerCuriosityResult = {
    success: false,
    questionsGenerated: 0,
    questionsSkipped: 0,
    userCount: 0,
    errors: [],
  }

  try {
    const targetUser = getTargetUser({ username: options.username })
    if (!targetUser) throw new Error('No explicit or active authenticated user found')
    result.userCount = 1
    result.outcome = await runInnerCuriosity({ ...options, username: targetUser.username })
    if (result.outcome.status === 'generated') result.questionsGenerated = 1
    else result.questionsSkipped = 1
    result.success = true
    audit({
      category: 'action',
      level: 'info',
      event: 'inner_curiosity_cycle_complete',
      actor: 'inner-curiosity',
      details: {
        status: result.outcome.status,
        reason: result.outcome.status === 'skipped' ? result.outcome.reason : undefined,
        questionsGenerated: result.questionsGenerated,
        questionsSkipped: result.questionsSkipped,
        username: targetUser.username,
      },
    })
  } catch (error) {
    const message = errorMessage(error)
    result.errors.push(message)
    console.error(`${LOG_PREFIX} ${message}`)
    audit({
      category: 'system',
      level: 'error',
      event: 'inner_curiosity_cycle_failed',
      actor: 'inner-curiosity',
      details: { error: message, username: options.username },
    })
  }

  return result
}

/** Agent Runtime entry point for in-process execution. */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    if ((input.args?.filter(argument => argument !== '--').length ?? 0) > 0) {
      throw new Error(`Unknown inner-curiosity option: ${input.args?.find(argument => argument !== '--')}`)
    }
    const allowedOptions = new Set(['executionId', 'executionTimestamp'])
    const unknownOption = Object.keys(input.options || {}).find(key => !allowedOptions.has(key))
    if (unknownOption) throw new Error(`Unknown inner-curiosity option: ${unknownOption}`)
    const result = await runCycle({
      username: ctx.username,
      executionId: typeof input.options?.executionId === 'string' ? input.options.executionId : undefined,
      executionTimestamp: typeof input.options?.executionTimestamp === 'string'
        ? input.options.executionTimestamp
        : undefined,
      signal: ctx.signal,
    })
    return {
      success: result.success,
      data: result,
      errors: result.errors.length > 0 ? result.errors : undefined,
      itemsProcessed: result.questionsGenerated,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
      durationMs: Date.now() - startedAt,
    }
  }
}
