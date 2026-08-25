import {
  reviewPendingDesireOutcomes,
  type DesireOutcomeReviewResult,
} from '../agency/desire-outcome-service.js'
import { withUserContext } from '../context.js'
import { getUserByUsername } from '../users.js'
import type { WorkHandlerContext } from './execution-engine.js'
import type { QueuedTask } from './types.js'

export async function executeDesireOutcomeReviewWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<DesireOutcomeReviewResult> {
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Desire outcome review user not found: ${task.username}`)
  const desireId = typeof task.input.desireId === 'string' && task.input.desireId.trim()
    ? task.input.desireId.trim()
    : undefined

  return withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => reviewPendingDesireOutcomes({
      username: user.username,
      desireId,
      signal: context.signal,
    }),
  )
}
