import {
  executeApprovedDesires,
  type ApprovedDesireExecutionResult,
} from '../agency/desire-execution-service.js'
import { withUserContext } from '../context.js'
import { getUserByUsername } from '../users.js'
import type { WorkHandlerContext } from './execution-engine.js'
import type { QueuedTask } from './types.js'

function namedSse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function executeDesireExecutionWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<ApprovedDesireExecutionResult> {
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Desire execution user not found: ${task.username}`)
  const desireId = typeof task.input.desireId === 'string' && task.input.desireId.trim()
    ? task.input.desireId.trim()
    : undefined

  return withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => executeApprovedDesires({
      username: user.username,
      desireId,
      signal: context.signal,
      onProgress: progress => context.emit(namedSse('progress', {
        type: progress.type,
        stepNumber: progress.stepNumber,
        totalSteps: progress.totalSteps,
        action: progress.action,
        message: progress.message,
        timestamp: progress.timestamp,
        data: progress.data,
      })),
    }),
  )
}
