import { submitCoordinatorWork } from '../queue/work-submission.js'
import type { QueuedTask, TaskInput } from '../queue/types.js'
import type { ExecutionStore } from './store.js'
import { ExecutionDeliveryError } from './types.js'
import { saveRobotStatus, type RobotStatusSituation, type RobotStatusSourceFacts } from '../robot-status.js'
import type { DispatchRecord } from './types.js'
import { queueTTS, getTTSQueueState, TTS_DELIVERY_MAX_AGE_MS } from '../tts/delivery-queue.js'
import { writeBufferEntry, type CanonicalBufferMode, type ConversationMessage } from '../conversation-buffer.js'
import { getAuthenticatedRuntimeId, getCurrentlyActiveUser } from '../sessions.js'

/** The same admission contract is used by relay and by an early accepting worker. */
export function executionWorkInput(store: ExecutionStore, effect: DispatchRecord): TaskInput {
  const input: TaskInput = effect.kind === 'graph_resume' ? {
    type: 'generic', handler: 'graph.resume', resource: (effect.payload as { resource?: string }).resource ?? 'local-llm',
    source: 'system', priority: 'high',
    input: effect.payload as Record<string, unknown>, username: store.get(effect.executionId).username,
    metadata: { producer: 'durable-execution' },
  } : effect.payload as TaskInput
  return {
    ...input, username: store.get(effect.executionId).username, correlationId: effect.executionId,
    durable: { executionId: effect.executionId, effectId: effect.effectId,
      ...(input.executionScope ? { scope: input.executionScope } : {}),
      originRuntimeId: store.get(effect.executionId).originRuntimeId,
      recovery: input.executionScope === 'independent' || input.type === 'environment_command' || input.handler?.startsWith('agent.') ? 'reconcile' : 'resume' },
  }
}

/** SQLite commits intent first; the Coordinator durably deduplicates admission before we attach its receipt. */
export async function relayExecutionOutbox(
  store: ExecutionStore,
  executionId: string,
  enqueue: (input: TaskInput) => Promise<QueuedTask> = submitCoordinatorWork,
  stillActive: () => boolean = () => true,
): Promise<void> {
  const execution = store.get(executionId)
  for (const pending of store.pendingDispatches().filter(item => item.executionId === executionId)) {
    const input = pending.kind === 'execution_event'
      ? pending.payload as { executionId: string; kind: string } : undefined
    // Load the registry only for steering, before checking current admission.
    // Cancellation does not resume a graph and remains independent of versions.
    const resolveInputGraph = input?.kind === 'user_steering'
      ? (await import('./graph-contract.js')).resolveExecutionGraph : undefined
    if (!stillActive()) return
    const runtimeId = getAuthenticatedRuntimeId()
    if (runtimeId && execution.originRuntimeId !== runtimeId) {
      const user = getCurrentlyActiveUser()
      if (!user || user.role === 'guest' || user.username !== execution.username) return
    }
    const effect = store.dispatch(pending.effectId)
    if (effect.status !== 'pending') continue
    store.assertDispatchable(effect.effectId)
    if (input) {
      const target = input.executionId
      // The graph may have changed since the intent model saw its availability.
      resolveInputGraph?.(store, target)
      store.deliverExecutionInput(effect.effectId)
      await relayExecutionOutbox(store, target, enqueue, stillActive)
      continue
    }
    if (effect.kind === 'robot_status') {
      const projection = effect.payload as { situation: RobotStatusSituation; sources: RobotStatusSourceFacts }
      saveRobotStatus(store.get(executionId).username, projection.situation, {
        ...projection.sources, projection: { executionId, effectId: effect.effectId },
      })
      store.completeProjection(effect.effectId)
      continue
    }
    if (effect.kind === 'local_tts') {
      const request = effect.payload as { text: string; mode: 'conversation' | 'inner'; source: string; generation?: number; createdAt: number }
      const username = store.get(executionId).username
      const item = queueTTS(username, request.text, request.mode, request.source, request.generation,
        { id: effect.effectId, createdAt: request.createdAt })
      const superseded = request.generation !== undefined && request.generation !== getTTSQueueState(username).generation
      if (!item && !superseded && Date.now() - request.createdAt <= TTS_DELIVERY_MAX_AGE_MS) throw new ExecutionDeliveryError('Local speech delivery is awaiting queue capacity')
      store.completeProjection(effect.effectId)
      continue
    }
    if (effect.kind === 'buffer_entry') {
      const request = effect.payload as { mode: CanonicalBufferMode; message: ConversationMessage }
      if (!await writeBufferEntry(store.get(executionId).username, request.mode, request.message)) {
        throw new ExecutionDeliveryError('Buffer admission was rejected')
      }
      store.completeProjection(effect.effectId)
      continue
    }
    if (!['coordinator_work', 'graph_resume'].includes(effect.kind)) throw new Error(`No dispatch owner for ${effect.kind}`)
    let task: QueuedTask
    try { task = await enqueue(executionWorkInput(store, effect)) } catch (error) { throw new ExecutionDeliveryError(error) }
    store.acknowledgeAdmission(effect.effectId, task.id)
  }
}
