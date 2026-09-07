import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadedGraphSource } from '../graph-streaming.js'
import { validateSvelteFlowGraph } from '../cognitive-graph-schema.js'
import { getUserContext } from '../context.js'
import { executeGraph, type GraphExecutionState } from '../graph-executor.js'
import type { GraphRunParams } from '../graph-runtime.js'
import { ExecutionCheckpointer } from './checkpointer.js'
import { executionDefinition, graphContextSnapshot } from './graph-contract.js'
import { ExecutionStore } from './store.js'
import type { QueuedTask, TaskInput } from '../queue/types.js'
import { relayExecutionOutbox } from './coordinator-outbox.js'
import { ExecutionDeliveryError } from './types.js'
import { openExecutionStore } from './storage.js'

/** Finite-work identity is transport context; the checkpoint owns the reasoning state. */
const workScope = new AsyncLocalStorage<{ task: QueuedTask; graphIndex: number; attach(executionId: string): void;
  enqueue?: (input: TaskInput) => Promise<QueuedTask> }>()
let externalGraphIndex = 0

export function withGraphWork<T>(task: QueuedTask, attach: (executionId: string) => void, run: () => Promise<T>,
  enqueue?: (input: TaskInput) => Promise<QueuedTask>): Promise<T> {
  return workScope.run({ task, graphIndex: 0, attach, enqueue }, run)
}

export async function runDurableGraph(params: GraphRunParams): Promise<GraphExecutionState> {
  const parent = params.context.graphExecution
  if (parent?.callGraph) return parent.callGraph(params.graph, params.context)
  const scope = workScope.getStore()
  const delegated = !params.executionId && scope?.task.handler !== 'graph.resume'
    ? scope?.task.durable ?? (process.env.MH_PARENT_EXECUTION ? JSON.parse(process.env.MH_PARENT_EXECUTION) : null)
    : null
  const username = params.context.username || getUserContext()?.username || scope?.task.username
  if (typeof username !== 'string' || !username.trim()) throw new Error('Graph execution requires an authenticated profile')
  const store = openExecutionStore(username)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let lease: ReturnType<ExecutionStore['claim']> | undefined
  const controller = new AbortController()
  const signal = params.signal ? AbortSignal.any([params.signal, controller.signal]) : controller.signal
  try {
    const suppliedId = params.executionId || delegated?.executionId
    const entry = suppliedId ? store.entry(suppliedId) : null
    const rootGraph = entry?.graphSource
      ? validateSvelteFlowGraph(JSON.parse(readFileSync(entry.graphSource, 'utf8')))
      : delegated ? entry.graph : params.graph
    const definition = executionDefinition(rootGraph)
    const record = suppliedId ? store.get(suppliedId) : store.enter(
      username, definition,
      scope ? `${scope.task.id}:graph:${scope.graphIndex++}` : params.context.requestId || randomUUID(),
      { graph: params.graph, graphSource: loadedGraphSource(params.graph), context: graphContextSnapshot({ ...params.context, username }) },
    )
    if (record.username !== username) throw new Error('Execution belongs to a different profile')
    store.assertDefinition(record.executionId, definition)
    scope?.attach(record.executionId)
    const invocationId = delegated ? `work:${delegated.effectId}:graph:${scope ? scope.graphIndex++ : externalGraphIndex++}` : undefined
    const checkpointConfig = { configurable: { thread_id: record.executionId } }
    if (record.status === 'cancelled') throw new DOMException('Execution cancelled', 'AbortError')
    if (record.status === 'failed') throw new Error('Execution has a terminal failure')
    // A completed graph may be read again after the Coordinator lost its acknowledgement.
    if (record.status === 'completed') {
      const reader = new ExecutionCheckpointer(store, { executionId: record.executionId, generation: 0, owner: 'read-only' }, undefined, invocationId)
      const saved = await reader.getTuple(checkpointConfig)
      if (!saved) throw new Error('Completed execution has no checkpoint')
      const values = saved.checkpoint.channel_values
      return { nodes: new Map(values.nodeEntries as any), startTime: Number(values.startedAt), status: 'completed', executionId: record.executionId, checkpointId: saved.checkpoint.id }
    }
    lease = store.claim(record.executionId, definition)
    const relay = () => relayExecutionOutbox(store, record.executionId, scope?.enqueue)
    heartbeat = setInterval(() => {
      try { store.renew(lease!); } catch (error) { controller.abort(error); }
    }, 10_000)
    heartbeat.unref()
    await relay()
    const saved = delegated ? { context: graphContextSnapshot({ ...params.context, username }) } : store.entry(record.executionId)
    const reader = new ExecutionCheckpointer(store, lease, undefined, invocationId)
    const previousCheckpoint = await reader.getTuple(checkpointConfig)
    const result = await executeGraph(delegated ? params.graph : rootGraph, {
      ...saved.context,
      ...Object.fromEntries(Object.entries(params.context).filter(([, value]) => typeof value === 'function')),
    }, params.eventHandler, signal, {
      store, lease, resume: Boolean(previousCheckpoint), resumeEventId: params.resumeEventId,
      ...(invocationId ? { invocationId, checkpointNamespace: invocationId, externalChild: true } : {}),
      afterCheckpoint: relay,
    })
    if (signal.aborted) {
      // Worker interruption is not semantic cancellation of the user's objective.
      if (!controller.signal.aborted) {
        store.settle(lease, 'waiting', 'interrupted')
        store.requestRecovery(record.executionId)
        await relay()
      }
      throw signal.reason ?? new DOMException('Execution cancelled', 'AbortError')
    }
    if (result.error instanceof ExecutionDeliveryError) {
      store.settle(lease, 'waiting')
      throw result.error
    }
    if (!delegated) {
      const reason = result.pending?.map((pending: any) => pending.value?.reason).find(Boolean)
      const retryable = result.status === 'failed' && scope && scope.task.attempt + 1 < scope.task.maxAttempts
      store.settle(lease, result.status === 'completed' ? 'completed' : result.status === 'waiting' || retryable ? 'waiting' : 'failed', retryable ? 'attempt_failed' : reason)
      if (result.status === 'completed' && store.get(record.executionId).status === 'waiting') result.status = 'waiting'
    }
    return result
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    if (lease) store.release(lease)
    store.close()
  }
}
