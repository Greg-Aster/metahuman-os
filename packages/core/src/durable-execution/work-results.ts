import type { QueuedTask, TaskInput } from '../queue/types.js'
import { openExecutionStore } from './storage.js'
import { relayExecutionOutbox, executionWorkInput } from './coordinator-outbox.js'
import { submitCoordinatorWork } from '../queue/work-submission.js'
import type { ExecutionStore } from './store.js'
import { ExecutionCheckpointer } from './checkpointer.js'

/** Repeating this after a Coordinator restart returns the same committed event. */
export async function deliverDurableWorkReceipt(task: QueuedTask, enqueue?: (input: TaskInput) => Promise<QueuedTask>,
  profileStore?: ExecutionStore, stillActive?: () => boolean): Promise<void> {
  if (!task.durable || task.type === 'environment_command'
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
    const reader = new ExecutionCheckpointer(store, {
      executionId: task.durable.executionId, owner: 'receipt-reader', generation: 0,
    })
    const graphResults = effect.kind === 'coordinator_work'
      && !store.findEvent(task.durable.executionId, `work:${task.id}:terminal`)
      ? await reader.workGraphResults(task.durable.effectId, task) : []
    store.deliverWorkResult(task.durable.effectId, task.id, {
      state: task.state, result: task.result ?? null, error: task.error ?? null,
    }, graphResults)
    await relayExecutionOutbox(store, task.durable.executionId, enqueue, stillActive)
  } finally { if (!profileStore) store.close() }
}
