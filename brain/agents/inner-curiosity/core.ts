/** Canonical graph runner for private, self-directed curiosity Q&A. */

import { randomUUID } from 'node:crypto'
import {
  audit,
  cognitiveGraphPath,
  getFirstFailedNode,
  getTargetUser,
  getUserContext,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
  withUserContext,
  type CachedGraphEntry,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

const LOG_PREFIX = '[inner-curiosity]'
const GRAPH_FILE = 'inner-curiosity.json'
const MAX_EXECUTION_ID_CHARS = 400
const GRAPH_CACHE: Record<string, CachedGraphEntry | null> = {}

export type InnerCuriositySkipReason = 'disabled' | 'no-memories'

export interface InnerCuriosityFollowOnOutcome {
  admitted: boolean
  skipped: boolean
  reason?: string
  taskId?: string
  probability?: number
  roll?: number
}

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
    followOn?: InnerCuriosityFollowOnOutcome
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

interface LoadedInnerCuriosityGraph {
  graph: SvelteFlowGraph
  source: string
}

export interface InnerCuriosityDependencies {
  loadGraph: () => Promise<LoadedInnerCuriosityGraph | null>
  executeGraph: typeof runGraph
  resolveUserId: (username: string) => string
  now: () => Date
  newExecutionId: () => string
}

const DEFAULT_DEPENDENCIES: InnerCuriosityDependencies = {
  loadGraph: () => loadGraphFile(cognitiveGraphPath(GRAPH_FILE), {
    cache: GRAPH_CACHE,
    cacheKey: GRAPH_FILE,
    logPrefix: LOG_PREFIX,
  }),
  executeGraph: runGraph,
  resolveUserId: username => {
    const context = getUserContext()
    if (!context || (context.username !== username && context.activeProfile !== username)) {
      throw new Error(`Inner Curiosity has no authenticated context for profile ${username}`)
    }
    return requiredString(context.userId, 'Inner Curiosity authenticated userId')
  },
  now: () => new Date(),
  newExecutionId: randomUUID,
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('Inner Curiosity execution cancelled', 'AbortError')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requiredString(value: unknown, label: string, maximum = Number.POSITIVE_INFINITY): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must not be empty`)
  const text = value.trim()
  if (text.length > maximum) throw new Error(`${label} must not exceed ${maximum} characters`)
  return text
}

function validTimestamp(value: unknown, label: string): string {
  const text = requiredString(value, label)
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a valid date`)
  return new Date(text).toISOString()
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return Number(value)
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function parseFollowOn(value: unknown): InnerCuriosityFollowOnOutcome | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Inner Curiosity graph returned an invalid follow-on result')
  }
  const record = value as Record<string, unknown>
  if (typeof record.admitted !== 'boolean' || typeof record.skipped !== 'boolean') {
    throw new Error('Inner Curiosity graph returned an incomplete follow-on decision')
  }
  if (record.admitted === record.skipped) {
    throw new Error('Inner Curiosity graph returned a contradictory follow-on decision')
  }
  const probability = optionalFiniteNumber(record.probability, 'Inner Curiosity follow-on probability')
  const roll = optionalFiniteNumber(record.roll, 'Inner Curiosity follow-on roll')
  return {
    admitted: record.admitted,
    skipped: record.skipped,
    ...(typeof record.reason === 'string' && record.reason.trim() ? { reason: record.reason.trim() } : {}),
    ...(typeof record.taskId === 'string' && record.taskId.trim() ? { taskId: record.taskId.trim() } : {}),
    ...(probability !== undefined ? { probability } : {}),
    ...(roll !== undefined ? { roll } : {}),
  }
}

function parseOutcome(value: unknown): InnerCuriosityOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Inner Curiosity graph returned no typed outcome')
  }
  const record = value as Record<string, unknown>
  const username = requiredString(record.username, 'Inner Curiosity outcome username')
  const executionId = requiredString(
    record.executionId,
    'Inner Curiosity outcome executionId',
    MAX_EXECUTION_ID_CHARS,
  )
  if (record.status === 'skipped') {
    if (record.reason !== 'disabled' && record.reason !== 'no-memories') {
      throw new Error(`Inner Curiosity graph returned an invalid skip reason: ${String(record.reason)}`)
    }
    return { status: 'skipped', username, executionId, reason: record.reason }
  }
  if (record.status !== 'generated' || typeof record.deduplicated !== 'boolean') {
    throw new Error(`Inner Curiosity graph returned an invalid status: ${String(record.status)}`)
  }
  return {
    status: 'generated',
    username,
    executionId,
    deduplicated: record.deduplicated,
    memoriesConsidered: nonNegativeInteger(record.memoriesConsidered, 'Inner Curiosity memoriesConsidered'),
    searchResults: nonNegativeInteger(record.searchResults, 'Inner Curiosity searchResults'),
    ...(record.followOn !== undefined ? { followOn: parseFollowOn(record.followOn) } : {}),
  }
}

function completedNodeOutput(
  graphState: GraphExecutionState,
  nodeType: string,
): Record<string, unknown> | null {
  const matches = [...graphState.nodes.values()].filter(node => node.definition?.type === nodeType)
  if (matches.length !== 1) {
    throw new Error(`Inner Curiosity graph requires exactly one ${nodeType} node; found ${matches.length}`)
  }
  const [match] = matches
  if (match.status === 'skipped') return null
  if (match.status !== 'completed' || !match.outputs) {
    throw new Error(`Inner Curiosity graph node ${nodeType} ended with status ${match.status}`)
  }
  return match.outputs
}

function evaluateGraphOutcome(graphState: GraphExecutionState): InnerCuriosityOutcome {
  if (graphState.status !== 'completed') {
    const failure = getFirstFailedNode(graphState)
    throw new Error(
      failure
        ? `Inner Curiosity graph failed at node ${failure.nodeId}: ${failure.error}`
        : `Inner Curiosity graph ended with status ${graphState.status}`,
    )
  }

  const state = requireGraphNodeOutput(graphState, 'inner_curiosity_state')
  if (state.outcome !== undefined) return parseOutcome(state.outcome)

  const noMemories = completedNodeOutput(graphState, 'inner_curiosity_no_memories')
  if (noMemories) return parseOutcome(noMemories.outcome)

  return parseOutcome(requireGraphNodeOutput(graphState, 'inner_curiosity_complete').outcome)
}

/**
 * Execute one already-authenticated profile cycle through the sole maintained
 * Inner Curiosity graph. Exported for focused contract tests.
 */
export async function executeInnerCuriosityForUser(
  username: string,
  options: InnerCuriosityOptions = {},
  dependencies: InnerCuriosityDependencies = DEFAULT_DEPENDENCIES,
): Promise<InnerCuriosityOutcome> {
  throwIfAborted(options.signal)
  const resolvedUsername = requiredString(username, 'Inner Curiosity username')
  const userId = dependencies.resolveUserId(resolvedUsername)
  const executionId = requiredString(
    options.executionId || dependencies.newExecutionId(),
    'Inner Curiosity executionId',
    MAX_EXECUTION_ID_CHARS,
  )
  const requestedExecutionTimestamp = options.executionTimestamp
    ? validTimestamp(options.executionTimestamp, 'Inner Curiosity executionTimestamp')
    : undefined
  const executionTimestamp = requestedExecutionTimestamp || dependencies.now().toISOString()
  const loaded = await dependencies.loadGraph()
  if (!loaded) throw new Error(`Inner Curiosity graph ${GRAPH_FILE} could not be loaded`)

  const graphState = await dependencies.executeGraph({
    graph: loaded.graph,
    signal: options.signal,
    context: {
      userId,
      username: resolvedUsername,
      cognitiveMode: 'agent',
      recordPersonaMemory: true,
      allowMemoryWrites: true,
      executionId,
      executionTimestamp,
      requestedExecutionTimestamp,
      idempotencyKey: `inner-curiosity:${resolvedUsername}:${executionId}`,
      abortSignal: options.signal,
    },
  })
  throwIfAborted(options.signal)
  return evaluateGraphOutcome(graphState)
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

/** Run one bounded scheduled or manual graph cycle. */
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
