import {
  executeApprovedDesires,
  type ApprovedDesireExecutionResult,
} from '../agency/desire-execution-service.js'
import { withUserContext } from '../context.js'
import { getUserByUsername } from '../users.js'
import type { WorkHandlerContext } from './execution-engine.js'
import type { QueuedTask } from './types.js'
import { loadDesire } from '../agency/storage.js'
import { buildDesireAgentTaskInput } from './work-submission.js'

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

  const admitReviews = async (desireIds: string[]) => {
    for (const id of desireIds) {
      const current = await loadDesire(id, user.username)
      if (current?.status !== 'awaiting_review') continue
      context.enqueue(buildDesireAgentTaskInput({
        operation: 'review',
        username: user.username,
        desireId: id,
        source: 'autonomy',
        parentTaskId: task.id,
        correlationId: task.correlationId,
        idempotencyKey: `desire-outcome-review:${id}:execution:${current.execution?.startedAt || task.id}`,
        metadata: { producer: 'desire-execution-transition' },
      }))
    }
  }

  try {
    const result = await withUserContext(
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
    await admitReviews(result.desireIds)
    return result
  } catch (error) {
    if (desireId) await admitReviews([desireId])
    throw error
  }
}
