import { openExecutionStore } from '../durable-execution/storage.js'
import { ExecutionCheckpointer } from '../durable-execution/checkpointer.js'
import type { NodeExecutionState } from '../graph-executor.js'
import type { ActivationAssessment } from './activation.js'

/** Read committed assessments from the existing execution owner; no second history store. */
export async function readActivationAssessments(username: string, count: number): Promise<ActivationAssessment[]> {
  const store = openExecutionStore(username)
  try {
    const assessments: ActivationAssessment[] = []
    const reader = new ExecutionCheckpointer(store, { executionId: '', generation: 0, owner: 'read-only' })
    const records = store.iterate(username, true)
    for (const record of records) {
      // Legacy controller decisions predate activation assessments. Select the
      // owning graph from its definition before opening large saved payloads.
      if (!Object.hasOwn(record.definition.nodeVersions, 'active_operator_dispatch')) continue
      const entry = store.entry(record.executionId)
      if (entry.context?.robotOperatorContext?.robotObserver?.requestedBy !== 'robot-autonomy-controller') continue
      const saved = await reader.getTuple({ configurable: { thread_id: record.executionId } })
      const nodes = (saved?.checkpoint.channel_values.nodeEntries ?? []) as Array<[string, NodeExecutionState]>
      const assessment = nodes.find(([, node]) => node.definition?.type === 'robot_autonomy_controller_parser'
        && node.status === 'completed')?.[1].outputs?.assessment as ActivationAssessment | undefined
      if (!assessment) continue
      assessments.push(assessment)
      if (assessments.length >= count) break
    }
    return assessments
  } finally { store.close() }
}
