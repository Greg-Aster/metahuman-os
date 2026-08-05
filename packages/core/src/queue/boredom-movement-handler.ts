import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import {
  enqueueEnvironmentAction,
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
} from '../environment-interface/index.js'
import {
  chooseBoredomMovementCommand,
  eligibleBoredomMovementCommands,
  isBoredomMovementEnabled,
  loadRobotOperatorConfig,
  robotObserverSourceAllowed,
  type BoredomMovementMetadata,
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

function hasRobotCycleMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, any>
  return Boolean(
    record.metadata?.robotObserver
    || record.metadata?.boredomMovement
    || record.observation?.metadata?.robotObserver
    || record.observation?.metadata?.boredomMovement,
  )
}

export function workBlocksBoredomMovement(task: QueuedTask, currentTaskId: string): boolean {
  if (task.id === currentTaskId) return false
  if (!['queued', 'leased', 'waiting'].includes(task.state)) return false
  return task.handler === 'environment.observation'
    || task.handler === 'environment.command'
    || task.handler === 'workflow.robot-observer'
    || task.handler === 'workflow.boredom-movement'
    || hasRobotCycleMetadata(task.input)
}

function anotherRobotCycleIsActive(currentTaskId: string): boolean {
  return getQueueManager().getAllTasks().some(candidate => workBlocksBoredomMovement(candidate, currentTaskId))
}

export async function executeBoredomMovementWork(
  task: QueuedTask,
  _context: WorkHandlerContext,
): Promise<Record<string, unknown>> {
  const manual = task.source === 'user'
  const triggerSource = manual ? 'user' : 'autonomy'
  const mode = getOperatorMode()
  if (!robotObserverSourceAllowed(mode, triggerSource)) {
    return { skipped: true, reason: 'active_operator_reactive', mode }
  }
  if (!isBoredomMovementEnabled()) {
    return { skipped: true, reason: 'boredom_movement_disabled' }
  }
  if (anotherRobotCycleIsActive(task.id)) {
    return { skipped: true, reason: 'robot_cycle_active' }
  }

  const config = loadRobotOperatorConfig()
  const summary = summarizeEnvironmentBridgeState()
  if (!summary.enabled) return { skipped: true, reason: 'environment_bridge_disabled' }

  const requestedSession = requestedSessionId(task, config.sessionId)
  const session = summary.sessions
    .filter(candidate => candidate.status === 'connected')
    .find(candidate => !requestedSession || candidate.sessionId === requestedSession)
  if (!session?.latestObservation) {
    return { skipped: true, reason: 'no_connected_robot_session', sessionId: requestedSession }
  }
  if (getEnvironmentActionSubscriberCount(session.sessionId) < 1) {
    return { skipped: true, reason: 'robot_action_stream_unavailable', sessionId: session.sessionId }
  }
  if (!session.latestObservation.capabilities.actions.includes('robotCommand')) {
    return { skipped: true, reason: 'robot_commands_unavailable', sessionId: session.sessionId }
  }
  if (
    !session.latestObservation.capabilities.visual
    || !session.latestObservation.capabilities.actions.includes('captureImage')
  ) {
    return { skipped: true, reason: 'robot_camera_unavailable', sessionId: session.sessionId }
  }

  const eligibleCommands = eligibleBoredomMovementCommands(
    session.latestObservation.capabilities.robotCommands,
  )
  if (eligibleCommands.length === 0) {
    return { skipped: true, reason: 'stationary_command_catalog_unavailable', sessionId: session.sessionId }
  }
  const selectedCommand = chooseBoredomMovementCommand(eligibleCommands)
  if (!selectedCommand) {
    return { skipped: true, reason: 'stationary_command_selection_failed', sessionId: session.sessionId }
  }

  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : randomUUID()
  const boredomMovement: BoredomMovementMetadata = {
    cycleId,
    triggerSource,
    requestedBy: 'boredom-movement',
    graph: config.boredomGraph,
    selectedCommand,
  }
  const command = enqueueEnvironmentAction({
    type: 'robotCommand',
    command: selectedCommand,
    sessionId: session.sessionId,
    createdAt: new Date().toISOString(),
    metadata: { boredomMovement },
  }, {
    username: task.username,
    source: triggerSource,
    correlationId: cycleId,
    idempotencyKey: `boredom-movement:${session.sessionId}:${cycleId}:movement`,
    allowedActions: ['robotCommand'],
  })
  audit({
    level: 'info',
    category: 'action',
    event: 'boredom_movement_command_queued',
    actor: 'boredom-movement',
    details: {
      taskId: task.id,
      commandId: command.id,
      sessionId: session.sessionId,
      cycleId,
      triggerSource,
      selectedCommand,
      eligibleCommands,
      mode,
    },
  })
  return {
    queued: true,
    commandId: command.id,
    sessionId: session.sessionId,
    selectedCommand,
    boredomMovement,
  }
}
