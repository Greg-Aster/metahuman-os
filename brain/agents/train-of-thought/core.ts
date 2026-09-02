/** Canonical finite owner for seeded associative thought-chain execution. */

import { randomUUID } from 'node:crypto'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'
import {
  audit,
  cognitiveGraphPath,
  getFirstFailedNode,
  getTargetUser,
  loadGraphFile,
  runGraph,
  sampleCuriosityMemories,
  withUserContext,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core'

const MAX_EXECUTION_ID_CHARS = 400
const MAX_SEED_CHARS = 12_000
const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface TrainOfThoughtOptions {
  username?: string
  seed?: string
  sourceAgent?: string
  executionId?: string
  executionTimestamp?: string
  signal?: AbortSignal
}

interface TrainOfThoughtSummary {
  username: string
  executionId: string
  seedSource: 'supplied' | 'memory'
  sourceAgent?: string
}

export type TrainOfThoughtGeneratedOutcome = TrainOfThoughtSummary & {
    status: 'generated'
    thoughtCount: number
    insight: string
    chain: string
    eventId: string
    eventPath: string
  }

export type TrainOfThoughtOutcome =
  | TrainOfThoughtGeneratedOutcome
  | TrainOfThoughtSummary & {
    status: 'skipped'
    reason: 'no-memories'
  }

interface TargetUser {
  userId: string
  username: string
  role: string
}

export interface TrainOfThoughtDependencies {
  resolveTargetUser: (options?: { username?: string }) => TargetUser | null
  sampleSeed: (username: string) => Promise<string | null>
  loadGraph: () => Promise<SvelteFlowGraph>
  executeGraph: typeof runGraph
  runWithUserContext: typeof withUserContext
  newExecutionId: () => string
  now: () => string
}

const DEFAULT_DEPENDENCIES: TrainOfThoughtDependencies = {
  resolveTargetUser: getTargetUser,
  sampleSeed: async username => {
    const sample = await sampleCuriosityMemories({ username, sampleSize: 1 })
    return sample.memories[0]?.content?.trim() || null
  },
  loadGraph: async () => {
    const loaded = await loadGraphFile(cognitiveGraphPath('train-of-thought.json'), {
      logPrefix: '[train-of-thought]',
    })
    if (!loaded) throw new Error('Train of Thought graph could not be loaded')
    return loaded.graph
  },
  executeGraph: runGraph,
  runWithUserContext: withUserContext,
  newExecutionId: randomUUID,
  now: () => new Date().toISOString(),
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Train of Thought execution cancelled', 'AbortError')
}

function validateExecutionId(value: string): string {
  const executionId = value.trim()
  if (!executionId) throw new Error('Train of Thought executionId must not be empty')
  if (executionId.length > MAX_EXECUTION_ID_CHARS) {
    throw new Error(`Train of Thought executionId must not exceed ${MAX_EXECUTION_ID_CHARS} characters`)
  }
  return executionId
}

function validateTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('Train of Thought executionTimestamp must be a valid date')
  }
  return new Date(value).toISOString()
}

function validateSeed(value: string | undefined): string | undefined {
  const seed = value?.trim()
  if (!seed) return undefined
  if (seed.length > MAX_SEED_CHARS) {
    throw new Error(`Train of Thought seed must not exceed ${MAX_SEED_CHARS} characters`)
  }
  return seed
}

function validateSourceAgent(value: string | undefined): string | undefined {
  const sourceAgent = value?.trim()
  if (!sourceAgent) return undefined
  if (!AGENT_ID_PATTERN.test(sourceAgent)) {
    throw new Error('Train of Thought sourceAgent must be kebab-case')
  }
  return sourceAgent
}

function graphNodeOutputs(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  nodeType: string,
): Record<string, any> {
  const matches = graph.nodes.filter(node => node.data.nodeType === nodeType)
  if (matches.length !== 1) {
    throw new Error(`Train of Thought graph requires exactly one ${nodeType} node (found ${matches.length})`)
  }
  const state = graphResult.nodes.get(matches[0].id)
  if (!state) throw new Error(`Train of Thought graph did not execute ${nodeType}`)
  if (state.status !== 'completed') {
    throw new Error(`Train of Thought node ${nodeType} ended with status ${state.status}`)
  }
  if (!state.outputs) throw new Error(`Train of Thought node ${nodeType} produced no outputs`)
  return state.outputs
}

export function evaluateTrainOfThoughtGraph(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  summary: TrainOfThoughtSummary,
): TrainOfThoughtGeneratedOutcome {
  if (graphResult.status !== 'completed') {
    const failure = getFirstFailedNode(graphResult)
    throw new Error(
      failure
        ? `Train of Thought graph failed at node ${failure.nodeId}: ${failure.error}`
        : 'Train of Thought graph did not complete',
    )
  }

  const aggregation = graphNodeOutputs(graph, graphResult, 'thought_aggregator')
  const thoughtCount = Number(aggregation.thoughtCount)
  const insight = typeof aggregation.insight === 'string' ? aggregation.insight.trim() : ''
  const chain = typeof aggregation.result === 'string' ? aggregation.result.trim() : ''
  if (!Number.isInteger(thoughtCount) || thoughtCount < 1 || !insight || !chain) {
    throw new Error('Train of Thought aggregation produced an incomplete result')
  }

  const persistence = graphNodeOutputs(graph, graphResult, 'inner_dialogue_buffer')
  if (persistence.saved !== true || persistence.persisted !== true) {
    throw new Error(
      `Train of Thought persistence failed: ${persistence.error || persistence.reason || 'no durable output'}`,
    )
  }
  const eventId = typeof persistence.eventId === 'string' ? persistence.eventId.trim() : ''
  const eventPath = typeof persistence.eventPath === 'string' ? persistence.eventPath.trim() : ''
  if (!eventId || !eventPath) {
    throw new Error('Train of Thought persistence did not confirm long-term memory capture')
  }

  return {
    ...summary,
    status: 'generated',
    thoughtCount,
    insight,
    chain,
    eventId,
    eventPath,
  }
}

/** Execute exactly one authenticated, profile-scoped associative thought chain. */
export async function runTrainOfThought(
  options: TrainOfThoughtOptions = {},
  dependencyOverrides: Partial<TrainOfThoughtDependencies> = {},
): Promise<TrainOfThoughtOutcome> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  throwIfAborted(options.signal)
  const targetUser = dependencies.resolveTargetUser(
    options.username ? { username: options.username } : undefined,
  )
  if (!targetUser) throw new Error('No authenticated target user resolved for Train of Thought')

  const executionId = validateExecutionId(options.executionId || dependencies.newExecutionId())
  const executionTimestamp = validateTimestamp(options.executionTimestamp || dependencies.now())
  const sourceAgent = validateSourceAgent(options.sourceAgent)
  const suppliedSeed = validateSeed(options.seed)
  const seed = suppliedSeed || await dependencies.sampleSeed(targetUser.username)
  throwIfAborted(options.signal)

  const summary: TrainOfThoughtSummary = {
    username: targetUser.username,
    executionId,
    seedSource: suppliedSeed ? 'supplied' : 'memory',
    sourceAgent,
  }
  if (!seed) {
    const outcome: TrainOfThoughtOutcome = { ...summary, status: 'skipped', reason: 'no-memories' }
    audit({
      category: 'action',
      level: 'info',
      event: 'train_of_thought_skipped',
      actor: 'train-of-thought',
      details: outcome,
    })
    return outcome
  }

  const idempotencyKey = `train-of-thought:${targetUser.username}:${executionId}`
  audit({
    category: 'action',
    level: 'info',
    event: 'train_of_thought_started',
    actor: 'train-of-thought',
    details: { ...summary },
  })

  try {
    const graph = await dependencies.loadGraph()
    throwIfAborted(options.signal)
    const graphResult = await dependencies.runWithUserContext(
      targetUser,
      () => dependencies.executeGraph({
        graph,
        signal: options.signal,
        context: {
          userId: targetUser.userId,
          username: targetUser.username,
          allowMemoryWrites: true,
          cognitiveMode: 'agent' as const,
          seedMemory: seed,
          sourceAgent,
          idempotencyKey,
          executionId,
          memoryTimestamp: executionTimestamp,
          abortSignal: options.signal,
        },
      }),
    )
    throwIfAborted(options.signal)
    const outcome = evaluateTrainOfThoughtGraph(graph, graphResult, summary)
    audit({
      category: 'action',
      level: 'info',
      event: 'train_of_thought_complete',
      actor: 'train-of-thought',
      details: {
        username: outcome.username,
        executionId: outcome.executionId,
        thoughtCount: outcome.thoughtCount,
        seedSource: outcome.seedSource,
        sourceAgent: outcome.sourceAgent,
      },
    })
    return outcome
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'train_of_thought_failed',
      actor: 'train-of-thought',
      details: {
        username: targetUser.username,
        executionId,
        sourceAgent,
        error: (error as Error).message,
      },
    })
    throw error
  }
}

function parseTaskPayload(environment: NodeJS.ProcessEnv): Record<string, unknown> {
  const raw = environment.MH_TASK_PAYLOAD?.trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('MH_TASK_PAYLOAD must contain valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MH_TASK_PAYLOAD must contain an object')
  }
  return parsed as Record<string, unknown>
}

export function parseTrainOfThoughtArgs(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): TrainOfThoughtOptions {
  const payload = parseTaskPayload(environment)
  const options: TrainOfThoughtOptions = {
    username: environment.MH_TRIGGER_USERNAME?.trim() || undefined,
    executionId: typeof payload.executionId === 'string' && payload.executionId.trim()
      ? payload.executionId.trim()
      : environment.MH_TASK_ID?.trim() || undefined,
    executionTimestamp: environment.MH_TASK_CREATED_AT?.trim() || undefined,
    seed: typeof payload.seed === 'string' ? payload.seed : undefined,
    sourceAgent: typeof payload.sourceAgent === 'string' ? payload.sourceAgent : undefined,
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const readValue = (label: string): string => {
      const value = args[index + 1]?.trim()
      if (!value) throw new Error(`${label} requires a value`)
      index += 1
      return value
    }
    if (argument === '--username') options.username = readValue('--username')
    else if (argument === '--seed') options.seed = readValue('--seed')
    else if (argument === '--source-agent') options.sourceAgent = readValue('--source-agent')
    else throw new Error(`Unknown train-of-thought option: ${argument}`)
  }
  options.seed = validateSeed(options.seed)
  options.sourceAgent = validateSourceAgent(options.sourceAgent)
  return options
}

/** Agent Runtime adapter; all durable behavior remains in runTrainOfThought(). */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseTrainOfThoughtArgs(input.args || [], {})
    const allowedOptions = new Set(['username', 'seed', 'sourceAgent', 'executionId', 'executionTimestamp'])
    const unknownOption = Object.keys(input.options || {}).find(key => !allowedOptions.has(key))
    if (unknownOption) throw new Error(`Unknown train-of-thought option: ${unknownOption}`)
    const structured = input.options || {}
    const outcome = await runTrainOfThought({
      ...parsed,
      username: typeof structured.username === 'string'
        ? structured.username
        : parsed.username || ctx.username,
      seed: typeof structured.seed === 'string' ? structured.seed : parsed.seed,
      sourceAgent: typeof structured.sourceAgent === 'string'
        ? structured.sourceAgent
        : parsed.sourceAgent,
      executionId: typeof structured.executionId === 'string'
        ? structured.executionId
        : parsed.executionId,
      executionTimestamp: typeof structured.executionTimestamp === 'string'
        ? structured.executionTimestamp
        : parsed.executionTimestamp,
      signal: ctx.signal,
    })
    return {
      success: true,
      data: outcome,
      durationMs: Date.now() - startedAt,
      itemsProcessed: outcome.status === 'generated' ? 1 : 0,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startedAt,
      itemsProcessed: 0,
    }
  }
}
