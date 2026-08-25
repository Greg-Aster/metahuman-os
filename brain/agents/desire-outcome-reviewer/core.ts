/** Thin agent interface for the Core Agency outcome-review owner. */

import {
  getTargetUser,
  submitDesireOutcomeReview,
  type QueuedTask,
  type WorkSource,
} from '@metahuman/core'
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime'

export interface DesireOutcomeReviewerOptions {
  username?: string
  desireId?: string
  source?: WorkSource
}

export interface DesireOutcomeReviewerResult {
  success: boolean
  taskId?: string
  state?: QueuedTask['state']
  errors: string[]
}

function parseWorkSource(value: unknown): WorkSource {
  if (value === undefined) return 'system'
  const source = String(value)
  if (!['user', 'system', 'timer', 'autonomy', 'environment'].includes(source)) {
    throw new Error(`Invalid desire-outcome-reviewer source: ${source}`)
  }
  return source as WorkSource
}

export function parseDesireOutcomeReviewerArgs(args: string[]): DesireOutcomeReviewerOptions {
  const result: DesireOutcomeReviewerOptions = {}
  const supported = new Set(['--username', '--desire-id'])
  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index]
    if (!supported.has(argument)) {
      throw new Error(`Unknown desire-outcome-reviewer argument: ${argument}`)
    }
    const value = args[index + 1]?.trim()
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    if (argument === '--username') result.username = value
    else result.desireId = value
  }
  return result
}

export async function runCycle(
  options: DesireOutcomeReviewerOptions = {},
): Promise<DesireOutcomeReviewerResult> {
  try {
    const user = getTargetUser({ username: options.username })
    if (!user) {
      return { success: false, errors: ['Outcome review requires an active or explicit profile'] }
    }
    const task = await submitDesireOutcomeReview({
      username: user.username,
      desireId: options.desireId,
      source: options.source || 'user',
      metadata: { producer: 'desire-outcome-reviewer-agent' },
    })
    return { success: true, taskId: task.id, state: task.state, errors: [] }
  } catch (error) {
    return { success: false, errors: [(error as Error).message] }
  }
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startedAt = Date.now()
  try {
    const parsed = parseDesireOutcomeReviewerArgs(input.args || [])
    const result = await runCycle({
      username: typeof input.options?.username === 'string'
        ? input.options.username
        : parsed.username || ctx.username,
      desireId: typeof input.options?.desireId === 'string'
        ? input.options.desireId
        : parsed.desireId,
      source: parseWorkSource(input.options?.source),
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
