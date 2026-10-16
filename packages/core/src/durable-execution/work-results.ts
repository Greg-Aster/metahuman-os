import type { QueuedTask, TaskInput } from '../queue/types.js'
import { openExecutionStore } from './storage.js'
import { relayExecutionOutbox, executionWorkInput } from './coordinator-outbox.js'
import { submitCoordinatorWork } from '../queue/work-submission.js'
import type { ExecutionStore } from './store.js'
import { ExecutionCheckpointer } from './checkpointer.js'

/** Repeating this after a Coordinator restart returns the same committed event. */
export async function deliverDurableWorkReceipt(task: QueuedTask, enqueue?: (input: TaskInput) => Promise<QueuedTask>,
  profileStore?: ExecutionStore, stillActive?: () => boolean): Promise<void> {
  const cancelledBeforeDispatch = task.type === 'environment_command' && task.input.type === 'speak' && task.state === 'cancelled'
    && !task.startedAt && !task.bodyLease
  if (!task.durable || (task.type === 'environment_command' && task.input.type !== 'faceExpression' && !cancelledBeforeDispatch)
    || !['completed', 'failed', 'cancelled', 'expired'].includes(task.state)) return
  // Recovery already owns one open connection for this profile's receipts.
  const store = profileStore ?? openExecutionStore(task.username)
  try {
    if (store.isRetired(task.durable.executionId)) return
    const effect = store.dispatch(task.durable.effectId)
    if (!effect.workItemId) {
      const receipt = await (enqueue ?? submitCoordinatorWork)(executionWorkInput(store, effect))
      if (receipt.id !== task.id) throw new Error('Terminal work has a conflicting admission receipt')
      store.acknowledgeAdmission(effect.effectId, receipt.id)
    }
    if (cancelledBeforeDispatch) {
      store.confirmUndispatched(effect.effectId, task)
      store.deliverActionResult(effect.executionId, effect.actionId!, {
        eventId: `work:${task.id}:not-sent`, kind: 'physical_result', actionId: effect.actionId,
        workItemId: task.id, payload: { action: task.input, feedback: {
          id: `work:${task.id}:not-sent`, actionId: effect.actionId, type: 'cancelled',
          timestamp: task.completedAt, message: task.cancellationReason,
          data: { producer: 'work-coordinator', delivery: { outcome: 'not_sent' } },
        } },
      }, false, true)
      await relayExecutionOutbox(store, task.durable.executionId, enqueue, stillActive)
      return
    }
    if (task.type === 'environment_command') {
      if (task.startedAt || task.bodyLease) store.recordActionAcceptance(effect.effectId, task)
      else if (task.state === 'cancelled' && ['pending', 'admitted', 'cancelled'].includes(effect.status)) {
        store.confirmUndispatched(effect.effectId, task)
      }
    }
    const reader = new ExecutionCheckpointer(store, {
      executionId: task.durable.executionId, owner: 'receipt-reader', generation: 0,
    })
    const graphResults = !effect.actionId && effect.kind === 'coordinator_work'
      && !store.findEvent(task.durable.executionId, `work:${task.id}:terminal`)
      ? await reader.workGraphResults(task.durable.effectId, task) : []
    store.deliverWorkResult(task.durable.effectId, task.id, {
      state: task.state, result: task.result ?? null, error: task.error ?? null,
    }, graphResults)
    await relayExecutionOutbox(store, task.durable.executionId, enqueue, stillActive)
  } finally { if (!profileStore) store.close() }
}
