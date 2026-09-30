import { readFileSync } from 'node:fs'
import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../cognitive-graph-schema.js'
import { getNode, materializeNodeProperties } from '../nodes/index.js'
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
  const nodes = graph.nodes.map(instance => {
    const node = getNode(instance.data.nodeType)
    if (!node) throw new Error(`Unknown executable node ${instance.data.nodeType}`)
    nodeVersions[node.id] = contentHash({
      version: node.version ?? '1',
      inputs: node.inputs, outputs: node.outputs, execution: node.execution,
      propertySchemas: node.propertySchemas, properties: node.properties,
    })
    const outputSchema = { type: instance.data.nodeType, ...instance.data.schema }
    return {
      id: instance.id, nodeType: instance.data.nodeType,
      properties: materializeNodeProperties(node, instance.data.properties),
      muted: Boolean(instance.data.muted),
      activation: {
        mode: instance.data.activation?.mode ?? node.execution.activation,
        requiredInputs: instance.data.activation?.requiredInputs ?? node.execution.requiredInputs,
        when: instance.data.activation?.when ?? [],
      },
      output: { type: outputSchema.type, isOutputNode: Boolean(outputSchema.isOutputNode) },
    }
  })
  // Version the scheduler's inputs, not the editor document. Preserve ordering:
  // node order breaks scheduling ties; edge order determines shared-input values.
  const graphHash = contentHash({
    format: graph.format, version: graph.version, name: graph.name,
    cognitiveMode: graph.cognitiveMode, scheduler: graph.scheduler, nodes,
    edges: graph.edges.map(edge => ({
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle,
      kind: edge.data?.kind ?? 'data', when: edge.data?.when, loop: edge.data?.loop === true,
    })),
  })
  return {
    graphId: graph.name, graphHash, runtimeVersion: `${GRAPH_RUNTIME_VERSION}:${executableHash()}`,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION, nodeVersions,
  }
}

/** Discovery, input delivery and resume validate the same executable definition. */
export function resolveExecutionGraph(store: ExecutionStore, executionId: string, invokedGraph?: SvelteFlowGraph) {
  const saved = store.entry(executionId)
  // Saved files are resolved afresh. Direct graph calls validate the supplied
  // definition; discovery uses the saved graph when no caller supplies one.
  const graph: SvelteFlowGraph = saved.graphSource
    ? validateSvelteFlowGraph(JSON.parse(readFileSync(saved.graphSource, 'utf8')))
    : invokedGraph ?? saved.graph
  const definition = executionDefinition(graph)
  store.assertDefinition(executionId, definition)
  return { graph, definition }
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
  activeExecutions(): Array<{ executionId: string; status: string; graphId: string;
    waitingReason?: string; instruction: string; canSteer: boolean; resumeError?: string;
    task: import('./types.js').ExecutionObjective | null }>
  task(): import('./types.js').ExecutionObjective | null
  recordTask(task: import('./types.js').ExecutionObjective): void
  events(): import('./types.js').ExecutionEvent[]
  pendingEvents(): import('./types.js').ExecutionEvent[]
  frame(id: string): import('../environment-interface/types.js').EnvironmentVisualFrame | null
  recordFrames(frames: import('../environment-interface/types.js').EnvironmentVisualFrame[]): void
  observationHistory(query: import('../visual-observation.js').ObservationHistoryQuery): import('../visual-observation.js').VisualObservationRecord[]
  recordObservation(observation: import('../visual-observation.js').VisualObservationRecord): void
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
