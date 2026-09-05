import type { UnifiedQueueManager } from './unified-queue-manager.js'
import type { QueuedTask, TaskInput, TaskType } from './types.js'
import { getTriggerConfigService } from './trigger-config-service.js'
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

export interface SleepWorkflowStage extends SleepStageDefinition {
  type: TaskType
  agentId?: string
  args?: string[]
  maxAttempts: number
}

export type SleepStageEnabled = (stage: SleepWorkflowStage) => boolean

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
  { id: 'plan-desires', displayName: 'Plan desires', type: 'generic', handler: 'agent.desire-planner', agentId: 'desire-planner', maxAttempts: 2 },
  { id: 'execute-desires', displayName: 'Execute approved desires', type: 'desire_execute', handler: 'agency.desire-execute', agentId: 'desire-executor', maxAttempts: 1 },
  { id: 'review-outcomes', displayName: 'Review desire outcomes', type: 'desire_review', handler: 'agency.desire-outcome-review', agentId: 'desire-outcome-reviewer', maxAttempts: 1 },
  { id: 'dream', displayName: 'Dream from memories', type: 'dream', handler: 'agent.dreamer', agentId: 'dreamer', maxAttempts: 2 },
  { id: 'review-persona', displayName: 'Review persona learnings', type: 'psychoanalyze', handler: 'agent.psychoanalyzer', agentId: 'psychoanalyzer', maxAttempts: 2 },
  { id: 'rebuild-index', displayName: 'Refresh memory index', type: 'index_build', handler: 'vector.index-build', maxAttempts: 2 },
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
  const usesAgentProcess = stage.handler.startsWith('agent.')
  const args = stage.args ?? []
  return {
    type: stage.type,
    handler: stage.handler,
    source: 'system',
    username: session.username,
    priority: 'background',
    input: {
      ...(usesAgentProcess && stage.agentId ? { agentId: stage.agentId } : {}),
      ...(args.length > 0 ? { args } : {}),
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

function catalogStageEnabled(): SleepStageEnabled {
  const agents = getTriggerConfigService().load(false).config.agents
  const psychoanalyzer = agents.psychoanalyzer
  if (!psychoanalyzer) throw new Error('Sleep Workflow Psychoanalyzer stage has no Agent Catalog entry')
  return stage => {
    if (stage.agentId !== 'psychoanalyzer') return true
    return psychoanalyzer.enabled
  }
}

function findNextEnabledStage(
  sessionId: string,
  startIndex: number,
  isStageEnabled: SleepStageEnabled,
): number | null {
  for (let stageIndex = startIndex; stageIndex < SLEEP_WORKFLOW_STAGES.length; stageIndex++) {
    const stage = SLEEP_WORKFLOW_STAGES[stageIndex]
    if (isStageEnabled(stage)) return stageIndex
    updateSleepStage(sessionId, stage.id, {
      state: 'skipped',
      completedAt: new Date().toISOString(),
      error: 'Disabled in Agent Catalog',
    })
  }
  return null
}

export function beginSleepWorkflow(
  parent: QueuedTask,
  enqueue: UnifiedQueueManager['enqueue'],
  isStageEnabled?: SleepStageEnabled,
): { sessionId: string; firstTaskId: string; stageCount: number; runtimeFile: string } | { skipped: true; reason: string } {
  const session = beginSleepSession({
    parentTaskId: parent.id,
    username: parent.username,
    source: parent.source,
    reason: parent.source === 'user' || parent.input.force === true ? 'manual' : 'scheduled',
    stages: SLEEP_WORKFLOW_STAGES,
  })
  if (!session) return { skipped: true, reason: 'sleep_already_active' }
  const stageEnabled = isStageEnabled ?? catalogStageEnabled()
  let firstIndex = 0
  try {
    const resolvedIndex = findNextEnabledStage(session.id, 0, stageEnabled)
    if (resolvedIndex === null) {
      completeSleepSession(session.id)
      return { skipped: true, reason: 'no_enabled_sleep_stages' }
    }
    firstIndex = resolvedIndex
    const current = readSleepRuntimeState().currentSession
    if (!current || current.id !== session.id) throw new Error('Sleep Workflow session disappeared before first-stage admission')
    const first = enqueueStage(enqueue, current, firstIndex)
    return { sessionId: session.id, firstTaskId: first.id, stageCount: SLEEP_WORKFLOW_STAGES.length, runtimeFile: SLEEP_RUNTIME_FILE }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateSleepStage(session.id, SLEEP_WORKFLOW_STAGES[firstIndex].id, { state: 'failed', completedAt: new Date().toISOString(), error: message })
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
  isStageEnabled?: SleepStageEnabled,
): QueuedTask | null {
  const marker = markerFor(task)
  if (!marker) return null
  const session = readSleepRuntimeState().currentSession
  if (!session || session.id !== marker.sessionId || session.state !== 'running') return null
  const stageEnabled = isStageEnabled ?? catalogStageEnabled()
  updateSleepStage(marker.sessionId, marker.stageId, {
    state: outcome,
    completedAt: new Date().toISOString(),
    error,
  })
  let nextIndex = marker.stageIndex + 1
  try {
    const resolvedIndex = findNextEnabledStage(marker.sessionId, nextIndex, stageEnabled)
    if (resolvedIndex === null) {
      completeSleepSession(marker.sessionId)
      return null
    }
    nextIndex = resolvedIndex
    const current = readSleepRuntimeState().currentSession
    if (!current || current.id !== marker.sessionId) return null
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
