import fs from 'node:fs'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import { getCurrentlyActiveUser, getAuthenticatedRuntimeId } from '../sessions.js'
import { resolvePath } from '../storage-client.js'
import type { UnifiedQueueManager } from '../queue/unified-queue-manager.js'
import { openExecutionStore } from './storage.js'
import { executionWorkInput, relayExecutionOutbox } from './coordinator-outbox.js'
import { deliverDurableWorkReceipt } from './work-results.js'
import { ExecutionCheckpointer } from './checkpointer.js'
import { retireBufferAdmissions } from '../conversation-buffer.js'

/** Coordinator maintenance for the one authenticated, storage-ready profile. */
export async function recoverDurableExecutions(manager: UnifiedQueueManager, retentionDays: number): Promise<void> {
  const user = getCurrentlyActiveUser()
  if (!user || user.role === 'guest') return
  const { username, userId } = user
  const runtimeId = getAuthenticatedRuntimeId()
  const stillActive = () => getAuthenticatedRuntimeId() === runtimeId && getCurrentlyActiveUser()?.userId === userId
  const enqueue = async (input: Parameters<UnifiedQueueManager['enqueue']>[0]) => manager.enqueue(input)
  const ledger = manager.exportState()
  const tasks = [...(ledger.items ?? []), ...(ledger.history ?? []), ...(ledger.durableReceipts ?? [])]
    .filter(task => task.username === username)
  const failures: Error[] = []
  await yieldToIO()
  if (!stillActive()) return
  recovery: try {
    const resolved = resolvePath({ username, category: 'state', subcategory: 'sessions', relativePath: 'executions.sqlite' })
    if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Execution storage cannot be resolved')
    const profileTasks = tasks.filter(task => task.durable)
    if (!fs.existsSync(resolved.path)) {
      if (profileTasks.length) throw new Error('Durable work exists but its execution storage is missing')
      return
    }
    const store = openExecutionStore(username)
    try {
      for (const task of profileTasks) {
        if (!stillActive()) break recovery
        try {
          if (task.handler === 'graph.resume' && ['queued', 'waiting'].includes(task.state)
            && !store.isRetired(task.durable!.executionId)
            && store.dispatch(task.durable!.effectId).status === 'completed') {
            // The checkpoint already settled this unstarted wake. Retire it at
            // the Coordinator before it claims capacity or charges a cooldown.
            // Accepted runners remain unresolved until their invocation settles.
            manager.cancel(task.id, 'Resume event already processed by its execution')
          }
          await deliverDurableWorkReceipt(manager.getTask(task.id) ?? task, enqueue, store, stillActive)
        }
        catch (error) { failures.push(new Error(`Receipt recovery failed for ${task.id}`, { cause: error })) }
        // A microtask-only recovery sweep can starve authentication, heartbeats
        // and acknowledgements. Yield to pending I/O, without a timed cooldown.
        await yieldToIO()
      }
      const retire = async (id: string) => {
        try {
          manager.retireExecutionReceipts(id)
          await retireBufferAdmissions(username, id)
          store.acknowledgeRetirement(id)
        } catch (error) { failures.push(new Error(`Execution retirement failed for ${username}/${id}`, { cause: error })) }
      }
      for (const id of store.retirements()) {
        if (!stillActive()) break recovery
        await retire(id)
      }
      for (const execution of store.list()) {
        if (!stillActive()) break recovery
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
                await deliverDurableWorkReceipt(receipt, enqueue, store, stillActive)
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
              && ['queued', 'leased', 'waiting'].includes(manager.getTask(task.id)?.state ?? task.state))
            if (!claimed) store.requestRecovery(execution.executionId)
            await relayExecutionOutbox(store, execution.executionId, enqueue, stillActive)
          }
        } catch (error) { failures.push(new Error(`Execution recovery failed for ${username}/${execution.executionId}`, { cause: error })) }
        await yieldToIO()
      }
      if (!stillActive()) break recovery
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
  if (failures.length) throw new AggregateError(failures, failures.map(error => `${error.message}: ${String(error.cause)}`).join('; '))
}
