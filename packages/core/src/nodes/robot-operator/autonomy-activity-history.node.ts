import { defineNode } from '../types.js'
import { getQueueManager } from '../../queue/unified-queue-manager.js'
import type { QueuedTask } from '../../queue/types.js'

export interface RobotAutonomyActivityRecord {
  taskId: string
  capabilityId: string
  handler: string
  state: QueuedTask['state']
  createdAt: string
  completedAt?: string
  correlationId?: string
  instruction?: string
  reason?: string
  observationSummary?: string
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(20, Math.trunc(parsed)))
    : 10
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function compactEffect(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, unknown> = {}
  const actionQueue = isRecord(value.actionQueue) ? value.actionQueue : null
  if (actionQueue) {
    result.actionQueue = {
      status: cleanText(actionQueue.status, 100),
      reason: cleanText(actionQueue.reason, 300),
      queuedCount: typeof actionQueue.queuedCount === 'number' ? actionQueue.queuedCount : 0,
      rejectedCount: typeof actionQueue.rejectedCount === 'number' ? actionQueue.rejectedCount : 0,
      commands: Array.isArray(actionQueue.commands)
        ? actionQueue.commands.filter(isRecord).slice(0, 4).map(command => ({
            id: cleanText(command.id, 200),
            type: cleanText(command.type, 80),
            command: cleanText(command.command, 120),
            direction: cleanText(command.direction, 80),
            target: cleanText(command.target, 200),
            status: cleanText(command.status, 80),
            ...(typeof command.units === 'number' ? { units: command.units } : {}),
          }))
        : [],
    }
  }
  const delegation = isRecord(value.executorDelegation) ? value.executorDelegation : null
  if (delegation) {
    result.executorDelegation = {
      queued: delegation.queued === true,
      taskId: cleanText(delegation.taskId, 200),
      status: cleanText(delegation.status, 100),
    }
  }
  const evaluation = isRecord(value.objectiveEvaluation) ? value.objectiveEvaluation : null
  if (evaluation) {
    result.objectiveEvaluation = {
      outcome: cleanText(evaluation.outcome ?? evaluation.overallObjectiveState, 80),
      reason: cleanText(evaluation.reason, 500),
      objective: cleanText(evaluation.objective, 1_000),
      observationSummary: cleanText(evaluation.observationSummary, 500),
      completionEvidence: cleanText(evaluation.completionEvidence, 1_000),
      requiredCompletionBasis: cleanText(evaluation.requiredCompletionBasis, 100),
      ...(typeof evaluation.objectiveComplete === 'boolean'
        ? { objectiveComplete: evaluation.objectiveComplete }
        : {}),
    }
  }
  if (typeof value.robotStatusPersisted === 'boolean') {
    result.robotStatusPersisted = value.robotStatusPersisted
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function compactResult(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, unknown> = {}
  for (const key of ['agentId', 'graph', 'status', 'reason']) {
    const text = cleanText(value[key], 300)
    if (text) result[key] = text
  }
  for (const key of ['persisted', 'recorded', 'queued', 'skipped']) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  const effect = compactEffect(value.effect)
  if (effect) result.effect = effect
  const dispatch = isRecord(value.dispatch) ? value.dispatch : null
  if (dispatch) {
    result.dispatch = {
      queued: dispatch.queued === true,
      taskId: cleanText(dispatch.taskId, 200),
      status: cleanText(dispatch.status, 100),
    }
  }
  const decision = isRecord(value.decision) ? value.decision : null
  if (decision) {
    result.decision = {
      taskId: cleanText(decision.taskId, 100),
      reason: cleanText(decision.reason, 500),
      observationSummary: cleanText(decision.observationSummary, 500),
      instruction: cleanText(decision.instruction, 1_000),
      responseAuthored: decision.responseAuthored === true,
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Select terminal receipts for work chosen by Full autonomy. It reports what
 * ran or failed and never chooses, suppresses, or schedules future activity.
 */
export function summarizeRobotAutonomyActivity(
  tasks: QueuedTask[],
  username: string,
): RobotAutonomyActivityRecord[] {
  const terminalStates = new Set<QueuedTask['state']>(['completed', 'failed', 'cancelled', 'expired'])
  return tasks
    .filter(task => {
      if (
        task.username !== username
        || task.source !== 'autonomy'
        || !terminalStates.has(task.state)
      ) return false
      const operatorContext = isRecord(task.input.robotOperatorContext)
        ? task.input.robotOperatorContext
        : null
      const observer = isRecord(operatorContext?.robotObserver)
        ? operatorContext.robotObserver
        : null
      if (task.input.triggeredBy === 'robot-autonomy-controller'
        || observer?.requestedBy === 'robot-autonomy-controller'
      ) return true
      if (task.handler !== 'workflow.robot-autonomy-controller') return false
      const result = isRecord(task.result) ? task.result : null
      const dispatch = isRecord(result?.dispatch) ? result.dispatch : null
      return task.state === 'failed' || dispatch?.queued !== true
    })
    .reverse()
    .map(task => {
      const operatorContext = isRecord(task.input.robotOperatorContext)
        ? task.input.robotOperatorContext
        : null
      const controllerDecision = isRecord(operatorContext?.controllerDecision)
        ? operatorContext.controllerDecision
        : isRecord(operatorContext?.plannerDecision)
          ? operatorContext.plannerDecision
          : null
      const rawResult = isRecord(task.result) ? task.result : null
      const controllerReceipt = task.handler === 'workflow.robot-autonomy-controller'
        && isRecord(rawResult?.decision)
        ? rawResult.decision
        : null
      const agentId = cleanText(task.input.agentId, 100)
      const capabilityId = cleanText(controllerReceipt?.taskId, 100)
        || agentId
        || (task.handler === 'environment.observation'
          ? 'robot-autonomy-executor'
          : task.handler)
      const ownResult = compactResult(task.result)
      const correlatedEffect = task.correlationId
        ? tasks.find(candidate => (
            candidate.id !== task.id
            && candidate.correlationId === task.correlationId
            && isRecord(candidate.result)
            && isRecord(candidate.result.effect)
          ))
        : null
      const downstreamEffect = compactEffect(correlatedEffect?.result?.effect)
      const result = ownResult || downstreamEffect
        ? {
            ...(ownResult ?? {}),
            ...(downstreamEffect ? { downstreamEffect } : {}),
          }
        : undefined
      const errorCode = cleanText(task.error?.code, 100)
      const errorMessage = cleanText(task.error?.message, 500)
      const instruction = cleanText(controllerDecision?.instruction, 1_000)
      const reason = cleanText(controllerDecision?.reason, 500)
      const observationSummary = cleanText(
        controllerDecision?.observationSummary ?? controllerDecision?.observed,
        500,
      )
      return {
        taskId: task.id,
        capabilityId,
        handler: task.handler,
        state: task.state,
        createdAt: task.createdAt,
        ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        ...(task.correlationId ? { correlationId: task.correlationId } : {}),
        ...(instruction ? { instruction } : {}),
        ...(reason ? { reason } : {}),
        ...(observationSummary ? { observationSummary } : {}),
        ...(result ? { result } : {}),
        ...(errorCode || errorMessage
          ? { error: { code: errorCode || 'failed', message: errorMessage || 'Task failed' } }
          : {}),
      }
    })
}

export const robotAutonomyActivityHistoryNode = defineNode({
  id: 'robot_autonomy_activity_history',
  name: 'Recent Autonomy Activity',
  category: 'operator',
  inputs: [],
  outputs: [
    { name: 'history', type: 'array', description: 'Recent terminal tasks selected by the Full-autonomy Controller' },
    { name: 'count', type: 'number', description: 'Number of task receipts supplied' },
  ],
  properties: { limit: 10 },
  propertySchemas: {
    limit: {
      type: 'slider',
      default: 10,
      label: 'Task Receipt Limit',
      description: 'Maximum prior Controller-selected task receipts supplied to this decision',
      min: 1,
      max: 20,
      step: 1,
    },
  },
  description: 'Reads bounded terminal receipts directly from canonical Work Coordinator history for tasks previously selected by Full autonomy. It does not read conversation, choose a task, or schedule work.',
  async execute(_inputs, context, properties) {
    const username = cleanText(context.username, 160)
    const supplied = username
      ? summarizeRobotAutonomyActivity(getQueueManager().getHistory(), username)
      : []
    const history = supplied.slice(-boundedLimit(properties?.limit))
    return { history, count: history.length }
  },
})
