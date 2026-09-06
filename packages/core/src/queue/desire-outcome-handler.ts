import {
  reviewPendingDesireOutcomes,
  type DesireOutcomeReviewResult,
} from '../agency/desire-outcome-service.js'
import { withUserContext } from '../context.js'
import { getUserByUsername } from '../users.js'
import type { WorkHandlerContext } from './execution-engine.js'
import type { QueuedTask } from './types.js'
import { buildDesireAgentTaskInput } from './work-submission.js'

export async function executeDesireOutcomeReviewWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<DesireOutcomeReviewResult> {
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Desire outcome review user not found: ${task.username}`)
  const desireId = typeof task.input.desireId === 'string' && task.input.desireId.trim()
    ? task.input.desireId.trim()
    : undefined

  const result = await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => reviewPendingDesireOutcomes({
      username: user.username,
      desireId,
      signal: context.signal,
    }),
  )
  for (const transition of result.transitions) {
    if (transition.status !== 'planning' && transition.status !== 'pending') continue
    context.enqueue(buildDesireAgentTaskInput({
      operation: 'plan',
      username: user.username,
      desireId: transition.desireId,
      source: 'autonomy',
      parentTaskId: task.id,
      correlationId: task.correlationId,
      idempotencyKey: `desire-plan:${transition.desireId}:outcome:${task.id}`,
      metadata: { producer: 'desire-outcome-transition', action: transition.action },
    }))
  }
  return result
}
