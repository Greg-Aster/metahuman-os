/**
 * Curiosity Researcher Agent
 *
 * Independently investigates pending user-facing curiosity questions using the
 * profile's local memory index. Curiosity Service owns asking questions;
 * Curiosity Researcher owns the later research pass and its durable findings.
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'
import {
  audit,
  cognitiveGraphPath,
  curiosityQuestionStore,
  getFirstFailedNode,
  getProfilePaths,
  getTargetUser,
  loadGraphFile,
  loadCuriosityConfig,
  requireGraphNodeOutput,
  runGraph,
  safeWriteJSON,
  submitInnerReflectionWithResult,
  withUserContext,
  type CachedGraphEntry,
  type CuriosityQuestionRecord,
} from '@metahuman/core'
import { requireUserInfo } from '@metahuman/core/user-resolver'

const LOG_PREFIX = '[curiosity-researcher]'
const RESEARCH_SCHEMA_VERSION = 1 as const
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const SAFE_USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/
const GRAPH_FILE = 'curiosity-researcher.json'
const graphCache: Record<string, CachedGraphEntry | null> = {}

export interface CuriosityResearcherOptions {
  username?: string
  signal?: AbortSignal
}

export interface CuriosityResearcherResult {
  success: boolean
  usersProcessed: number
  researchCompleted: number
  errors: string[]
}

export type PendingCuriosityQuestion = Pick<
  CuriosityQuestionRecord,
  'id' | 'question' | 'askedAt' | 'seedMemories' | 'username'
> & {
  status: 'pending'
}

export interface CuriosityResearchFinding {
  topics: string[]
  sourceMemoryIds: string[]
  sourceResearchIds: string[]
  summary: string
}

export interface PreparedCuriosityResearch extends CuriosityResearchFinding {
  schemaVersion: typeof RESEARCH_SCHEMA_VERSION
  kind: 'curiosity-research'
  id: string
  status: 'prepared'
  questionId: string
  question: string
  questionAskedAt: string
  preparedAt: string
}

export interface CompletedCuriosityResearch extends Omit<PreparedCuriosityResearch, 'status'> {
  status: 'completed'
  completedAt: string
  memoryEventId?: string
  memoryEventDeduplicated?: boolean
}

export type CuriosityResearchRecord = PreparedCuriosityResearch | CompletedCuriosityResearch

export interface CuriosityResearchDependencies {
  researchQuestion: (
    question: PendingCuriosityQuestion,
    username: string,
    priorResearch: CompletedCuriosityResearch[],
    signal?: AbortSignal,
  ) => Promise<CuriosityResearchFinding>
  captureLearning: (record: PreparedCuriosityResearch, username: string) => Promise<{
    eventId: string
    filePath: string
    deduplicated?: boolean
  }> | {
    eventId: string
    filePath: string
    deduplicated?: boolean
  }
  writeRecord: (filePath: string, record: CuriosityResearchRecord) => void
  auditCompletion: (record: CompletedCuriosityResearch, username: string) => void
  now: () => string
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must contain only letters, numbers, underscores, or hyphens`)
  }
  return value
}

function requireNonEmptyString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} must not be empty`)
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`)
  return normalized
}

function requireTimestamp(value: unknown, label: string): string {
  const timestamp = requireNonEmptyString(value, label, 64)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO date-time`)
  }
  return timestamp
}

function stringArray(value: unknown, label: string, maxItems: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > maxItems) throw new Error(`${label} exceeds ${maxItems} items`)
  return value.map((item, index) => requireNonEmptyString(item, `${label}[${index}]`, 256))
}

function parseFinding(record: Record<string, unknown>): CuriosityResearchFinding {
  const topics = stringArray(record.topics, 'Curiosity research topics', 3)
  if (topics.length === 0) throw new Error('Curiosity research topics must not be empty')
  return {
    topics,
    sourceMemoryIds: stringArray(record.sourceMemoryIds, 'Curiosity research sourceMemoryIds', 15),
    sourceResearchIds: stringArray(record.sourceResearchIds, 'Curiosity research sourceResearchIds', 5),
    summary: requireNonEmptyString(record.summary, 'Curiosity research summary', 10_000),
  }
}

export function parseCuriosityResearchRecord(value: unknown): CuriosityResearchRecord {
  const record = requireObject(value, 'Curiosity research record')
  if (record.schemaVersion !== RESEARCH_SCHEMA_VERSION) {
    throw new Error(`Unsupported curiosity research schema version: ${String(record.schemaVersion)}`)
  }
  if (record.kind !== 'curiosity-research') throw new Error('Invalid curiosity research record kind')

  const questionId = requireSafeId(record.questionId, 'Curiosity research questionId')
  const common: Omit<PreparedCuriosityResearch, 'status'> = {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    kind: 'curiosity-research',
    id: requireNonEmptyString(record.id, 'Curiosity research id', 160),
    questionId,
    question: requireNonEmptyString(record.question, 'Curiosity research question', 10_000),
    questionAskedAt: requireTimestamp(record.questionAskedAt, 'Curiosity research questionAskedAt'),
    preparedAt: requireTimestamp(record.preparedAt, 'Curiosity research preparedAt'),
    ...parseFinding(record),
  }

  if (common.id !== `curiosity-research:${questionId}`) {
    throw new Error(`Curiosity research id does not match question ${questionId}`)
  }
  if (record.status === 'prepared') return { ...common, status: 'prepared' }
  if (record.status !== 'completed') throw new Error('Invalid curiosity research status')

  return {
    ...common,
    status: 'completed',
    completedAt: requireTimestamp(record.completedAt, 'Curiosity research completedAt'),
    memoryEventId: record.memoryEventId === undefined
      ? undefined
      : requireNonEmptyString(record.memoryEventId, 'Curiosity research memoryEventId', 160),
    memoryEventDeduplicated: record.memoryEventDeduplicated === true || undefined,
  }
}

/** Research one question against the authenticated profile's local index. */
export async function researchQuestion(
  question: PendingCuriosityQuestion,
  username: string,
  priorResearch: CompletedCuriosityResearch[] = [],
  signal?: AbortSignal,
): Promise<CuriosityResearchFinding> {
  const target = getTargetUser({ username })
  if (!target || target.username !== username) {
    throw new Error(`Curiosity Researcher profile does not exist: ${username}`)
  }
  const loaded = await loadGraphFile(cognitiveGraphPath(GRAPH_FILE), {
    cache: graphCache,
    cacheKey: GRAPH_FILE,
    logPrefix: LOG_PREFIX,
  })
  if (!loaded) throw new Error(`Curiosity Researcher graph ${GRAPH_FILE} could not be loaded`)
  const graphState = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      username: target.username,
      userId: target.userId,
      cognitiveMode: 'agent',
      curiosityResearchInput: { question, priorResearch },
      abortSignal: signal,
    },
  })
  if (graphState.status !== 'completed') {
    const failed = getFirstFailedNode(graphState)
    throw new Error(failed
      ? `Curiosity Researcher graph failed at ${failed.nodeId}: ${failed.error}`
      : `Curiosity Researcher graph ended with status ${graphState.status}`)
  }
  return parseFinding(requireObject(
    requireGraphNodeOutput(graphState, 'curiosity_research').finding,
    'Curiosity Researcher graph finding',
  ))
}

async function captureResearchLearning(record: PreparedCuriosityResearch, username: string): Promise<{
  eventId: string
  filePath: string
  deduplicated?: boolean
}> {
  const receipt = await submitInnerReflectionWithResult(
    username,
    `Curiosity research ${record.questionId}\n\nQuestion explored: ${record.question}\n\nFinding: ${record.summary}`,
    {
      type: 'curiosity_research',
      importance: 0.65,
      tags: ['curiosity', 'curiosity-research', 'inner'],
      dialogueSource: 'curiosity-researcher',
      curiosityResearch: {
        researchId: record.id,
        questionId: record.questionId,
        topics: record.topics,
        sourceMemoryIds: record.sourceMemoryIds,
        sourceResearchIds: record.sourceResearchIds,
      },
    },
    {
      idempotencyKey: record.id,
      memoryTimestamp: record.preparedAt,
    },
  )
  const memory = receipt.memoryResults[0]
  if (!memory?.filePath) throw new Error(`Memory capture returned no durable result for ${record.questionId}`)
  return memory
}

const defaultDependencies: CuriosityResearchDependencies = {
  researchQuestion,
  captureLearning: captureResearchLearning,
  writeRecord: (filePath, record) => safeWriteJSON(filePath, record),
  auditCompletion: (record, username) => {
    audit({
      category: 'action',
      level: 'info',
      event: 'curiosity_research_completed',
      actor: 'curiosity-researcher',
      details: {
        questionId: record.questionId,
        researchId: record.id,
        memoryEventId: record.memoryEventId,
        sourceMemoryCount: record.sourceMemoryIds.length,
        sourceResearchCount: record.sourceResearchIds.length,
        username,
      },
    })
  },
  now: () => new Date().toISOString(),
}

async function completePreparedResearch(
  prepared: PreparedCuriosityResearch,
  recordPath: string,
  username: string,
  dependencies: CuriosityResearchDependencies,
): Promise<void> {
  const capture = await dependencies.captureLearning(prepared, username)
  if (!capture.filePath && !capture.deduplicated) {
    throw new Error(`Memory capture returned no durable result for ${prepared.questionId}`)
  }

  const completed: CompletedCuriosityResearch = {
    ...prepared,
    status: 'completed',
    completedAt: dependencies.now(),
    memoryEventId: capture.deduplicated ? undefined : capture.eventId,
    memoryEventDeduplicated: capture.deduplicated === true || undefined,
  }
  dependencies.writeRecord(recordPath, completed)
  dependencies.auditCompletion(completed, username)
}

/**
 * Process at most one canonical pending question into the research store. This
 * is exported so the durable research lifecycle can be tested without profile
 * data or a second question-file reader.
 */
export async function processResearchQueue(
  pendingQuestions: PendingCuriosityQuestion[],
  researchPath: string,
  username: string,
  dependencies: CuriosityResearchDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<number> {
  await fs.mkdir(researchPath, { recursive: true })

  const priorResearch: CompletedCuriosityResearch[] = []
  for (const filename of (await fs.readdir(researchPath)).filter(name => name.endsWith('.json')).sort()) {
    const record = parseCuriosityResearchRecord(
      JSON.parse(await fs.readFile(path.join(researchPath, filename), 'utf8')),
    )
    if (filename !== `${record.questionId}.json`) {
      throw new Error(`Curiosity research filename does not match its question id: ${filename}`)
    }
    if (record.status === 'completed') priorResearch.push(record)
  }

  const questions = [...pendingQuestions].sort((left, right) => left.askedAt.localeCompare(right.askedAt)
    || left.id.localeCompare(right.id))
  for (const question of questions) {
    if (question.username !== username) {
      throw new Error(`Curiosity question ${question.id} belongs to ${question.username}, not ${username}`)
    }
    const recordPath = path.join(researchPath, `${question.id}.json`)

    if (fsSync.existsSync(recordPath)) {
      const existing = parseCuriosityResearchRecord(JSON.parse(await fs.readFile(recordPath, 'utf8')))
      if (existing.questionId !== question.id) {
        throw new Error(`Research record ${path.basename(recordPath)} belongs to another question`)
      }
      if (existing.status === 'completed') continue

      await completePreparedResearch(existing, recordPath, username, dependencies)
      return 1
    }

    const finding = await dependencies.researchQuestion(question, username, priorResearch, signal)
    const prepared: PreparedCuriosityResearch = {
      schemaVersion: RESEARCH_SCHEMA_VERSION,
      kind: 'curiosity-research',
      id: `curiosity-research:${question.id}`,
      status: 'prepared',
      questionId: question.id,
      question: question.question,
      questionAskedAt: question.askedAt,
      topics: finding.topics,
      sourceMemoryIds: finding.sourceMemoryIds,
      sourceResearchIds: finding.sourceResearchIds,
      summary: finding.summary,
      preparedAt: dependencies.now(),
    }
    dependencies.writeRecord(recordPath, prepared)
    await completePreparedResearch(prepared, recordPath, username, dependencies)
    return 1
  }

  return 0
}

/** Process one bounded research item for one authenticated profile. */
export async function processUserResearch(username: string, signal?: AbortSignal): Promise<number> {
  if (!SAFE_USERNAME_PATTERN.test(username)) throw new Error(`Invalid username format: ${username}`)
  const user = requireUserInfo(username)

  return withUserContext(user, async () => {
    const config = loadCuriosityConfig(username)
    if (config.researchMode === 'off') return 0
    if (config.researchMode !== 'local') {
      throw new Error(`Unsupported curiosity research mode: ${String(config.researchMode)}`)
    }

    const profilePaths = getProfilePaths(username)
    const questions = (await curiosityQuestionStore.listPending(username)).map(record => {
      if (record.status !== 'pending') {
        throw new Error(`Curiosity question store returned non-pending record ${record.id}`)
      }
      return { ...record, status: 'pending' as const }
    })
    return processResearchQueue(questions, profilePaths.curiosityResearch, username, defaultDependencies, signal)
  })
}

function optionValue(args: string[], index: number, name: string): { value: string; consumed: number } | null {
  const argument = args[index]
  if (argument === name) {
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return { value, consumed: 2 }
  }
  if (argument.startsWith(`${name}=`)) {
    const value = argument.slice(name.length + 1)
    if (!value) throw new Error(`${name} requires a value`)
    return { value, consumed: 1 }
  }
  return null
}

export function parseCuriosityResearcherArgs(
  args: string[],
  environmentUsername?: string,
): CuriosityResearcherOptions {
  const options: CuriosityResearcherOptions = {
    username: environmentUsername?.trim() || undefined,
  }

  for (let index = 0; index < args.length;) {
    const username = optionValue(args, index, '--username')
    if (username) {
      options.username = username.value
      index += username.consumed
      continue
    }
    throw new Error(`Unknown curiosity-researcher option: ${args[index]}`)
  }

  if (options.username && !SAFE_USERNAME_PATTERN.test(options.username)) {
    throw new Error(`Invalid username format: ${options.username}`)
  }
  return options
}

/** Run one bounded scheduled cycle. */
export async function runCycle(
  options: CuriosityResearcherOptions = {},
): Promise<CuriosityResearcherResult> {
  const result: CuriosityResearcherResult = {
    success: false,
    usersProcessed: 0,
    researchCompleted: 0,
    errors: [],
  }

  try {
    const normalized = parseCuriosityResearcherArgs([], options.username)
    const targetUser = getTargetUser({ username: normalized.username })
    if (!targetUser) throw new Error('No explicit or active authenticated user found')

    console.log(`${LOG_PREFIX} Processing user: ${targetUser.username}`)
    result.researchCompleted = await processUserResearch(targetUser.username, options.signal)
    result.usersProcessed = 1
    result.success = true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.errors.push(message)
    console.error(`${LOG_PREFIX} ${message}`)
  }

  return result
}

/** Agent Runtime entry point for in-process execution. */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  const structuredUsername = typeof input.options?.username === 'string'
    ? input.options.username
    : undefined
  const options = parseCuriosityResearcherArgs(
    input.args || [],
    structuredUsername || ctx.username,
  )
  options.signal = ctx.signal
  const result = await runCycle(options)

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      researchCompleted: result.researchCompleted,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    itemsProcessed: result.researchCompleted,
    durationMs: Date.now() - startedAt,
  }
}
