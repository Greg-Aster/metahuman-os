import { createHash } from 'node:crypto'
import { submitCoordinatorWork } from '../queue/work-submission.js'
import type { GraphExecutionState } from '../graph-executor.js'

export interface DisplayFeedback {
  token: string
  sessionId?: string
  operation?: 'set' | 'release'
  stage?: 'processing' | 'error'
  expression?: string
  timeoutMs?: number
  background?: boolean
  ifToken?: string
}

export function displayFeedbackToken(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

/** Non-graph producers use the same finite workflow and Coordinator as graph nodes. */
export async function submitDisplayFeedback(username: string, feedback: DisplayFeedback, eventId: string) {
  return submitCoordinatorWork({ type: 'generic', handler: 'environment.display-feedback',
    resource: 'environment-display-feedback', username, source: 'system', priority: 'high', maxAttempts: 1,
    idempotencyKey: `display-feedback:${eventId}`, input: { feedback },
    metadata: { producer: 'environment-display-feedback' } })
}

/** Only a successfully admitted expression can register failure feedback.
 * Conditional replacement prevents an old failing invocation changing a newer face. */
export async function reportGraphDisplayFailure(username: string, state: GraphExecutionState) {
  for (const node of state.nodes.values()) {
    if (node.definition?.type !== 'environment_face_expression' || !node.outputs?.failureFeedback) continue
    const feedback = node.outputs.failureFeedback as DisplayFeedback
    await submitDisplayFeedback(username, feedback, `${feedback.token}:failed`)
  }
}
