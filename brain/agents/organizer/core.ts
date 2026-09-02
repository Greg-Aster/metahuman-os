/** Canonical finite Organizer agent orchestration. */

import {
  audit,
  cognitiveGraphPath,
  getUserByUsername,
  listFailedNodes,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
  scanEpisodicMemoryRecords,
  withUserContext,
  type CachedGraphEntry,
  type EpisodicEvent,
  type EpisodicMemoryRecord,
  type EpisodicMemoryScanOutcome,
  type GraphExecutionState,
  type SafeUser,
  type SvelteFlowGraph,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 500
const DEFAULT_MAX_BATCHES = 100
const MAX_BATCHES = 1000
const graphCache: Record<string, CachedGraphEntry | null> = {}

export interface OrganizerOptions {
  username: string;
  limit?: number;
  reprocess?: boolean;
  all?: boolean;
  maxBatches?: number;
  signal?: AbortSignal;
}

export interface ParsedOrganizerOptions {
  username?: string;
  limit?: number;
  reprocess?: boolean;
  all?: boolean;
  maxBatches?: number;
}

export type OrganizerMemoryStatus = 'updated' | 'skipped' | 'failed'

export interface OrganizerMemoryOutcome {
  relativePath: string;
  status: OrganizerMemoryStatus;
  encrypted?: boolean;
  error?: string;
}

export interface OrganizerResult {
  success: boolean;
  username: string;
  totalConsidered: number;
  totalProcessed: number;
  totalSkipped: number;
  totalFailed: number;
  userCount: 1;
  outcomes: OrganizerMemoryOutcome[];
  errors: string[];
}

interface LoadedOrganizerGraph {
  graph: SvelteFlowGraph;
  source: string;
}

export interface OrganizerDependencies {
  resolveUser(username: string): SafeUser | null;
  scanMemories(username: string): Iterable<EpisodicMemoryScanOutcome>;
  loadGraph(): Promise<LoadedOrganizerGraph>;
  executeGraph(params: {
    graph: SvelteFlowGraph;
    context: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<GraphExecutionState>;
  now(): string;
}

const defaultDependencies: OrganizerDependencies = {
  resolveUser: getUserByUsername,
  scanMemories: username => scanEpisodicMemoryRecords(username),
  async loadGraph() {
    const loaded = await loadGraphFile(cognitiveGraphPath('organizer-agent.json'), {
      cache: graphCache,
      cacheKey: 'organizer-agent',
      logPrefix: '[organizer]',
    })
    if (!loaded) throw new Error('Organizer graph is missing or invalid')
    return loaded
  },
  executeGraph: runGraph,
  now: () => new Date().toISOString(),
}

function positiveInteger(value: unknown, label: string, maximum = MAX_LIMIT): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : Number.NaN
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`)
  }
  return parsed
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

export function parseOrganizerArgs(
  args: string[],
  environmentUsername?: string,
): ParsedOrganizerOptions {
  const parsed: ParsedOrganizerOptions = {}

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--reprocess') {
      parsed.reprocess = true
      continue
    }
    if (argument === '--all') {
      parsed.all = true
      continue
    }
    if (argument === '--limit') {
      parsed.limit = positiveInteger(requiredValue(args, index, argument), 'Organizer limit')
      index += 1
      continue
    }
    if (argument.startsWith('--limit=')) {
      parsed.limit = positiveInteger(argument.slice('--limit='.length), 'Organizer limit')
      continue
    }
    if (argument === '--max-batches') {
      parsed.maxBatches = positiveInteger(requiredValue(args, index, argument), 'Organizer max batches', MAX_BATCHES)
      index += 1
      continue
    }
    if (argument.startsWith('--max-batches=')) {
      parsed.maxBatches = positiveInteger(argument.slice('--max-batches='.length), 'Organizer max batches', MAX_BATCHES)
      continue
    }
    if (argument === '--username') {
      parsed.username = requiredValue(args, index, argument).trim()
      index += 1
      continue
    }
    if (argument.startsWith('--username=')) {
      parsed.username = argument.slice('--username='.length).trim()
      if (!parsed.username) throw new Error('--username requires a value')
      continue
    }
    throw new Error(`Unknown Organizer argument: ${argument}`)
  }

  const triggeredUsername = environmentUsername?.trim()
  if (triggeredUsername && parsed.username && triggeredUsername !== parsed.username) {
    throw new Error('Organizer username conflicts with the triggering user')
  }
  if (triggeredUsername) parsed.username = triggeredUsername
  return parsed
}

export function normalizeOrganizerOptions(options: OrganizerOptions): Required<
  Pick<OrganizerOptions, 'username' | 'limit' | 'reprocess' | 'all' | 'maxBatches'>
> & Pick<OrganizerOptions, 'signal'> {
  const username = options.username?.trim()
  if (!username) throw new Error('Organizer requires a resolved username')
  if (typeof options.reprocess !== 'undefined' && typeof options.reprocess !== 'boolean') {
    throw new Error('Organizer reprocess must be a boolean')
  }
  if (options.all === true && options.reprocess === true) {
    throw new Error('Organizer cannot combine --all with --reprocess')
  }
  return {
    username,
    limit: typeof options.limit === 'undefined'
      ? DEFAULT_LIMIT
      : positiveInteger(options.limit, 'Organizer limit'),
    reprocess: options.reprocess === true,
    all: options.all === true,
    maxBatches: typeof options.maxBatches === 'undefined'
      ? DEFAULT_MAX_BATCHES
      : positiveInteger(options.maxBatches, 'Organizer max batches', MAX_BATCHES),
    signal: options.signal,
  }
}

function needsEnrichment(event: EpisodicEvent, reprocess: boolean): boolean {
  if (reprocess) return true
  return event.metadata?.processed !== true
}

function cancellationError(): DOMException {
  return new DOMException('Organizer execution cancelled', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError()
}

function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function memoryContext(record: EpisodicMemoryRecord): Record<string, unknown> {
  return {
    ...record.event,
    relativePath: record.relativePath,
    encrypted: record.encrypted,
  }
}

async function executeMemory(
  graph: SvelteFlowGraph,
  user: SafeUser,
  record: EpisodicMemoryRecord,
  options: ReturnType<typeof normalizeOrganizerOptions>,
  dependencies: OrganizerDependencies,
): Promise<OrganizerMemoryOutcome> {
  throwIfAborted(options.signal)
  const graphState = await dependencies.executeGraph({
    graph,
    context: {
      username: user.username,
      userId: user.id,
      cognitiveMode: 'agent',
      environment: 'server',
      organizerMemory: memoryContext(record),
      organizerReprocess: options.reprocess,
      organizerTimestamp: dependencies.now(),
      abortSignal: options.signal,
    },
    signal: options.signal,
  })
  throwIfAborted(options.signal)

  const failedNodes = listFailedNodes(graphState)
  if (graphState.status !== 'completed' || failedNodes.length > 0) {
    const details = failedNodes.map(node => `${node.nodeId}: ${node.error}`).join('; ')
    throw new Error(details || `Organizer graph ended with status ${graphState.status}`)
  }

  const saved = requireGraphNodeOutput(graphState, 'memory_saver')
  if (saved.success !== true || saved.relativePath !== record.relativePath) {
    throw new Error(`Organizer graph did not persist the selected memory: ${record.relativePath}`)
  }
  if (saved.outcome !== 'updated' && saved.outcome !== 'skipped') {
    throw new Error(`Organizer graph returned an invalid outcome for ${record.relativePath}`)
  }
  return {
    relativePath: record.relativePath,
    status: saved.outcome,
    encrypted: saved.encrypted === true,
  }
}

export async function runOrganizer(
  input: OrganizerOptions,
  dependencies: OrganizerDependencies = defaultDependencies,
): Promise<OrganizerResult> {
  const options = normalizeOrganizerOptions(input)
  const user = dependencies.resolveUser(options.username)
  if (!user || user.username !== options.username) {
    throw new Error(`Organizer user does not exist: ${options.username}`)
  }

  const result: OrganizerResult = {
    success: false,
    username: user.username,
    totalConsidered: 0,
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    userCount: 1,
    outcomes: [],
    errors: [],
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'organizer', username: user.username, limit: options.limit },
    actor: 'agent',
  })

  try {
    await withUserContext(
      { userId: user.id, username: user.username, role: user.role },
      async () => {
        const loaded = await dependencies.loadGraph()
        const selected: EpisodicMemoryRecord[] = []

        for (const outcome of dependencies.scanMemories(user.username)) {
          throwIfAborted(options.signal)
          if (outcome.status === 'failed') {
            result.outcomes.push({
              relativePath: outcome.relativePath,
              status: 'failed',
              error: outcome.error,
            })
            result.errors.push(`${outcome.relativePath}: ${outcome.error}`)
            continue
          }
          if (!needsEnrichment(outcome.record.event, options.reprocess)) continue
          selected.push(outcome.record)
          if (selected.length >= options.limit) break
        }

        result.totalConsidered = selected.length
        for (const record of selected) {
          try {
            result.outcomes.push(await executeMemory(
              loaded.graph,
              user,
              record,
              options,
              dependencies,
            ))
          } catch (error) {
            if (isCancellation(error)) throw error
            const message = (error as Error).message
            result.outcomes.push({
              relativePath: record.relativePath,
              status: 'failed',
              encrypted: record.encrypted,
              error: message,
            })
            result.errors.push(`${record.relativePath}: ${message}`)
          }
        }
      },
    )
  } catch (error) {
    if (isCancellation(error)) throw error
    const message = (error as Error).message
    result.errors.push(message)
  }

  result.totalProcessed = result.outcomes.filter(outcome => outcome.status === 'updated').length
  result.totalSkipped = result.outcomes.filter(outcome => outcome.status === 'skipped').length
  result.totalFailed = result.outcomes.filter(outcome => outcome.status === 'failed').length
  result.success = result.errors.length === 0

  audit({
    level: result.success ? 'info' : 'error',
    category: 'action',
    event: result.success ? 'agent_cycle_completed' : 'agent_cycle_failed',
    details: {
      agent: 'organizer',
      username: user.username,
      graph: 'organizer-agent.json',
      considered: result.totalConsidered,
      updated: result.totalProcessed,
      skipped: result.totalSkipped,
      failed: result.totalFailed,
    },
    actor: 'agent',
  })
  return result
}

/** Drain bounded Organizer batches without moving selection or persistence into the caller. */
export async function runOrganizerToCompletion(
  input: OrganizerOptions,
  dependencies: OrganizerDependencies = defaultDependencies,
): Promise<OrganizerResult> {
  const options = normalizeOrganizerOptions({ ...input, all: true })
  const total: OrganizerResult = {
    success: true,
    username: options.username,
    totalConsidered: 0,
    totalProcessed: 0,
    totalSkipped: 0,
    totalFailed: 0,
    userCount: 1,
    outcomes: [],
    errors: [],
  }

  for (let batchNumber = 0; batchNumber < options.maxBatches; batchNumber += 1) {
    throwIfAborted(options.signal)
    const batch = await runOrganizer({
      username: options.username,
      limit: options.limit,
      reprocess: options.reprocess,
      signal: options.signal,
    }, dependencies)
    total.totalConsidered += batch.totalConsidered
    total.totalProcessed += batch.totalProcessed
    total.totalSkipped += batch.totalSkipped
    total.totalFailed += batch.totalFailed
    total.outcomes.push(...batch.outcomes)
    total.errors.push(...batch.errors)

    if (!batch.success) {
      total.success = false
      return total
    }
    if (batch.totalConsidered < options.limit) return total
    if (batch.totalProcessed + batch.totalSkipped === 0) {
      total.success = false
      total.errors.push('Organizer made no progress while unprocessed memories remained')
      return total
    }
  }

  total.success = false
  total.errors.push(`Organizer reached the ${options.maxBatches}-batch safety limit while memories remained`)
  return total
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseOrganizerArgs(input.args ?? [], ctx.username)
    const optionUsername = input.options?.username
    if (typeof optionUsername !== 'undefined' && optionUsername !== ctx.username) {
      throw new Error('Organizer structured username conflicts with the triggering user')
    }
    const limit = typeof input.options?.limit === 'undefined'
      ? parsed.limit
      : positiveInteger(input.options.limit, 'Organizer limit')
    const reprocess = typeof input.options?.reprocess === 'undefined'
      ? parsed.reprocess
      : input.options.reprocess
    if (typeof reprocess !== 'undefined' && typeof reprocess !== 'boolean') {
      throw new Error('Organizer reprocess must be a boolean')
    }

    const all = typeof input.options?.all === 'undefined'
      ? parsed.all
      : input.options.all
    if (typeof all !== 'undefined' && typeof all !== 'boolean') {
      throw new Error('Organizer all must be a boolean')
    }
    const maxBatches = typeof input.options?.maxBatches === 'undefined'
      ? parsed.maxBatches
      : positiveInteger(input.options.maxBatches, 'Organizer max batches', MAX_BATCHES)
    const execute = all ? runOrganizerToCompletion : runOrganizer
    const result = await execute({
      username: ctx.username,
      limit,
      reprocess,
      all,
      maxBatches,
      signal: ctx.signal,
    })
    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startedAt,
      itemsProcessed: result.totalProcessed + result.totalSkipped,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startedAt,
    }
  }
}
