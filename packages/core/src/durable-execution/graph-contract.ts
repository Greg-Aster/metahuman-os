import type { SvelteFlowGraph } from '../cognitive-graph-schema.js'
import { getNode } from '../nodes/index.js'
import { contentHash, type ExecutionStore } from './store.js'
import type { CheckpointTransition, DispatchIntent, ExecutionDefinition, ExecutionLease } from './types.js'
import type { CheckpointConfig } from './checkpointer.js'
import type { GraphExecutionState } from '../graph-executor.js'
import { executableHash } from './executable-version.js'

export const GRAPH_RUNTIME_VERSION = 'langgraph-svelteflow-1'
export const CHECKPOINT_SCHEMA_VERSION = 1

/** AbortSignal permits arbitrary reasons; graph errors must carry an Error object. */
export function executionAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error(typeof reason === 'string' ? reason : 'Execution cancelled', { cause: reason })
  error.name = 'AbortError'
  return error
}

/** Resolve against current executable definitions, never against a saved expected hash. */
export function executionDefinition(graph: SvelteFlowGraph): ExecutionDefinition {
  const nodeVersions: Record<string, string> = {}
  for (const instance of graph.nodes) {
    const node = getNode(instance.data.nodeType)
    if (!node) throw new Error(`Unknown executable node ${instance.data.nodeType}`)
    nodeVersions[node.id] = contentHash({
      version: node.version ?? '1',
      inputs: node.inputs, outputs: node.outputs, execution: node.execution,
      propertySchemas: node.propertySchemas, properties: node.properties,
    })
  }
  return {
    graphId: graph.name, graphHash: contentHash(graph), runtimeVersion: `${GRAPH_RUNTIME_VERSION}:${executableHash()}`,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION, nodeVersions,
  }
}

export interface DurableGraphOptions {
  store: ExecutionStore
  lease: ExecutionLease
  config?: CheckpointConfig
  resume?: boolean
  initialTransition?: CheckpointTransition
  invocationId?: string
  /** Storage scope for a finite child that re-enters outside LangGraph's call stack. */
  checkpointNamespace?: string
  externalChild?: boolean
  resumeEventId?: string
  afterCheckpoint?: () => Promise<void>
}

export interface GraphNodeExecution {
  executionId: string
  occurrenceId: string
  /** Stage only: the saver commits the request with the successful node output. */
  dispatch(intent: Omit<DispatchIntent, 'effectId'>): DispatchIntent
  callGraph(graph: SvelteFlowGraph, context: Record<string, any>): Promise<GraphExecutionState>
  /** Only waits. The matching event must already have been durably admitted. */
  waitForEvent(reason?: string): import('./types.js').ExecutionEvent
  activeExecutions(): Array<{ executionId: string; status: string; task: import('./types.js').ExecutionObjective }>
  task(): import('./types.js').ExecutionObjective | null
  recordTask(task: import('./types.js').ExecutionObjective): void
  events(): import('./types.js').ExecutionEvent[]
  frame(id: string): import('../environment-interface/types.js').EnvironmentVisualFrame | null
  recordFrames(frames: import('../environment-interface/types.js').EnvironmentVisualFrame[]): void
}

/** Runtime callbacks and signals are reattached, not serialized as execution state. */
export function graphContextSnapshot(context: Record<string, any>): Record<string, any> {
  const snapshot = (value: any): any => {
    if (typeof value === 'function' || value instanceof AbortSignal) return undefined
    if (Array.isArray(value)) return value.map(snapshot)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== 'function')
        .map(([key, entry]) => [key, snapshot(entry)]))
    }
    return value
  }
  return snapshot(context)
}
