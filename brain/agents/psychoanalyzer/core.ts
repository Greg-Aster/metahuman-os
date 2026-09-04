import { createHash } from 'node:crypto'
import fs from 'node:fs'

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'
import {
  acquireLock,
  applyPersonaLearningProposal,
  archivePersonaCore,
  audit,
  cognitiveGraphPath,
  getFirstFailedNode,
  getTargetUser,
  loadGraphFile,
  loadPersonaCore,
  loadPsychoanalyzerConfig,
  requireGraphNodeOutput,
  runGraph,
  safeWriteJSON,
  savePersonaCore,
  scanEpisodicMemoryRecords,
  storageClient,
  validatePersonaLearningProposal,
  validatePsychoanalyzerConfig,
  withUserContext,
  type AppliedPersonaLearningChange,
  type CachedGraphEntry,
  type PersonaCore,
  type PersonaLearningApplyResult,
  type PersonaLearningProposal,
  type PsychoanalyzerConfig,
} from '@metahuman/core'

export type { PsychoanalyzerConfig }

const EXECUTION_STATE_VERSION = '1.0.0'
const INSIGHTS_VERSION = '2.0.0'
const ANALYSIS_ALGORITHM_VERSION = 'psychoanalyzer-v2'
const MAX_EXECUTION_STATE_BYTES = 2 * 1024 * 1024
const MAX_INSIGHTS_BYTES = 2 * 1024 * 1024
const MAX_RECEIPTS = 100
const PSYCHOANALYZER_GRAPH_FILE = 'psychoanalyzer.json'
const psychoanalyzerGraphCache: Record<string, CachedGraphEntry | null> = {}

export interface PsychoanalyzerMemory {
  id: string
  timestamp: string
  content: string
  type: string
  tags: string[]
}

export interface PsychoanalyzerOptions {
  username?: string
  signal?: AbortSignal
}

export interface UserPsychoanalyzerStats {
  memoriesAnalyzed: number
  confidence: number
  changesApplied: number
  changesRejected: number
  resumed?: boolean
  skipped?: boolean
  skipReason?: string
}

export interface PsychoanalyzerResult {
  success: boolean
  usersProcessed: number
  errors: string[]
  stats: Record<string, UserPsychoanalyzerStats>
}

export interface PsychoanalyzerTarget {
  userId: string
  username: string
  role: string
}

interface InsightEntry {
  timestamp: string
  type: 'addition' | 'removal' | 'update'
  category: string
  section: string
  items: string[]
  memoriesAnalyzed: number
  confidence: number
  reasoning: string
  archiveCompared?: string
  sessionId: string
}

interface InsightsFile {
  version: string
  lastUpdated: string
  entries: InsightEntry[]
}

export interface PsychoanalyzerExecutionReceipt {
  runId: string
  status: 'prepared' | 'completed'
  preparedAt: string
  updatedAt: string
  sourceInputDigest: string
  completionInputDigest: string
  sourcePersonaDigest: string
  completionPersonaDigest: string
  memoryIds: string[]
  config: PsychoanalyzerConfig
  proposal: PersonaLearningProposal
  appliedIndexes: number[]
  rejected: Array<{ index: number; reason: string }>
  archiveFilename?: string
}

export interface PsychoanalyzerExecutionState {
  version: typeof EXECUTION_STATE_VERSION
  receipts: PsychoanalyzerExecutionReceipt[]
}

export interface PsychoanalyzerExecutionDependencies {
  now: () => Date
  withContext: <T>(target: PsychoanalyzerTarget, callback: () => T | Promise<T>) => Promise<T>
  acquireRunLock: (name: string) => { release: () => void }
  loadConfig: (username: string) => Promise<PsychoanalyzerConfig>
  selectMemories: (
    username: string,
    config: PsychoanalyzerConfig,
    now: Date,
    signal?: AbortSignal,
  ) => Promise<PsychoanalyzerMemory[]>
  loadPersona: () => PersonaCore
  loadExecutionState: (username: string) => Promise<PsychoanalyzerExecutionState>
  saveExecutionState: (username: string, state: PsychoanalyzerExecutionState) => Promise<void>
  analyze: (
    memories: PsychoanalyzerMemory[],
    persona: PersonaCore,
    config: PsychoanalyzerConfig,
    signal?: AbortSignal,
  ) => Promise<PersonaLearningProposal>
  apply: (
    persona: PersonaCore,
    proposal: PersonaLearningProposal,
    config: PsychoanalyzerConfig,
    appliedAt: string,
  ) => PersonaLearningApplyResult
  archivePersona: (persona: PersonaCore, archivedAt: Date) => string
  savePersona: (persona: PersonaCore, updatedAt: Date) => void
  persistInsights: (
    receipt: PsychoanalyzerExecutionReceipt,
    applied: AppliedPersonaLearningChange[],
  ) => void | Promise<void>
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Psychoanalyzer run cancelled')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function extractUserContent(content: string): string {
  const speakerPattern = /^(User|Me|Human|Assistant|AI|Bot|System):/im
  if (!speakerPattern.test(content)) return content.trim()

  const userLines: string[] = []
  let inUserBlock = false
  for (const line of content.split('\n')) {
    if (/^(User|Me|Human):/i.test(line)) {
      inUserBlock = true
      const value = line.replace(/^(User|Me|Human):\s*/i, '').trim()
      if (value) userLines.push(value)
    } else if (/^(Assistant|AI|Bot|System):/i.test(line)) {
      inUserBlock = false
    } else if (inUserBlock && line.trim()) {
      userLines.push(line.trim())
    }
  }
  return userLines.join('\n')
}

function compareMemories(
  left: PsychoanalyzerMemory,
  right: PsychoanalyzerMemory,
  priorityTags: ReadonlySet<string>,
): number {
  const leftPriority = left.tags.some(tag => priorityTags.has(tag)) ? 1 : 0
  const rightPriority = right.tags.some(tag => priorityTags.has(tag)) ? 1 : 0
  if (leftPriority !== rightPriority) return rightPriority - leftPriority
  const timestampOrder = Date.parse(right.timestamp) - Date.parse(left.timestamp)
  return timestampOrder || left.id.localeCompare(right.id)
}

export async function loadConfig(username?: string): Promise<PsychoanalyzerConfig> {
  return loadPsychoanalyzerConfig(username)
}

export async function selectMemories(
  config: PsychoanalyzerConfig,
  options: { username?: string; now?: Date; signal?: AbortSignal } = {},
): Promise<PsychoanalyzerMemory[]> {
  const username = options.username ?? getTargetUser()?.username
  if (!username) throw new Error('No target user resolved for psychoanalyzer memory selection')

  const cutoff = (options.now ?? new Date()).getTime()
    - config.memorySelection.daysBack * 24 * 60 * 60 * 1000
  const priorityTags = new Set(config.memorySelection.priorityTags)
  const selected: PsychoanalyzerMemory[] = []
  const seenIds = new Set<string>()

  for (const outcome of scanEpisodicMemoryRecords(username)) {
    throwIfAborted(options.signal)
    if (outcome.status === 'failed') {
      throw new Error(`Cannot scan episodic memory ${outcome.relativePath}: ${outcome.error}`)
    }

    const event = outcome.record.event
    const eventType = event.type ?? 'unknown'
    if (seenIds.has(event.id)) throw new Error(`Duplicate episodic memory id: ${event.id}`)
    seenIds.add(event.id)
    if (config.memorySelection.excludeTypes.includes(eventType)) continue
    if (Date.parse(event.timestamp) < cutoff) continue

    const content = config.memorySelection.userInputOnly
      ? extractUserContent(event.content)
      : event.content.trim()
    if (!content) continue

    selected.push({
      id: event.id,
      timestamp: event.timestamp,
      content: content.slice(0, 4000),
      type: eventType,
      tags: event.tags ?? [],
    })
    selected.sort((left, right) => compareMemories(left, right, priorityTags))
    if (selected.length > config.memorySelection.maxMemories) selected.pop()
  }

  return selected
}

function learnablePersona(persona: PersonaCore): Record<string, unknown> {
  const source = persona as Record<string, any>
  return {
    personality: {
      traits: source.personality?.traits ?? {},
      communicationStyle: source.personality?.communicationStyle ?? {},
      interests: source.personality?.interests ?? [],
    },
    values: { core: source.values?.core ?? [] },
    goals: source.goals ?? {},
    context: source.context ?? {},
    decisionHeuristics: source.decisionHeuristics ?? [],
    writingStyle: { motifs: source.writingStyle?.motifs ?? [] },
  }
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function computePersonaDigest(persona: PersonaCore): string {
  return hashJson(learnablePersona(persona))
}

function analysisConfig(config: PsychoanalyzerConfig): Record<string, unknown> {
  return {
    memorySelection: config.memorySelection,
    analysis: config.analysis,
    updateStrategy: config.updateStrategy,
    reconciliation: config.reconciliation,
  }
}

function computeInputDigest(
  memories: PsychoanalyzerMemory[],
  persona: PersonaCore,
  config: PsychoanalyzerConfig,
): string {
  return hashJson({
    algorithm: ANALYSIS_ALGORITHM_VERSION,
    memories,
    persona: learnablePersona(persona),
    config: analysisConfig(config),
  })
}

export async function analyzePersonaEvidence(
  memories: PsychoanalyzerMemory[],
  persona: PersonaCore,
  config: PsychoanalyzerConfig,
  signal?: AbortSignal,
): Promise<PersonaLearningProposal> {
  throwIfAborted(signal)
  const target = getTargetUser()
  if (!target) throw new Error('Psychoanalyzer graph requires an authenticated user context')
  const loaded = await loadGraphFile(cognitiveGraphPath(PSYCHOANALYZER_GRAPH_FILE), {
    cache: psychoanalyzerGraphCache,
    cacheKey: PSYCHOANALYZER_GRAPH_FILE,
    logPrefix: '[psychoanalyzer]',
  })
  if (!loaded) throw new Error(`Psychoanalyzer graph ${PSYCHOANALYZER_GRAPH_FILE} could not be loaded`)
  const graphState = await runGraph({
    graph: loaded.graph,
    signal,
    context: {
      username: target.username,
      userId: target.userId,
      cognitiveMode: 'agent',
      psychoanalyzerInput: { memories, persona, config },
      abortSignal: signal,
    },
  })
  throwIfAborted(signal)
  if (graphState.status !== 'completed') {
    const failed = getFirstFailedNode(graphState)
    throw new Error(failed
      ? `Psychoanalyzer graph failed at ${failed.nodeId}: ${failed.error}`
      : `Psychoanalyzer graph ended with status ${graphState.status}`)
  }
  const output = requireGraphNodeOutput(graphState, 'psychoanalyzer_analysis')
  return validatePersonaLearningProposal(output.proposal, new Set(memories.map(memory => memory.id)))
}

function resolveInsightsPath(): string {
  const result = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath: 'insights.json',
  })
  if (!result.success || !result.path) throw new Error('Cannot resolve persona insights path')
  return result.path
}

function parseInsightEntry(value: unknown, index: number): InsightEntry {
  if (!isRecord(value)) throw new Error(`Persona insights entries[${index}] must be an object`)
  if (value.type !== 'addition' && value.type !== 'removal' && value.type !== 'update') {
    throw new Error(`Persona insights entries[${index}].type is invalid`)
  }
  if (!Array.isArray(value.items) || value.items.some(item => typeof item !== 'string')) {
    throw new Error(`Persona insights entries[${index}].items must be an array of strings`)
  }
  if (typeof value.memoriesAnalyzed !== 'number' || !Number.isInteger(value.memoriesAnalyzed)
    || value.memoriesAnalyzed < 0) {
    throw new Error(`Persona insights entries[${index}].memoriesAnalyzed must be a non-negative integer`)
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1) {
    throw new Error(`Persona insights entries[${index}].confidence must be between 0 and 1`)
  }
  return {
    timestamp: requireString(value.timestamp, `Persona insights entries[${index}].timestamp`),
    type: value.type,
    category: requireString(value.category, `Persona insights entries[${index}].category`),
    section: requireString(value.section, `Persona insights entries[${index}].section`),
    items: value.items as string[],
    memoriesAnalyzed: value.memoriesAnalyzed,
    confidence: value.confidence,
    reasoning: requireString(value.reasoning, `Persona insights entries[${index}].reasoning`),
    ...(value.archiveCompared === undefined
      ? {}
      : { archiveCompared: requireString(value.archiveCompared, `Persona insights entries[${index}].archiveCompared`) }),
    sessionId: requireString(value.sessionId, `Persona insights entries[${index}].sessionId`),
  }
}

function loadInsights(): InsightsFile {
  const filePath = resolveInsightsPath()
  if (!fs.existsSync(filePath)) return { version: INSIGHTS_VERSION, lastUpdated: '', entries: [] }
  if (fs.statSync(filePath).size > MAX_INSIGHTS_BYTES) {
    throw new Error(`Persona insights exceeds ${MAX_INSIGHTS_BYTES} bytes`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read persona insights: ${(error as Error).message}`)
  }
  if (!isRecord(raw) || !Array.isArray(raw.entries)) {
    throw new Error('Persona insights must be a JSON object with an entries array')
  }
  return {
    version: INSIGHTS_VERSION,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : '',
    entries: raw.entries.map(parseInsightEntry),
  }
}

function formatChangeValue(change: AppliedPersonaLearningChange): string {
  if (typeof change.value === 'string') return change.value
  return JSON.stringify(change.value)
}

function persistInsights(
  receipt: PsychoanalyzerExecutionReceipt,
  applied: AppliedPersonaLearningChange[],
): void {
  if (!receipt.config.insights.enabled || applied.length === 0) return
  const insights = loadInsights()
  const entries: InsightEntry[] = applied.map(change => ({
    timestamp: receipt.preparedAt,
    type: change.operation === 'add' ? 'addition' : change.operation === 'remove' ? 'removal' : 'update',
    category: change.path.split('.')[0],
    section: change.path,
    items: [formatChangeValue(change)],
    memoriesAnalyzed: receipt.memoryIds.length,
    confidence: receipt.proposal.confidence,
    reasoning: change.reason,
    archiveCompared: receipt.archiveFilename,
    sessionId: receipt.runId,
  }))

  safeWriteJSON(resolveInsightsPath(), {
    version: INSIGHTS_VERSION,
    lastUpdated: receipt.preparedAt,
    entries: [
      ...entries,
      ...insights.entries.filter(entry => entry.sessionId !== receipt.runId),
    ].slice(0, receipt.config.insights.maxEntries),
  } satisfies InsightsFile)
}

function executionStateRequest(username: string) {
  return {
    username,
    category: 'state' as const,
    subcategory: 'psychoanalyzer',
    relativePath: 'executions.json',
  }
}

function parseReceipt(value: unknown, index: number): PsychoanalyzerExecutionReceipt {
  if (!isRecord(value)) throw new Error(`Psychoanalyzer receipt ${index} must be an object`)
  if (value.status !== 'prepared' && value.status !== 'completed') {
    throw new Error(`Psychoanalyzer receipt ${index} has an invalid status`)
  }
  if (!Array.isArray(value.memoryIds)
    || value.memoryIds.length === 0
    || value.memoryIds.some(id => typeof id !== 'string' || id.length === 0)
    || new Set(value.memoryIds).size !== value.memoryIds.length) {
    throw new Error(`Psychoanalyzer receipt ${index} has invalid memoryIds`)
  }
  const config = validatePsychoanalyzerConfig(value.config)
  const proposal = validatePersonaLearningProposal(value.proposal, new Set(value.memoryIds as string[]))
  if (!Array.isArray(value.appliedIndexes)
    || value.appliedIndexes.some(item => !Number.isInteger(item) || (item as number) < 0 || (item as number) >= proposal.changes.length)
    || new Set(value.appliedIndexes).size !== value.appliedIndexes.length) {
    throw new Error(`Psychoanalyzer receipt ${index} has invalid appliedIndexes`)
  }
  if (!Array.isArray(value.rejected)) {
    throw new Error(`Psychoanalyzer receipt ${index} has invalid rejected outcomes`)
  }
  const rejected = value.rejected.map((item, rejectedIndex) => {
    if (!isRecord(item) || !Number.isInteger(item.index) || (item.index as number) < 0
      || (item.index as number) >= proposal.changes.length || typeof item.reason !== 'string' || item.reason.length === 0) {
      throw new Error(`Psychoanalyzer receipt ${index} rejected[${rejectedIndex}] is invalid`)
    }
    return { index: item.index as number, reason: item.reason }
  })
  const outcomeIndexes = [...value.appliedIndexes as number[], ...rejected.map(item => item.index)]
  if (new Set(outcomeIndexes).size !== outcomeIndexes.length
    || outcomeIndexes.length !== proposal.changes.length) {
    throw new Error(`Psychoanalyzer receipt ${index} does not account for every proposed change`)
  }

  return {
    runId: requireString(value.runId, `Psychoanalyzer receipt ${index}.runId`),
    status: value.status,
    preparedAt: requireString(value.preparedAt, `Psychoanalyzer receipt ${index}.preparedAt`),
    updatedAt: requireString(value.updatedAt, `Psychoanalyzer receipt ${index}.updatedAt`),
    sourceInputDigest: requireString(value.sourceInputDigest, `Psychoanalyzer receipt ${index}.sourceInputDigest`),
    completionInputDigest: requireString(value.completionInputDigest, `Psychoanalyzer receipt ${index}.completionInputDigest`),
    sourcePersonaDigest: requireString(value.sourcePersonaDigest, `Psychoanalyzer receipt ${index}.sourcePersonaDigest`),
    completionPersonaDigest: requireString(value.completionPersonaDigest, `Psychoanalyzer receipt ${index}.completionPersonaDigest`),
    memoryIds: value.memoryIds as string[],
    config,
    proposal,
    appliedIndexes: value.appliedIndexes as number[],
    rejected,
    ...(value.archiveFilename === undefined
      ? {}
      : { archiveFilename: requireString(value.archiveFilename, `Psychoanalyzer receipt ${index}.archiveFilename`) }),
  }
}

async function loadExecutionState(username: string): Promise<PsychoanalyzerExecutionState> {
  const read = await storageClient.read({ ...executionStateRequest(username), encoding: 'utf8' })
  if (!read.success) {
    if (read.error?.startsWith('File not found:')) {
      return { version: EXECUTION_STATE_VERSION, receipts: [] }
    }
    throw new Error(`Cannot read psychoanalyzer execution state: ${read.error ?? 'unknown storage error'}`)
  }
  const serialized = typeof read.data === 'string' ? read.data : read.data?.toString('utf8')
  if (serialized === undefined) throw new Error('Psychoanalyzer execution state is empty')
  if (Buffer.byteLength(serialized) > MAX_EXECUTION_STATE_BYTES) {
    throw new Error(`Psychoanalyzer execution state exceeds ${MAX_EXECUTION_STATE_BYTES} bytes`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(serialized)
  } catch (error) {
    throw new Error(`Cannot parse psychoanalyzer execution state: ${(error as Error).message}`)
  }
  if (!isRecord(raw) || raw.version !== EXECUTION_STATE_VERSION || !Array.isArray(raw.receipts)) {
    throw new Error(`Psychoanalyzer execution state must use version ${EXECUTION_STATE_VERSION}`)
  }
  if (raw.receipts.length > MAX_RECEIPTS) {
    throw new Error(`Psychoanalyzer execution state exceeds ${MAX_RECEIPTS} receipts`)
  }
  const receipts = raw.receipts.map(parseReceipt)
  if (receipts.filter(receipt => receipt.status === 'prepared').length > 1) {
    throw new Error('Psychoanalyzer execution state contains competing prepared runs')
  }
  return { version: EXECUTION_STATE_VERSION, receipts }
}

async function saveExecutionState(
  username: string,
  state: PsychoanalyzerExecutionState,
): Promise<void> {
  const prepared = state.receipts.filter(receipt => receipt.status === 'prepared')
  if (prepared.length > 1) throw new Error('Cannot persist competing psychoanalyzer prepared runs')
  const completed = state.receipts
    .filter(receipt => receipt.status === 'completed')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_RECEIPTS - prepared.length)
  let bounded: PsychoanalyzerExecutionState
  let serialized: string
  while (true) {
    bounded = {
      version: EXECUTION_STATE_VERSION,
      receipts: [...prepared, ...completed],
    }
    serialized = JSON.stringify(bounded, null, 2)
    if (Buffer.byteLength(serialized) <= MAX_EXECUTION_STATE_BYTES) break
    if (completed.length === 0) break
    completed.pop()
  }
  if (Buffer.byteLength(serialized) > MAX_EXECUTION_STATE_BYTES) {
    throw new Error(`Psychoanalyzer execution state exceeds ${MAX_EXECUTION_STATE_BYTES} bytes`)
  }
  const write = await storageClient.write({
    ...executionStateRequest(username),
    data: serialized,
    encoding: 'utf8',
  })
  if (!write.success) {
    throw new Error(`Cannot persist psychoanalyzer execution state: ${write.error ?? 'unknown storage error'}`)
  }
}

function archiveFilenameFor(timestamp: string): string {
  return `core-${timestamp.replace(/[:.]/g, '-')}.json`
}

function appliedFromReceipt(receipt: PsychoanalyzerExecutionReceipt): AppliedPersonaLearningChange[] {
  return receipt.appliedIndexes.map(index => ({ ...receipt.proposal.changes[index], index }))
}

function outcomesMatchReceipt(
  result: PersonaLearningApplyResult,
  receipt: PsychoanalyzerExecutionReceipt,
): boolean {
  return JSON.stringify(result.applied.map(change => change.index)) === JSON.stringify(receipt.appliedIndexes)
    && JSON.stringify(result.rejected) === JSON.stringify(receipt.rejected)
}

function createPreparedReceipt(
  memories: PsychoanalyzerMemory[],
  persona: PersonaCore,
  result: PersonaLearningApplyResult,
  proposal: PersonaLearningProposal,
  config: PsychoanalyzerConfig,
  preparedAt: string,
): PsychoanalyzerExecutionReceipt {
  const sourceInputDigest = computeInputDigest(memories, persona, config)
  const completionInputDigest = computeInputDigest(memories, result.persona, config)
  return {
    runId: `psych-${sourceInputDigest.slice(0, 24)}`,
    status: 'prepared',
    preparedAt,
    updatedAt: preparedAt,
    sourceInputDigest,
    completionInputDigest,
    sourcePersonaDigest: computePersonaDigest(persona),
    completionPersonaDigest: computePersonaDigest(result.persona),
    memoryIds: memories.map(memory => memory.id),
    config,
    proposal,
    appliedIndexes: result.applied.map(change => change.index),
    rejected: result.rejected,
    ...(result.applied.length > 0 ? { archiveFilename: archiveFilenameFor(preparedAt) } : {}),
  }
}

async function completePreparedReceipt(
  username: string,
  persona: PersonaCore,
  receipt: PsychoanalyzerExecutionReceipt,
  state: PsychoanalyzerExecutionState,
  dependencies: PsychoanalyzerExecutionDependencies,
  resumed: boolean,
  signal?: AbortSignal,
): Promise<UserPsychoanalyzerStats> {
  const personaDigest = computePersonaDigest(persona)
  let applied: AppliedPersonaLearningChange[]

  if (personaDigest === receipt.sourcePersonaDigest) {
    const result = dependencies.apply(
      persona,
      receipt.proposal,
      receipt.config,
      receipt.preparedAt,
    )
    if (!outcomesMatchReceipt(result, receipt)
      || computePersonaDigest(result.persona) !== receipt.completionPersonaDigest) {
      throw new Error(`Prepared psychoanalyzer run ${receipt.runId} is not deterministic`)
    }
    applied = result.applied
    throwIfAborted(signal)
    if (applied.length > 0) {
      const appliedAt = new Date(receipt.preparedAt)
      if (Number.isNaN(appliedAt.getTime())) throw new Error(`Prepared psychoanalyzer run ${receipt.runId} has an invalid timestamp`)
      const archiveFilename = dependencies.archivePersona(persona, appliedAt)
      if (archiveFilename !== receipt.archiveFilename) {
        throw new Error(`Psychoanalyzer archive name does not match prepared run ${receipt.runId}`)
      }
      throwIfAborted(signal)
      dependencies.savePersona(result.persona, appliedAt)
    }
  } else if (personaDigest === receipt.completionPersonaDigest) {
    applied = appliedFromReceipt(receipt)
  } else {
    throw new Error(
      `Prepared psychoanalyzer run ${receipt.runId} conflicts with the current persona; manual review is required`,
    )
  }

  throwIfAborted(signal)
  await dependencies.persistInsights(receipt, applied)
  throwIfAborted(signal)

  const completedAt = dependencies.now().toISOString()
  const completedReceipt: PsychoanalyzerExecutionReceipt = {
    ...receipt,
    status: 'completed',
    updatedAt: completedAt,
  }
  await dependencies.saveExecutionState(username, {
    ...state,
    receipts: state.receipts.map(candidate => candidate.runId === receipt.runId ? completedReceipt : candidate),
  })

  return {
    memoriesAnalyzed: receipt.memoryIds.length,
    confidence: receipt.proposal.confidence,
    changesApplied: receipt.appliedIndexes.length,
    changesRejected: receipt.rejected.length,
    ...(resumed ? { resumed: true } : {}),
  }
}

const productionDependencies: PsychoanalyzerExecutionDependencies = {
  now: () => new Date(),
  withContext: (target, callback) => withUserContext(target, callback),
  acquireRunLock: name => acquireLock(name, { exitOnSignal: false }),
  loadConfig,
  selectMemories: (username, config, now, signal) => selectMemories(config, { username, now, signal }),
  loadPersona: loadPersonaCore,
  loadExecutionState,
  saveExecutionState,
  analyze: analyzePersonaEvidence,
  apply: (persona, proposal, config, appliedAt) => applyPersonaLearningProposal(
    persona,
    proposal,
    config,
    { appliedAt },
  ),
  archivePersona: archivePersonaCore,
  savePersona: savePersonaCore,
  persistInsights,
}

export async function executePsychoanalysis(
  target: PsychoanalyzerTarget,
  options: Pick<PsychoanalyzerOptions, 'signal'> = {},
  dependencies: PsychoanalyzerExecutionDependencies = productionDependencies,
): Promise<UserPsychoanalyzerStats> {
  return dependencies.withContext(target, async () => {
    const lockName = `psychoanalyzer-${createHash('sha256').update(target.username).digest('hex').slice(0, 16)}`
    const lock = dependencies.acquireRunLock(lockName)
    try {
      throwIfAborted(options.signal)
      const [config, state] = await Promise.all([
        dependencies.loadConfig(target.username),
        dependencies.loadExecutionState(target.username),
      ])
      const persona = dependencies.loadPersona()
      const prepared = state.receipts.find(receipt => receipt.status === 'prepared')
      if (prepared) {
        return completePreparedReceipt(
          target.username,
          persona,
          prepared,
          state,
          dependencies,
          true,
          options.signal,
        )
      }

      if (!config.enabled) {
        return {
          memoriesAnalyzed: 0,
          confidence: 0,
          changesApplied: 0,
          changesRejected: 0,
          skipped: true,
          skipReason: 'disabled',
        }
      }

      const runStartedAt = dependencies.now()
      const memories = await dependencies.selectMemories(
        target.username,
        config,
        runStartedAt,
        options.signal,
      )
      throwIfAborted(options.signal)
      if (memories.length < config.memorySelection.minMemories) {
        return {
          memoriesAnalyzed: memories.length,
          confidence: 0,
          changesApplied: 0,
          changesRejected: 0,
          skipped: true,
          skipReason: `Insufficient memories (${memories.length}/${config.memorySelection.minMemories})`,
        }
      }

      const inputDigest = computeInputDigest(memories, persona, config)
      if (state.receipts.some(receipt => receipt.status === 'completed'
        && (receipt.sourceInputDigest === inputDigest || receipt.completionInputDigest === inputDigest))) {
        return {
          memoriesAnalyzed: memories.length,
          confidence: 0,
          changesApplied: 0,
          changesRejected: 0,
          skipped: true,
          skipReason: 'No new evidence or persona changes since the last completed review',
        }
      }

      const proposal = await dependencies.analyze(memories, persona, config, options.signal)
      throwIfAborted(options.signal)
      const preparedAt = runStartedAt.toISOString()
      const result = dependencies.apply(persona, proposal, config, preparedAt)
      const receipt = createPreparedReceipt(memories, persona, result, proposal, config, preparedAt)
      await dependencies.saveExecutionState(target.username, {
        ...state,
        receipts: [receipt, ...state.receipts],
      })
      throwIfAborted(options.signal)

      return completePreparedReceipt(
        target.username,
        persona,
        receipt,
        { ...state, receipts: [receipt, ...state.receipts] },
        dependencies,
        false,
        options.signal,
      )
    } finally {
      lock.release()
    }
  })
}

export async function runPsychoanalysis(
  username: string,
  options: Pick<PsychoanalyzerOptions, 'signal'> = {},
): Promise<UserPsychoanalyzerStats> {
  const target = getTargetUser({ username })
  if (!target) throw new Error(`Psychoanalyzer target user does not exist: ${username}`)
  return executePsychoanalysis(target, options)
}

export function parsePsychoanalyzerArgs(args: string[]): PsychoanalyzerOptions {
  const options: PsychoanalyzerOptions = {}
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--username') {
      const username = args[++index]
      if (!username || username.startsWith('--')) throw new Error('--username requires a value')
      options.username = username
      continue
    }
    throw new Error(`Unknown psychoanalyzer option: ${argument}`)
  }
  return options
}

export async function runCycle(options: PsychoanalyzerOptions = {}): Promise<PsychoanalyzerResult> {
  const result: PsychoanalyzerResult = { success: true, usersProcessed: 0, errors: [], stats: {} }
  const target = getTargetUser(options.username ? { username: options.username } : undefined)
  if (!target) {
    return { ...result, success: false, errors: ['No target user resolved for psychoanalyzer'] }
  }

  try {
    const stats = await executePsychoanalysis(target, { signal: options.signal })
    result.stats[target.username] = stats
    result.usersProcessed = 1
    audit({
      category: 'action',
      level: 'info',
      event: 'psychoanalyzer_completed',
      actor: 'psychoanalyzer',
      details: { username: target.username, ...stats },
    })
  } catch (error) {
    result.success = false
    result.errors.push(`Error processing ${target.username}: ${(error as Error).message}`)
  }
  return result
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now()
  try {
    const parsed = parsePsychoanalyzerArgs(input.args ?? [])
    const optionUsername = typeof input.options?.username === 'string' ? input.options.username : undefined
    const result = await runCycle({
      username: parsed.username ?? optionUsername ?? ctx.username,
      signal: ctx.signal,
    })
    return {
      success: result.success,
      data: { usersProcessed: result.usersProcessed, stats: result.stats },
      errors: result.errors.length > 0 ? result.errors : undefined,
      durationMs: Date.now() - startTime,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    }
  }
}
