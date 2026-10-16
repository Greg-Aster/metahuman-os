import { readRobotStatusLive } from '../robot-status-live.js'
import { readEnvironmentBridgeState } from '../environment-interface/store.js'
import { openExecutionStore } from '../durable-execution/storage.js'
import { ExecutionCheckpointer } from '../durable-execution/checkpointer.js'
import { executionEventContext } from '../nodes/utility/execution-context.node.js'
import type { ExecutionEvent, ExecutionObjective, ExecutionRecord } from '../durable-execution/types.js'

type SavedNode = {
  nodeId?: string; definition?: { type?: string }; status?: string;
  startTime?: number; endTime?: number; outputs?: Record<string, any>;
}
type SavedCheckpoint = { namespace: string; checkpointId: string; nodes: Array<[string, SavedNode]> }

/** Project retained decisions separately from their actual returned evidence. */
export function projectDesireExecutionEvidence(
  record: ExecutionRecord,
  admission: { context?: Record<string, any> },
  task: ExecutionObjective | null,
  events: ExecutionEvent[],
  checkpoints: SavedCheckpoint[],
) {
  const instructions: Array<Record<string, unknown>> = []
  const selections: Array<Record<string, unknown>> = []
  for (const checkpoint of checkpoints) {
    for (const [nodeId, node] of checkpoint.nodes) {
      const output = node.outputs
      if (!output || node.status !== 'completed') continue
      const provenance = { nodeId, nodeType: node.definition?.type, checkpointId: checkpoint.checkpointId,
        namespace: checkpoint.namespace, startedAt: node.startTime, completedAt: node.endTime }
      if (node.definition?.type === 'user_input') {
        instructions.push({ ...provenance, message: output.message, entry: output.entry,
          instructionSource: output.instructionSource })
      } else if (node.definition?.type === 'environment_event_request') {
        instructions.push({ ...provenance, message: output.message, plannerDecision: output.plannerDecision })
      }
      if (node.definition?.type === 'environment_task_planner') {
        selections.push({ ...provenance, program: output.program, taskDecision: output.taskDecision,
          selection: output.selection, valid: output.valid, error: output.error })
      }
    }
  }
  const byTime = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.startedAt ?? 0) - Number(b.startedAt ?? 0)
  return {
    executionId: record.executionId, source: 'durable-execution', graph: record.definition.graphId,
    status: record.status, waitingReason: record.waitingReason,
    createdAt: record.createdAt, updatedAt: record.updatedAt, cancelledAt: record.cancelledAt,
    admittedInput: { userMessage: admission.context?.userMessage, userMessageEntry: admission.context?.userMessageEntry,
      bodyEventDecision: admission.context?.bodyEventDecision, autonomyDecision: admission.context?.autonomyDecision },
    instructions: instructions.sort(byTime), selections: selections.sort(byTime),
    task, events: executionEventContext(events),
  }
}

/** Read existing selected-body facts and only current or explicitly linked executions. */
export async function readDesireOperationalContext(
  username: string,
  options: { executionIds?: string[]; sessionId?: string } = {},
) {
  const robotStatus = await readRobotStatusLive(username, options.sessionId)
  const bridge = readEnvironmentBridgeState()
  const session = robotStatus.sessionId ? bridge.sessions[robotStatus.sessionId] : undefined
  const ids = new Set([
    ...(options.executionIds ?? []),
    ...robotStatus.executions.map(execution => execution.executionId),
  ])
  const store = openExecutionStore(username)
  const executions: ReturnType<typeof projectDesireExecutionEvidence>[] = []
  const unavailableExecutionIds: string[] = []
  try {
    const known = new Map(store.list(username).map(record => [record.executionId, record]))
    for (const id of ids) {
      const record = known.get(id)
      if (!record) { unavailableExecutionIds.push(id); continue }
      const reader = new ExecutionCheckpointer(store, { executionId: id, generation: 0, owner: 'desire-context-read' })
      const checkpoints = await reader.completedNodeOccurrences({
        user_input: ['message', 'entry', 'instructionSource'],
        environment_event_request: ['message', 'plannerDecision'],
        environment_task_planner: ['program', 'taskDecision', 'selection', 'valid', 'error'],
      })
      executions.push(projectDesireExecutionEvidence(record, store.entry(id), store.task(id), store.events(id), checkpoints))
    }
  } finally { store.close() }
  return { readAt: robotStatus.readAt, robotStatus,
    capabilities: session?.latestObservation ? {
      source: 'environment-bridge', sessionId: session.sessionId,
      observedAt: session.latestObservation.timestamp, values: session.latestObservation.capabilities,
    } : null,
    executions, unavailableExecutionIds, freshEventReferences: [] as string[] }
}
