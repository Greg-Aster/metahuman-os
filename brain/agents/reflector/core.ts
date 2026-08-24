/**
 * Reflector Agent — graph runner
 *
 * This agent owns admission and authenticated-user selection only. The
 * editable Reflector graph owns persona loading, memory selection, prompt
 * construction, LLM generation, persistence, audit output, and TTS output.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ROOT,
  acquireLock,
  audit,
  getActiveBackend,
  getTargetUser,
  initGlobalLogger,
  isLocked,
  runGraph,
  validateSvelteFlowGraph,
  withUserContext,
  type SvelteFlowGraph,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export interface ReflectorOptions {
  singleUser?: boolean
}

export interface ReflectorResult {
  success: boolean
  reflectionsGenerated: number
  userCount: number
  errors: string[]
}

async function loadReflectorGraph(): Promise<SvelteFlowGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'reflector-mode.json')
  const raw = await fs.readFile(graphPath, 'utf8')
  return validateSvelteFlowGraph(JSON.parse(raw))
}

/** Invoke the canonical reflection workflow for one authenticated profile. */
export async function generateUserReflection(username: string): Promise<boolean> {
  console.log(`[reflector] Running graph for user: ${username}`)

  try {
    const graph = await loadReflectorGraph()
    const graphResult = await runGraph({
      graph,
      context: {
        userId: username,
        username,
        allowMemoryWrites: true,
        cognitiveMode: 'agent' as const,
      },
    })

    const memoryOutputs = graphResult.nodes.get('reflection-memories')?.outputs
    const promptOutputs = graphResult.nodes.get('reflection-prompt')?.outputs
    const llmOutputs = graphResult.nodes.get('1')?.outputs
    const saveOutputs = graphResult.nodes.get('2')?.outputs
    const reflection = typeof saveOutputs?.text === 'string' ? saveOutputs.text.trim() : ''
    const persisted = saveOutputs?.persisted === true

    if (persisted && reflection) {
      console.log(`[reflector] Persisted graph reflection: "${reflection.substring(0, 80)}..."`)
      audit({
        category: 'decision',
        level: 'info',
        message: 'Reflector graph persisted a grounded reflection',
        actor: 'reflector',
        metadata: {
          reflectionPreview: reflection.substring(0, 100) + (reflection.length > 100 ? '...' : ''),
          memoriesConsidered: Number(memoryOutputs?.count) || 0,
          personaApplied: promptOutputs?.personaApplied === true,
          usedGraph: true,
        },
      })
      return true
    }

    const reason = promptOutputs?.error
      || llmOutputs?.error
      || saveOutputs?.reason
      || saveOutputs?.error
      || 'Reflection graph produced no persisted output'
    console.log(`[reflector] Skipped: ${reason}`)
    audit({
      category: 'action',
      level: 'warn',
      message: 'Reflector graph did not persist a reflection',
      actor: 'reflector',
      metadata: {
        reason,
        memoriesFound: Number(memoryOutputs?.count) || 0,
        personaApplied: promptOutputs?.personaApplied === true,
        usedGraph: true,
      },
    })
    return false
  } catch (error) {
    console.error('[reflector] Graph error:', error)
    audit({
      category: 'system',
      level: 'error',
      message: `Reflector graph error: ${(error as Error).message}`,
      actor: 'reflector',
      metadata: { error: (error as Error).stack },
    })
    return false
  }
}

/** Run one scheduled cycle for the authenticated target profile. */
export async function runCycle(options: ReflectorOptions = {}): Promise<ReflectorResult> {
  console.log('[reflector] Starting cycle...')
  audit({
    category: 'action',
    level: 'info',
    message: 'Reflector agent starting graph workflow',
    actor: 'reflector',
    metadata: { mode: options.singleUser ? 'single-user' : 'active-user' },
  })

  const result: ReflectorResult = {
    success: false,
    reflectionsGenerated: 0,
    userCount: 0,
    errors: [],
  }

  try {
    try {
      console.log(`[reflector] Using LLM backend: ${getActiveBackend()}`)
    } catch {
      console.log('[reflector] Using model router')
    }

    const activeUser = getTargetUser()
    if (!activeUser) {
      console.log('[reflector] No active authenticated user found')
      result.success = true
      return result
    }

    result.userCount = 1
    try {
      const success = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        () => generateUserReflection(activeUser.username),
      )
      if (success) result.reflectionsGenerated = 1
    } catch (error) {
      const message = `User ${activeUser.username}: ${(error as Error).message}`
      console.error(`[reflector] Failed: ${message}`)
      result.errors.push(message)
    }

    result.success = result.errors.length === 0
    audit({
      category: 'action',
      level: 'info',
      message: 'Reflector graph workflow completed',
      actor: 'reflector',
      metadata: {
        reflectionsGenerated: result.reflectionsGenerated,
        userCount: result.userCount,
      },
    })
    return result
  } catch (error) {
    const message = (error as Error).message
    result.errors.push(message)
    audit({
      category: 'system',
      level: 'error',
      message: `Reflector cycle error: ${message}`,
      actor: 'reflector',
    })
    return result
  }
}

/** Agent Runtime adapter. */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now()
  const options: ReflectorOptions = {
    singleUser: input.args?.includes('--single-user') || input.options?.singleUser === true,
  }

  try {
    if (ctx.username) {
      const success = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        () => generateUserReflection(ctx.username!),
      )
      return {
        success,
        data: { reflectionsGenerated: success ? 1 : 0, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: success ? 1 : 0,
      }
    }

    const result = await runCycle(options)
    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.reflectionsGenerated,
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    }
  }
}

const LOCK_NAME = 'agent-reflector'

async function main(): Promise<void> {
  initGlobalLogger('reflector')
  if (isLocked(LOCK_NAME)) {
    console.log('[reflector] Another instance is already running. Exiting.')
    return
  }

  let lock: { release: () => void } | null = null
  try {
    lock = acquireLock(LOCK_NAME)
    const result = await runCycle()
    if (!result.success) {
      console.error('[reflector] Errors:', result.errors)
      process.exitCode = 1
    }
  } finally {
    lock?.release()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch(error => {
    console.error('[reflector] Fatal error:', error)
    process.exitCode = 1
  })
}
