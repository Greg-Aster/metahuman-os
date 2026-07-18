import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import {
  enqueueEnvironmentAction,
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
} from '../environment-interface/index.js'
import {
  loadRobotOperatorConfig,
  isRobotObserverEnabled,
  robotObserverSourceAllowed,
  type RobotObserverCycleMetadata,
} from '../robot-operator.js'
import { getQueueManager } from './unified-queue-manager.js'
import type { QueuedTask } from './types.js'
import type { WorkHandlerContext } from './execution-engine.js'

function requestedSessionId(task: QueuedTask, configuredSessionId?: string): string | undefined {
  if (typeof task.input.sessionId === 'string' && task.input.sessionId.trim()) return task.input.sessionId.trim()
  const args = Array.isArray(task.input.args) ? task.input.args : []
  const sessionArg = args.find((value: unknown) => typeof value === 'string' && value.startsWith('--session='))
  return typeof sessionArg === 'string' ? sessionArg.slice('--session='.length).trim() : configuredSessionId
}

function hasObserverMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, any>
  return Boolean(
    record.metadata?.robotObserver
    || record.metadata?.boredomMovement
    || record.observation?.metadata?.robotObserver
    || record.observation?.metadata?.boredomMovement,
  )
}

function anotherObserverCycleIsActive(currentTaskId: string): boolean {
  return getQueueManager().getAllTasks().some(candidate => (
    candidate.id !== currentTaskId
    && ['queued', 'leased', 'waiting'].includes(candidate.state)
    && (
      candidate.handler === 'workflow.robot-observer'
      || candidate.handler === 'workflow.boredom-movement'
      || hasObserverMetadata(candidate.input)
    )
  ))
}

export async function executeRobotObserverWork(
  task: QueuedTask,
  _context: WorkHandlerContext,
): Promise<Record<string, unknown>> {
  const manual = task.source === 'user'
  const mode = getOperatorMode()
  if (!robotObserverSourceAllowed(mode, manual ? 'user' : 'autonomy')) {
    return { skipped: true, reason: 'active_operator_reactive', mode }
  }
  if (!isRobotObserverEnabled()) {
    return { skipped: true, reason: 'robot_observer_disabled' }
  }
  if (anotherObserverCycleIsActive(task.id)) {
    return { skipped: true, reason: 'robot_observer_cycle_active' }
  }

  const config = loadRobotOperatorConfig()
  const summary = summarizeEnvironmentBridgeState()
  if (!summary.enabled) return { skipped: true, reason: 'environment_bridge_disabled' }

  const requestedSession = requestedSessionId(task, config.sessionId)
  const session = summary.sessions
    .filter(candidate => candidate.status === 'connected')
    .find(candidate => !requestedSession || candidate.sessionId === requestedSession)
  if (!session) return { skipped: true, reason: 'no_connected_robot_session', sessionId: requestedSession }
  if (!session.latestObservation?.capabilities.visual) {
    return { skipped: true, reason: 'robot_camera_unavailable', sessionId: session.sessionId }
  }
  if (getEnvironmentActionSubscriberCount(session.sessionId) < 1) {
    return { skipped: true, reason: 'robot_action_stream_unavailable', sessionId: session.sessionId }
  }

  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : randomUUID()
  const cycle: RobotObserverCycleMetadata = {
    cycleId,
    step: 1,
    maxSteps: config.maxCycleSteps,
    triggerSource: manual ? 'user' : 'autonomy',
    graph: config.graph,
    requestedBy: 'robot-observer',
  }
  const command = enqueueEnvironmentAction(
    {
      type: 'captureImage',
      sessionId: session.sessionId,
      createdAt: new Date().toISOString(),
      metadata: { robotObserver: cycle },
    },
    {
      username: task.username,
      source: cycle.triggerSource,
      correlationId: cycleId,
      idempotencyKey: `robot-observer:${session.sessionId}:${cycleId}:1`,
    },
  )
  audit({
    level: 'info',
    category: 'action',
    event: 'robot_observer_capture_queued',
    actor: 'robot-observer',
    details: {
      taskId: task.id,
      commandId: command.id,
      sessionId: session.sessionId,
      cycleId,
      triggerSource: cycle.triggerSource,
      mode,
    },
  })
  return {
    queued: true,
    commandId: command.id,
    sessionId: session.sessionId,
    cycle,
  }
}
