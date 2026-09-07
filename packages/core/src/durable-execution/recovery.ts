import fs from 'node:fs'
import { getUsers } from '../users.js'
import { resolvePath } from '../storage-client.js'
import type { UnifiedQueueManager } from '../queue/unified-queue-manager.js'
import { openExecutionStore } from './storage.js'
import { executionWorkInput, relayExecutionOutbox } from './coordinator-outbox.js'
import { deliverDurableWorkReceipt } from './work-results.js'
import { ExecutionCheckpointer } from './checkpointer.js'
import { retireBufferAdmissions } from '../conversation-buffer.js'

/** Called by the existing Coordinator owner before dispatch starts, not a scheduler. */
export async function recoverDurableExecutions(manager: UnifiedQueueManager, retentionDays: number): Promise<void> {
  const enqueue = async (input: Parameters<UnifiedQueueManager['enqueue']>[0]) => manager.enqueue(input)
  const ledger = manager.exportState()
  const tasks = [...(ledger.items ?? []), ...(ledger.history ?? []), ...(ledger.durableReceipts ?? [])]
  const failures: Error[] = []
  for (const task of tasks) {
    try { await deliverDurableWorkReceipt(task, enqueue) }
    catch (error) { failures.push(new Error(`Receipt recovery failed for ${task.id}`, { cause: error })) }
  }
  const usernames = new Set([...getUsers().map(user => user.username), ...tasks.filter(task => task.durable).map(task => task.username)])
  for (const username of usernames) {
    try {
    const resolved = resolvePath({ username, category: 'state', subcategory: 'sessions', relativePath: 'executions.sqlite' })
    if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Execution storage cannot be resolved')
    if (!fs.existsSync(resolved.path)) continue
    const store = openExecutionStore(username)
    try {
      const retire = async (id: string) => {
        try {
          manager.retireExecutionReceipts(id)
          await retireBufferAdmissions(username, id)
          store.acknowledgeRetirement(id)
        } catch (error) { failures.push(new Error(`Execution retirement failed for ${username}/${id}`, { cause: error })) }
      }
      for (const id of store.retirements()) await retire(id)
      for (const execution of store.list()) {
        try {
          if (['failed', 'cancelled'].includes(execution.status)) {
            for (const effect of store.dispatches(execution.executionId).filter(effect =>
              effect.kind === 'coordinator_work' && ['pending', 'admitted', 'cancelled'].includes(effect.status))) {
              // The ledger may already own this work even when SQLite has no
              // admission acknowledgement. Persist one non-dispatch receipt at
              // that owner; a claimed job is not evidence of non-dispatch.
              const receipt = manager.cancelAdmission(executionWorkInput(store, effect), 'Parent execution ended before work started')
              if (!effect.workItemId) store.acknowledgeAdmission(effect.effectId, receipt.id)
              if (receipt.state === 'cancelled' && !receipt.startedAt && !receipt.bodyLease) {
                store.confirmUndispatched(effect.effectId, receipt)
                await deliverDurableWorkReceipt(receipt, enqueue)
              }
            }
          }
          if (execution.cancelledAt !== null) {
            for (const task of tasks.filter(task => task.durable?.executionId === execution.executionId
              || task.graphExecutions?.includes(execution.executionId))) {
              manager.cancel(task.id, 'Parent execution cancelled')
            }
          } else if (['running', 'waiting'].includes(execution.status)) {
            const claimed = tasks.some(task => task.graphExecutions?.includes(execution.executionId)
              && ['queued', 'leased', 'waiting'].includes(task.state))
            if (!claimed) store.requestRecovery(execution.executionId)
            await relayExecutionOutbox(store, execution.executionId, enqueue)
          }
        } catch (error) { failures.push(new Error(`Execution recovery failed for ${username}/${execution.executionId}`, { cause: error })) }
      }
      const before = Date.now() - retentionDays * 86_400_000
      const terminalIds = store.list().filter(record => ['completed', 'failed', 'cancelled'].includes(record.status)
        && record.updatedAt < before).map(record => record.executionId)
      const saver = new ExecutionCheckpointer(store, { executionId: '', owner: 'retention', generation: 0 })
      await saver.pruneTerminal(before, new Set(tasks.filter(task => task.durable
        && !['completed', 'failed', 'cancelled', 'expired'].includes(task.state)).map(task => task.durable!.executionId)))
      const remaining = new Set(store.list().map(record => record.executionId))
      for (const id of terminalIds) if (!remaining.has(id)) await retire(id)
    } finally { store.close() }
    } catch (error) { failures.push(new Error(`Execution recovery failed for ${username}`, { cause: error })) }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => `${error.message}: ${String(error.cause)}`).join('; '))
}
