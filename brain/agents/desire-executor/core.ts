/**
 * Desire Executor agent interface.
 *
 * Durable execution belongs to Core Agency and is admitted through the one
 * server-owned Work Coordinator. This module intentionally owns no execution,
 * review, locking, scheduling, or persistence path.
 */

import {
  getTargetUser,
  submitDesireExecution,
  type QueuedTask,
  type WorkSource,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export interface DesireExecutorOptions {
  username?: string
  desireId?: string
  source?: WorkSource
}

export interface DesireExecutorResult {
  success: boolean
  taskId?: string
  state?: QueuedTask['state']
  errors: string[]
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]?.trim()
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseWorkSource(value: unknown): WorkSource {
  if (value === undefined) return 'system'
  const source = String(value)
  if (!['user', 'system', 'timer', 'autonomy', 'environment'].includes(source)) {
    throw new Error(`Invalid desire-executor source: ${source}`)
  }
  return source as WorkSource
}

export function parseDesireExecutorArgs(args: string[]): DesireExecutorOptions {
  const supported = new Set(['--username', '--desire-id'])
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!supported.has(argument)) throw new Error(`Unknown desire-executor argument: ${argument}`)
    index += 1
    if (!args[index] || args[index].startsWith('--')) throw new Error(`${argument} requires a value`)
  }
  return {
    username: optionValue(args, '--username'),
    desireId: optionValue(args, '--desire-id'),
  }
}

export async function runCycle(options: DesireExecutorOptions = {}): Promise<DesireExecutorResult> {
  try {
    const user = getTargetUser({ username: options.username })
    if (!user) {
      return { success: false, errors: ['Desire execution requires an active or explicit profile'] }
    }

    const task = await submitDesireExecution({
      username: user.username,
      desireId: options.desireId,
      source: options.source || 'user',
      metadata: { producer: 'desire-executor-agent' },
    })
    return {
      success: true,
      taskId: task.id,
      state: task.state,
      errors: [],
    }
  } catch (error) {
    return { success: false, errors: [(error as Error).message] }
  }
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseDesireExecutorArgs(input.args || [])
    const source = parseWorkSource(input.options?.source)
    const result = await runCycle({
      username: typeof input.options?.username === 'string'
        ? input.options.username
        : parsed.username || ctx.username,
      desireId: typeof input.options?.desireId === 'string'
        ? input.options.desireId
        : parsed.desireId,
      source,
    })
    return {
      success: result.success,
      data: result,
      errors: result.errors.length > 0 ? result.errors : undefined,
      durationMs: Date.now() - startedAt,
      itemsProcessed: result.taskId ? 1 : 0,
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
