import type { UnifiedQueueManager } from './unified-queue-manager.js'
import type { QueuedTask, TaskInput, TaskType } from './types.js'
import {
  beginSleepSession,
  completeSleepSession,
  readSleepRuntimeState,
  SLEEP_RUNTIME_FILE,
  updateSleepStage,
  wakeSleepSession,
  type SleepSessionRuntime,
  type SleepStageDefinition,
} from '../sleep-runtime.js'

interface SleepWorkflowStage extends SleepStageDefinition {
  type: TaskType
  agentId: string
  args?: string[]
  maxAttempts: number
}

export interface SleepWorkflowMarker {
  sessionId: string
  parentTaskId: string
  stageId: string
  stageIndex: number
  totalStages: number
}

export const SLEEP_WORKFLOW_STAGES: readonly SleepWorkflowStage[] = [
  { id: 'organize-memory', displayName: 'Organize memories', type: 'memory_curate', handler: 'agent.organizer', agentId: 'organizer', args: ['--limit=20'], maxAttempts: 2 },
  { id: 'curate-memory', displayName: 'Curate training memories', type: 'training_curate', handler: 'agent.curator', agentId: 'curator', maxAttempts: 2 },
  { id: 'generate-desires', displayName: 'Generate desires', type: 'desire_generate', handler: 'agent.desire-generator', agentId: 'desire-generator', maxAttempts: 2 },
  { id: 'explore-desires', displayName: 'Explore desires', type: 'generic', handler: 'agent.desire-explorer', agentId: 'desire-explorer', maxAttempts: 2 },
  { id: 'plan-desires', displayName: 'Plan desires', type: 'generic', handler: 'agent.desire-planner', agentId: 'desire-planner', maxAttempts: 2 },
  { id: 'execute-desires', displayName: 'Execute approved desires', type: 'desire_execute', handler: 'agent.desire-executor', agentId: 'desire-executor', maxAttempts: 2 },
  { id: 'review-outcomes', displayName: 'Review desire outcomes', type: 'generic', handler: 'agent.desire-outcome-reviewer', agentId: 'desire-outcome-reviewer', maxAttempts: 2 },
  { id: 'dream', displayName: 'Dream from memories', type: 'dream', handler: 'agent.dreamer', agentId: 'dreamer', maxAttempts: 2 },
  { id: 'review-persona', displayName: 'Review persona learnings', type: 'psychoanalyze', handler: 'agent.psychoanalyzer', agentId: 'psychoanalyzer', maxAttempts: 2 },
  { id: 'rebuild-index', displayName: 'Refresh memory index', type: 'index_build', handler: 'agent.auto-indexer', agentId: 'auto-indexer', args: ['--single-user'], maxAttempts: 2 },
]

export const SLEEP_WORKFLOW_HANDLERS = new Set(SLEEP_WORKFLOW_STAGES.map(stage => stage.handler))

function markerFor(task: QueuedTask): SleepWorkflowMarker | null {
  const value = task.input?.sleepWorkflow
  if (!value || typeof value !== 'object') return null
  if (typeof value.sessionId !== 'string' || typeof value.stageId !== 'string') return null
  if (!Number.isInteger(value.stageIndex) || !Number.isInteger(value.totalStages)) return null
  return value as SleepWorkflowMarker
}

function stageInput(session: SleepSessionRuntime, stageIndex: number): TaskInput {
  const stage = SLEEP_WORKFLOW_STAGES[stageIndex]
  const marker: SleepWorkflowMarker = {
    sessionId: session.id,
    parentTaskId: session.parentTaskId,
    stageId: stage.id,
    stageIndex,
    totalStages: SLEEP_WORKFLOW_STAGES.length,
  }
  const usernameArgs = ['desire-generator', 'desire-planner', 'desire-executor', 'desire-outcome-reviewer'].includes(stage.agentId)
    ? ['--username', session.username]
    : []
  return {
    type: stage.type,
    handler: stage.handler,
    source: 'system',
    username: session.username,
    priority: 'background',
    input: {
      agentId: stage.agentId,
      args: [...(stage.args ?? []), ...usernameArgs],
      triggeredBy: 'sleep-workflow',
      sleepWorkflow: marker,
    },
    parentTaskId: session.parentTaskId,
    correlationId: session.id,
    idempotencyKey: `sleep:${session.id}:${stage.id}`,
    maxAttempts: stage.maxAttempts,
    metadata: { producer: 'sleep-workflow', sessionId: session.id, stageId: stage.id },
  }
}

function enqueueStage(
  enqueue: UnifiedQueueManager['enqueue'],
  session: SleepSessionRuntime,
  stageIndex: number,
): QueuedTask {
  const task = enqueue(stageInput(session, stageIndex))
  const stage = SLEEP_WORKFLOW_STAGES[stageIndex]
  updateSleepStage(session.id, stage.id, { state: 'queued', taskId: task.id })
  return task
}

export function beginSleepWorkflow(
  parent: QueuedTask,
  enqueue: UnifiedQueueManager['enqueue'],
): { sessionId: string; firstTaskId: string; stageCount: number; runtimeFile: string } | { skipped: true; reason: string } {
  const session = beginSleepSession({
    parentTaskId: parent.id,
    username: parent.username,
    source: parent.source,
    reason: parent.source === 'user' || parent.input.force === true ? 'manual' : 'scheduled',
    stages: SLEEP_WORKFLOW_STAGES,
  })
  if (!session) return { skipped: true, reason: 'sleep_already_active' }
  try {
    const first = enqueueStage(enqueue, session, 0)
    return { sessionId: session.id, firstTaskId: first.id, stageCount: SLEEP_WORKFLOW_STAGES.length, runtimeFile: SLEEP_RUNTIME_FILE }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateSleepStage(session.id, SLEEP_WORKFLOW_STAGES[0].id, { state: 'failed', completedAt: new Date().toISOString(), error: message })
    wakeSleepSession(`Sleep workflow could not queue its first stage: ${message}`)
    throw error
  }
}

export function markSleepStageRunning(task: QueuedTask): void {
  const marker = markerFor(task)
  if (!marker) return
  updateSleepStage(marker.sessionId, marker.stageId, {
    state: 'running',
    taskId: task.id,
    startedAt: new Date().toISOString(),
  })
}

export function advanceSleepWorkflow(
  manager: UnifiedQueueManager,
  task: QueuedTask,
  outcome: 'completed' | 'failed',
  error?: string,
): QueuedTask | null {
  const marker = markerFor(task)
  if (!marker) return null
  const session = readSleepRuntimeState().currentSession
  if (!session || session.id !== marker.sessionId || session.state !== 'running') return null
  updateSleepStage(marker.sessionId, marker.stageId, {
    state: outcome,
    completedAt: new Date().toISOString(),
    error,
  })
  if (marker.stageIndex + 1 >= marker.totalStages) {
    completeSleepSession(marker.sessionId)
    return null
  }
  const current = readSleepRuntimeState().currentSession
  if (!current || current.id !== marker.sessionId) return null
  const nextIndex = marker.stageIndex + 1
  try {
    return enqueueStage(manager.enqueue.bind(manager), current, nextIndex)
  } catch (enqueueError) {
    const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
    updateSleepStage(marker.sessionId, SLEEP_WORKFLOW_STAGES[nextIndex].id, {
      state: 'failed',
      completedAt: new Date().toISOString(),
      error: message,
    })
    wakeSleepSession(`Sleep workflow could not queue ${SLEEP_WORKFLOW_STAGES[nextIndex].displayName}: ${message}`)
    throw enqueueError
  }
}
