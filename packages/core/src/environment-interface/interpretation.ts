import { loadGraphForMode } from '../graph-streaming.js'
import { executeGraph } from '../graph-executor.js'
import { requireGraphNodeOutput } from '../graph-runtime.js'
import { openExecutionStore } from '../durable-execution/storage.js'
import type { GraphNodeExecution } from '../durable-execution/graph-contract.js'
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js'
import type { EnvironmentObservation } from './types.js'

export interface InstructionInterpretation {
  executionId: string
  sessionId: string
  revision: number
  motionId?: string
  stepIndex: number
  body: string
  route?: Record<string, unknown>
  response?: string
  memory?: Record<string, unknown>
}

/** The existing gateway dispatch fence includes manual commands and reconnects. */
export function interpretationBody(observation?: EnvironmentObservation): string {
  const updates = observation?.state?.activeMovementUpdates as Record<string, any> | undefined
  const gateway = observation?.state?.gateway as any
  const robot = gateway?.robots?.[updates?.robotId]
  return JSON.stringify([observation?.sessionId, updates?.gatewayInstance, updates?.robotId,
    updates?.epoch, robot?.body_command_sequence])
}

/** Reuse the configured read/inference graph, excluding all effect owners. */
export function interpretationGraph(graph: SvelteFlowGraph): SvelteFlowGraph {
  const selector = graph.nodes.find(node => node.data.nodeType === 'environment_action_parser')
  if (!selector) throw new Error('Environment interpretation requires its configured selector')
  const bypass = new Set(graph.nodes.filter(node => ['conversation_buffer', 'memory_capture'].includes(node.data.nodeType)).map(node => node.id))
  const edges = graph.edges.filter(edge => !bypass.has(edge.target)).map(edge => {
    if (!bypass.has(edge.source)) return edge
    const source = graph.nodes.find(node => node.data.nodeType === 'user_input')!
    return { ...edge, source: source.id, sourceHandle: 'message' }
  })
  const included = new Set([selector.id])
  for (let size = -1; size !== included.size;) {
    size = included.size
    for (const edge of edges) if (included.has(edge.target)) included.add(edge.source)
  }
  return { ...graph, name: `${graph.name} interpretation`, scheduler: { ...graph.scheduler, eventInputNodeId: undefined },
    nodes: graph.nodes.filter(node => included.has(node.id)), edges: edges.filter(edge => included.has(edge.source) && included.has(edge.target)) }
}

/** Finite Coordinator work: no execution lease, command, speech or task mutation. */
export async function interpretInstructions(input: {
  identity: InstructionInterpretation; context: Record<string, any>; turns: Record<string, any>[]
}, username: string, signal: AbortSignal): Promise<InstructionInterpretation> {
  const store = openExecutionStore(username)
  const id = input.identity.executionId
  const frames = new Map<string, any>()
  const forbidden = (): never => { throw new Error('Interpretation cannot mutate its active execution') }
  try {
    if (store.get(id).username !== username) throw new Error('Interpretation execution belongs to another profile')
    const read: GraphNodeExecution = {
      executionId: id, occurrenceId: `interpretation:${id}:${input.identity.revision}`,
      task: () => store.task(id), events: () => store.events(id), pendingEvents: () => [],
      activeExecutions: () => store.list(username).filter(record => record.executionId !== id && ['waiting', 'running'].includes(record.status))
        .map(record => ({ executionId: record.executionId, status: record.status, graphId: record.definition.graphId,
          waitingReason: record.waitingReason, task: store.task(record.executionId),
          instruction: store.entry(record.executionId).context.userMessage ?? '',
          canSteer: Boolean(store.entry(record.executionId).graph.scheduler.eventInputNodeId) })),
      frame: frameId => frames.get(frameId) ?? store.frame(id, frameId),
      recordFrames: supplied => { for (const frame of supplied) frames.set(frame.id, frame) },
      observationHistory: query => {
        const history = store.readObservationHistory(id, query)
        for (const frame of history.frames) frames.set(frame.id, frame)
        return history.observations
      },
      dispatch: forbidden, callGraph: forbidden, waitForEvent: forbidden, recordTask: forbidden, recordObservation: forbidden,
    }
    const loaded = await loadGraphForMode('environment', username)
    const graph = interpretationGraph(loaded.graph)
    const state = await executeGraph(graph, { ...input.context, username, userId: username,
      // Structured turn data preserves exact text and attribution; no new prompt directives.
      userMessage: input.turns.length === 1 ? input.turns[0].userMessage : JSON.stringify({ pendingTurns: input.turns }),
      environmentInterpretation: undefined, graphExecution: undefined,
    }, undefined, signal, undefined, read)
    signal.throwIfAborted()
    if (state.status !== 'completed') throw state.error ?? new Error('Instruction interpretation did not complete')
    return { ...input.identity, route: requireGraphNodeOutput(state, 'orchestrator_llm'),
      response: requireGraphNodeOutput(state, 'model_router').response,
      memory: state.nodes.get(graph.nodes.find(node => node.data.nodeType === 'memory_router')?.id ?? '')?.outputs }
  } finally { store.close() }
}
