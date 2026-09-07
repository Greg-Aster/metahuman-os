import type { QueuedTask, TaskInput } from '../queue/types.js'
import { openExecutionStore } from './storage.js'
import { relayExecutionOutbox, executionWorkInput } from './coordinator-outbox.js'
import { submitCoordinatorWork } from '../queue/work-submission.js'

/** Repeating this after a Coordinator restart returns the same committed event. */
export async function deliverDurableWorkReceipt(task: QueuedTask, enqueue?: (input: TaskInput) => Promise<QueuedTask>): Promise<void> {
  if (!task.durable || task.type === 'environment_command'
    || !['completed', 'failed', 'cancelled', 'expired'].includes(task.state)) return
  const store = openExecutionStore(task.username)
  try {
    if (store.isRetired(task.durable.executionId)) return
    const effect = store.dispatch(task.durable.effectId)
    if (!effect.workItemId) {
      const receipt = await (enqueue ?? submitCoordinatorWork)(executionWorkInput(store, effect))
      if (receipt.id !== task.id) throw new Error('Terminal work has a conflicting admission receipt')
      store.acknowledgeAdmission(effect.effectId, receipt.id)
    }
    store.deliverWorkResult(task.durable.effectId, task.id, {
      state: task.state, result: task.result ?? null, error: task.error ?? null,
    })
    await relayExecutionOutbox(store, task.durable.executionId, enqueue)
  } finally { store.close() }
}
