/**
 * Reflector Agent — finite graph execution adapter.
 *
 * Trigger Manager and Operator Policy own admission. The editable Reflector
 * graph owns persona loading, memory selection, prompt construction, model
 * generation, persistence, audit output, and optional TTS output.
 */

import { randomUUID } from 'node:crypto'
import {
  audit,
  cognitiveGraphPath,
  getFirstFailedNode,
  getTargetUser,
  loadGraphFile,
  runGraph,
  withUserContext,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

const MAX_EXECUTION_ID_CHARS = 400

export interface ReflectorOptions {
  username?: string
  executionId?: string
  executionTimestamp?: string
  signal?: AbortSignal
}

interface ReflectorSummary {
  username: string
  executionId: string
  memoriesConsidered: number
  candidatesConsidered: number
  scanFailures: number
}

export type ReflectorOutcome =
  | ReflectorSummary & {
    status: 'generated'
    reflection: string
    eventId: string
    eventPath: string
    ttsQueued: boolean
  }
  | ReflectorSummary & {
    status: 'skipped'
    reason: 'insufficient-memories' | 'persona-unavailable'
  }

interface TargetUser {
  userId: string
  username: string
  role: string
}

export interface ReflectorDependencies {
  resolveTargetUser: (options?: { username?: string }) => TargetUser | null
  loadGraph: () => Promise<SvelteFlowGraph>
  executeGraph: typeof runGraph
  runWithUserContext: typeof withUserContext
  newExecutionId: () => string
  now: () => string
}

const defaultDependencies: ReflectorDependencies = {
  resolveTargetUser: getTargetUser,
  loadGraph: async () => {
    const loaded = await loadGraphFile(cognitiveGraphPath('reflector-mode.json'), {
      logPrefix: '[reflector]',
    })
    if (!loaded) throw new Error('Reflector graph could not be loaded')
    return loaded.graph
  },
  executeGraph: runGraph,
  runWithUserContext: withUserContext,
  newExecutionId: randomUUID,
  now: () => new Date().toISOString(),
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Reflector execution cancelled', 'AbortError')
}

function validateExecutionId(value: string): string {
  const executionId = value.trim()
  if (!executionId) throw new Error('Reflector executionId must not be empty')
  if (executionId.length > MAX_EXECUTION_ID_CHARS) {
    throw new Error(`Reflector executionId must not exceed ${MAX_EXECUTION_ID_CHARS} characters`)
  }
  return executionId
}

function validateTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('Reflector executionTimestamp must be a valid date')
  }
  return new Date(value).toISOString()
}

function graphNodeOutputs(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  nodeType: string,
  matchesNode: (node: SvelteFlowGraph['nodes'][number]) => boolean = () => true,
): Record<string, any> {
  const matches = graph.nodes.filter(
    node => node.data.nodeType === nodeType && matchesNode(node),
  )
  if (matches.length !== 1) {
    throw new Error(`Reflector graph requires exactly one matching ${nodeType} node (found ${matches.length})`)
  }
  const state = graphResult.nodes.get(matches[0].id)
  if (!state) throw new Error(`Reflector graph did not execute ${nodeType}`)
  if (state.status !== 'completed') {
    throw new Error(`Reflector node ${nodeType} ended with status ${state.status}`)
  }
  if (!state.outputs) throw new Error(`Reflector node ${nodeType} produced no outputs`)
  return state.outputs
}

export function evaluateReflectorGraph(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  identity: { username: string; executionId: string },
): ReflectorOutcome {
  if (graphResult.status !== 'completed') {
    const failure = getFirstFailedNode(graphResult)
    throw new Error(
      failure
        ? `Reflector graph failed at node ${failure.nodeId}: ${failure.error}`
        : 'Reflector graph did not complete',
    )
  }

  const memory = graphNodeOutputs(graph, graphResult, 'reflection_memory_sampler')
  if (memory.error) throw new Error(`Reflection memory sampling failed: ${memory.error}`)
  const memoriesConsidered = Number(memory.count) || 0
  const candidatesConsidered = Number(memory.candidateCount) || 0
  const scanFailures = Number(memory.failedCount) || 0
  const summary: ReflectorSummary = {
    ...identity,
    memoriesConsidered,
    candidatesConsidered,
    scanFailures,
  }

  if (memory.ready !== true || memoriesConsidered < 2) {
    return { ...summary, status: 'skipped', reason: 'insufficient-memories' }
  }

  const prompt = graphNodeOutputs(graph, graphResult, 'reflection_prompt')
  if (prompt.ready !== true) {
    const reason = typeof prompt.error === 'string' ? prompt.error : 'prompt was not ready'
    if (prompt.personaApplied !== true || /persona/i.test(reason)) {
      return { ...summary, status: 'skipped', reason: 'persona-unavailable' }
    }
    throw new Error(`Reflection prompt failed: ${reason}`)
  }

  const model = graphNodeOutputs(graph, graphResult, 'reflector_llm')
  if (model.error) throw new Error(`Reflection generation failed: ${model.error}`)

  const persistence = graphNodeOutputs(
    graph,
    graphResult,
    'inner_dialogue_buffer',
    node => node.data.properties?.role === 'reflection',
  )
  const reflection = typeof persistence.text === 'string' ? persistence.text.trim() : ''
  if (!persistence.saved || !persistence.persisted || !reflection) {
    throw new Error(
      `Reflection persistence failed: ${persistence.error || persistence.reason || 'no durable reflection output'}`,
    )
  }
  if (typeof persistence.eventId !== 'string' || !persistence.eventId.trim()
      || typeof persistence.eventPath !== 'string' || !persistence.eventPath.trim()) {
    throw new Error('Reflection persistence did not confirm long-term memory capture')
  }

  const tts = graphNodeOutputs(graph, graphResult, 'tts')
  return {
    ...summary,
    status: 'generated',
    reflection,
    eventId: persistence.eventId,
    eventPath: persistence.eventPath,
    ttsQueued: tts.queued === true,
  }
}

/** Execute exactly one authenticated profile-scoped reflection workflow. */
export async function runReflector(
  options: ReflectorOptions = {},
  dependencyOverrides: Partial<ReflectorDependencies> = {},
): Promise<ReflectorOutcome> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides }
  throwIfAborted(options.signal)
  const targetUser = dependencies.resolveTargetUser(
    options.username ? { username: options.username } : undefined,
  )
  if (!targetUser) throw new Error('No authenticated target user resolved for Reflector')

  const executionId = validateExecutionId(options.executionId || dependencies.newExecutionId())
  const executionTimestamp = validateTimestamp(options.executionTimestamp || dependencies.now())
  const idempotencyKey = `reflector:${targetUser.username}:${executionId}`

  audit({
    category: 'action',
    level: 'info',
    event: 'reflector_started',
    actor: 'reflector',
    details: { username: targetUser.username, executionId },
  })

  try {
    const graph = await dependencies.loadGraph()
    throwIfAborted(options.signal)
    const graphResult = await dependencies.runWithUserContext(
      {
        userId: targetUser.userId,
        username: targetUser.username,
        role: targetUser.role,
      },
      () => dependencies.executeGraph({
        graph,
        signal: options.signal,
        context: {
          userId: targetUser.userId,
          username: targetUser.username,
          allowMemoryWrites: true,
          cognitiveMode: 'agent' as const,
          idempotencyKey,
          memoryTimestamp: executionTimestamp,
          abortSignal: options.signal,
        },
      }),
    )
    throwIfAborted(options.signal)
    const outcome = evaluateReflectorGraph(graph, graphResult, {
      username: targetUser.username,
      executionId,
    })

    if (outcome.scanFailures > 0) {
      audit({
        category: 'data',
        level: 'warn',
        event: 'reflector_memory_scan_partial',
        actor: 'reflector',
        details: {
          username: targetUser.username,
          executionId,
          failedCount: outcome.scanFailures,
          candidatesConsidered: outcome.candidatesConsidered,
        },
      })
    }
    if (outcome.status === 'skipped') {
      audit({
        category: 'action',
        level: 'info',
        event: 'reflector_skipped',
        actor: 'reflector',
        details: { ...outcome },
      })
    }
    return outcome
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'reflector_failed',
      actor: 'reflector',
      details: {
        username: targetUser.username,
        executionId,
        error: (error as Error).message,
      },
    })
    throw error
  }
}

export function parseReflectorArgs(
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): ReflectorOptions {
  const options: ReflectorOptions = {
    username: environment.MH_TRIGGER_USERNAME?.trim() || undefined,
    executionId: environment.MH_TASK_ID?.trim() || undefined,
    executionTimestamp: environment.MH_TASK_CREATED_AT?.trim() || undefined,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--username') {
      const username = args[index + 1]?.trim()
      if (!username) throw new Error('--username requires a value')
      options.username = username
      index += 1
      continue
    }
    if (argument.startsWith('--username=')) {
      const username = argument.slice('--username='.length).trim()
      if (!username) throw new Error('--username requires a value')
      options.username = username
      continue
    }
    throw new Error(`Unknown reflector option: ${argument}`)
  }
  return options
}

/** Agent Runtime adapter; all durable behavior remains in runReflector(). */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseReflectorArgs(input.args || [], {})
    const allowedOptions = new Set(['username', 'executionId', 'executionTimestamp'])
    for (const key of Object.keys(input.options || {})) {
      if (!allowedOptions.has(key)) throw new Error(`Unknown reflector option: ${key}`)
    }
    const structured = input.options || {}
    const outcome = await runReflector({
      ...parsed,
      username: typeof structured.username === 'string'
        ? structured.username
        : parsed.username || ctx.username,
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
      duration: Date.now() - startedAt,
      itemsProcessed: outcome.status === 'generated' ? 1 : 0,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startedAt,
      itemsProcessed: 0,
    }
  }
}
