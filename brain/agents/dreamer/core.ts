/**
 * Dreamer Agent — finite overnight dream synthesis.
 *
 * Sleep Workflow owns automatic admission. This module owns one profile-scoped
 * graph execution and reports success only after episodic and inner-dialogue
 * persistence have both completed.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ROOT,
  audit,
  getFirstFailedNode,
  getTargetUser,
  loadSleepConfig as loadCoreSleepConfig,
  recordSystemActivity,
  runGraph,
  validateSvelteFlowGraph,
  withUserContext,
  type GraphExecutionState,
  type SleepConfig,
  type SvelteFlowGraph,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export interface DreamerOptions {
  forceRun?: boolean
  config?: SleepConfig
  username?: string
  signal?: AbortSignal
}

export interface DreamerResult {
  success: boolean
  dreamsGenerated: number
  memoriesCurated: number
  userCount: number
  errors: string[]
}

export interface UserDreamerStats {
  dreamsGenerated: number
  memoriesCurated: number
  skippedReason?: 'disabled' | 'insufficient_memories'
}

export interface DreamerGraphEvaluation extends UserDreamerStats {
  continuationCount: number
  avgAgeDays: number
  oldestAgeDays: number
}

function markBackgroundActivity(): void {
  try {
    recordSystemActivity()
  } catch (error) {
    console.warn('[dreamer] Could not record background activity:', (error as Error).message)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Dreamer execution cancelled', 'AbortError')
}

function graphNodeOutputs(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  nodeType: string,
): Record<string, any> {
  const matches = graph.nodes.filter(node => node.data.nodeType === nodeType)
  if (matches.length !== 1) {
    throw new Error(`Dreamer graph requires exactly one ${nodeType} node (found ${matches.length})`)
  }
  const state = graphResult.nodes.get(matches[0].id)
  if (!state) throw new Error(`Dreamer graph did not execute ${nodeType}`)
  if (state.status !== 'completed') {
    throw new Error(`Dreamer node ${nodeType} ended with status ${state.status}`)
  }
  if (!state.outputs) throw new Error(`Dreamer node ${nodeType} produced no outputs`)
  return state.outputs
}

export function loadSleepConfig(username?: string): SleepConfig {
  return loadCoreSleepConfig(username)
}

export async function loadDreamerGraph(): Promise<SvelteFlowGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'dreamer-mode.json')
  const raw = await fsp.readFile(graphPath, 'utf-8')
  return validateSvelteFlowGraph(JSON.parse(raw))
}

export function evaluateDreamerGraph(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  maxDreams: number,
): DreamerGraphEvaluation {
  if (graphResult.status !== 'completed') {
    const failure = getFirstFailedNode(graphResult)
    throw new Error(
      failure
        ? `Dreamer graph failed at node ${failure.nodeId}: ${failure.error}`
        : 'Dreamer graph did not complete',
    )
  }

  const curator = graphNodeOutputs(graph, graphResult, 'dreamer_memory_curator')
  if (curator.error) throw new Error(`Dream memory curation failed: ${curator.error}`)
  const memoriesCurated = Number(curator.count) || 0
  const avgAgeDays = Number(curator.avgAgeDays) || 0
  const oldestAgeDays = Number(curator.oldestAgeDays) || 0
  if (memoriesCurated < 3) {
    return {
      dreamsGenerated: 0,
      memoriesCurated,
      continuationCount: 0,
      avgAgeDays,
      oldestAgeDays,
      skippedReason: 'insufficient_memories',
    }
  }

  const generator = graphNodeOutputs(graph, graphResult, 'dreamer_dream_generator')
  if (generator.error) throw new Error(`Dream generation failed: ${generator.error}`)
  if (typeof generator.dream !== 'string' || !generator.dream.trim()) {
    throw new Error('Dream generator completed without dream content')
  }

  const continuation = graphNodeOutputs(graph, graphResult, 'dreamer_continuation_generator')
  if (continuation.error) throw new Error(`Dream continuation failed: ${continuation.error}`)
  const continuationCount = Number(continuation.count) || 0
  if (!Number.isInteger(continuationCount) || continuationCount < 0) {
    throw new Error('Dream continuation count is invalid')
  }
  if (!Array.isArray(continuation.dreams) || continuation.dreams.length !== continuationCount) {
    throw new Error('Dream continuation output does not match its reported count')
  }

  const dreamsGenerated = 1 + continuationCount
  if (dreamsGenerated > maxDreams) {
    throw new Error(`Dreamer generated ${dreamsGenerated} dreams above the configured limit of ${maxDreams}`)
  }

  const saver = graphNodeOutputs(graph, graphResult, 'dreamer_dream_saver')
  if (!saver.saved || saver.savedCount !== dreamsGenerated) {
    throw new Error(
      `Dream persistence failed: ${saver.error || `saved ${Number(saver.savedCount) || 0}/${dreamsGenerated}`}`,
    )
  }
  if (!Array.isArray(saver.bufferEntries) || saver.bufferEntries.length < dreamsGenerated) {
    throw new Error('Dream persistence did not produce the required buffer admissions')
  }

  const innerDialogue = graphNodeOutputs(graph, graphResult, 'inner_dialogue_buffer')
  if (!innerDialogue.saved) {
    throw new Error(
      `Inner-dialogue persistence failed: ${innerDialogue.error || innerDialogue.reason || 'unknown error'}`,
    )
  }
  if (Number(innerDialogue.roleCounts?.dream) !== dreamsGenerated) {
    throw new Error('Inner-dialogue persistence did not admit every generated dream')
  }

  return {
    dreamsGenerated,
    memoriesCurated,
    continuationCount,
    avgAgeDays,
    oldestAgeDays,
  }
}

export async function generateUserDreams(
  username: string,
  options: DreamerOptions = {},
): Promise<UserDreamerStats> {
  const heartbeat = setInterval(markBackgroundActivity, 15_000)
  console.log(`[dreamer] Processing user: ${username}`)

  try {
    throwIfAborted(options.signal)
    const config = options.config ?? loadSleepConfig(username)
    if (!config.enabled && !options.forceRun) {
      audit({
        level: 'info',
        category: 'action',
        event: 'dreamer_skipped',
        details: { reason: 'disabled', username },
        actor: 'dreamer',
      })
      return { dreamsGenerated: 0, memoriesCurated: 0, skippedReason: 'disabled' }
    }

    const graph = await loadDreamerGraph()
    const graphResult = await runGraph({
      graph,
      context: {
        userId: username,
        username,
        allowMemoryWrites: true,
        cognitiveMode: 'agent' as const,
        maxDreams: config.maxDreamsPerNight,
        signal: options.signal,
      },
      signal: options.signal,
    })
    const evaluation = evaluateDreamerGraph(graph, graphResult, config.maxDreamsPerNight)

    if (evaluation.skippedReason === 'insufficient_memories') {
      audit({
        level: 'info',
        category: 'action',
        event: 'dreamer_skipped',
        details: {
          reason: evaluation.skippedReason,
          memoriesFound: evaluation.memoriesCurated,
          username,
        },
        actor: 'dreamer',
      })
      return evaluation
    }

    markBackgroundActivity()
    audit({
      level: 'info',
      category: 'action',
      event: 'dreamer_completed',
      details: {
        dreamsGenerated: evaluation.dreamsGenerated,
        continuationCount: evaluation.continuationCount,
        memoriesCurated: evaluation.memoriesCurated,
        username,
        usedGraph: true,
      },
      actor: 'dreamer',
    })

    return {
      dreamsGenerated: evaluation.dreamsGenerated,
      memoriesCurated: evaluation.memoriesCurated,
    }
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'dreamer_error',
      details: { error: (error as Error).message, username },
      actor: 'dreamer',
    })
    throw error
  } finally {
    clearInterval(heartbeat)
    markBackgroundActivity()
  }
}

export function parseDreamerArgs(args: string[]): Pick<DreamerOptions, 'forceRun'> {
  const options: Pick<DreamerOptions, 'forceRun'> = {}
  for (const argument of args) {
    if (argument === '--force') {
      options.forceRun = true
      continue
    }
    throw new Error(`Unknown dreamer option: ${argument}`)
  }
  return options
}

export function taskTriggerKind(payload = process.env.MH_TASK_PAYLOAD): string | null {
  if (!payload) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new Error('MH_TASK_PAYLOAD must contain valid JSON')
  }
  if (!parsed || typeof parsed !== 'object') return null
  const triggeredBy = (parsed as Record<string, unknown>).triggeredBy
  return typeof triggeredBy === 'string' && triggeredBy.trim() ? triggeredBy.trim() : null
}

export async function runCycle(options: DreamerOptions = {}): Promise<DreamerResult> {
  const result: DreamerResult = {
    success: false,
    dreamsGenerated: 0,
    memoriesCurated: 0,
    userCount: 0,
    errors: [],
  }

  try {
    throwIfAborted(options.signal)
    const triggerKind = taskTriggerKind()
    const triggerProfile = process.env.MH_TRIGGER_PROFILE || process.env.MH_TRIGGER_USERNAME
    const requestedUsername = options.username || triggerProfile
    const targetUser = getTargetUser(requestedUsername ? { username: requestedUsername } : undefined)
    if (!targetUser) throw new Error('No authenticated target user resolved for Dreamer')

    result.userCount = 1
    const config = options.config ?? loadSleepConfig(targetUser.username)
    const forceRun = options.forceRun === true || triggerKind === 'manual'

    audit({
      level: 'info',
      category: 'action',
      event: 'dreamer_cycle_started',
      details: {
        mode: triggerKind === 'sleep-workflow' ? 'sleep-workflow' : forceRun ? 'manual' : 'direct',
        username: targetUser.username,
      },
      actor: 'dreamer',
    })

    const stats = await withUserContext(
      { userId: targetUser.userId, username: targetUser.username, role: targetUser.role },
      () => generateUserDreams(targetUser.username, {
        config,
        forceRun,
        signal: options.signal,
      }),
    )
    result.dreamsGenerated = stats.dreamsGenerated
    result.memoriesCurated = stats.memoriesCurated
    result.success = true

    audit({
      level: 'info',
      category: 'action',
      event: 'dreamer_cycle_completed',
      details: {
        totalDreams: result.dreamsGenerated,
        totalMemories: result.memoriesCurated,
        skippedReason: stats.skippedReason,
        username: targetUser.username,
      },
      actor: 'dreamer',
    })
  } catch (error) {
    const message = (error as Error).message
    result.errors.push(message)
    audit({
      level: 'error',
      category: 'action',
      event: 'dreamer_cycle_failed',
      details: { error: message },
      actor: 'dreamer',
    })
  }

  return result
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now()
  try {
    const args = parseDreamerArgs(input.args || [])
    const optionKeys = Object.keys(input.options || {})
    const unknownOption = optionKeys.find(key => key !== 'forceRun')
    if (unknownOption) throw new Error(`Unknown Dreamer runtime option: ${unknownOption}`)
    if (input.options?.forceRun !== undefined && typeof input.options.forceRun !== 'boolean') {
      throw new Error('Dreamer forceRun option must be boolean')
    }

    const result = await runCycle({
      forceRun: args.forceRun === true || input.options?.forceRun === true,
      username: ctx.username,
      signal: ctx.signal,
    })
    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.dreamsGenerated,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    }
  }
}
