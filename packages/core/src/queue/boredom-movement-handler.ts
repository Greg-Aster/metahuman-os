import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import {
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
  type EnvironmentObservation,
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

function anotherRobotCycleIsActive(currentTaskId: string): boolean {
  return getQueueManager().getAllTasks().some(candidate => (
    candidate.id !== currentTaskId
    && ['queued', 'leased', 'waiting'].includes(candidate.state)
    && (
      candidate.handler === 'workflow.robot-observer'
      || candidate.handler === 'workflow.boredom-movement'
      || hasRobotCycleMetadata(candidate.input)
    )
  ))
}

function movementInstruction(command: string): string {
  return `perform ${command}`
}

export async function executeBoredomMovementWork(
  task: QueuedTask,
  context: WorkHandlerContext,
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

  const commands = eligibleBoredomMovementCommands(
    session.latestObservation.capabilities.robotCommands,
  )
  if (commands.length === 0) {
    return { skipped: true, reason: 'stationary_command_catalog_unavailable', sessionId: session.sessionId }
  }
  const selectedCommand = chooseBoredomMovementCommand(commands)
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
    stationaryCommands: commands,
    selectedCommand,
  }
  const instruction = movementInstruction(selectedCommand)
  const now = new Date().toISOString()
  const observation: EnvironmentObservation = {
    ...session.latestObservation,
    timestamp: now,
    capabilities: {
      ...session.latestObservation.capabilities,
      actions: ['robotCommand'],
      robotCommands: [selectedCommand],
    },
    text: [{
      id: `boredom-movement:${cycleId}`,
      source: 'system',
      text: instruction,
      timestamp: now,
      metadata: { boredomMovement: true },
    }],
    metadata: {
      ...(session.latestObservation.metadata ?? {}),
      boredomMovement,
    },
  }
  const child = context.enqueue({
    type: 'environment_observation',
    handler: 'environment.observation',
    resource: 'system',
    source: task.source,
    priority: 'background',
    username: task.username,
    cognitiveMode: 'environment',
    input: {
      graph: config.graph,
      observation,
      triggeredBy: 'boredom-movement',
    },
    parentTaskId: task.id,
    correlationId: cycleId,
    idempotencyKey: `boredom-movement:${session.sessionId}:${cycleId}`,
    maxAttempts: 1,
    metadata: { producer: 'boredom-movement' },
  })
  audit({
    level: 'info',
    category: 'action',
    event: 'boredom_movement_environment_work_queued',
    actor: 'boredom-movement',
    details: {
      taskId: task.id,
      childTaskId: child.id,
      sessionId: session.sessionId,
      cycleId,
      triggerSource,
      stationaryCommands: commands,
      selectedCommand,
      mode,
    },
  })
  return {
    queued: true,
    childTaskId: child.id,
    sessionId: session.sessionId,
    selectedCommand,
    boredomMovement,
  }
}
