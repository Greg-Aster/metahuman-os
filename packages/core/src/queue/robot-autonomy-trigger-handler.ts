import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import {
  enqueueEnvironmentAction,
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
  type EnvironmentObservation,
} from '../environment-interface/index.js'
import {
  buildRobotOperatorInstruction,
  isRobotOperatorChildEnabled,
  loadRobotOperatorConfig,
  robotObserverSourceAllowed,
  robotOperatorChildGraph,
  robotOperatorChildMaxSteps,
  type RobotObserverCycleMetadata,
  type RobotOperatorStimulusAgent,
} from '../robot-operator.js'
import { getQueueManager } from './unified-queue-manager.js'
import type { QueuedTask } from './types.js'
import type { WorkHandlerContext } from './execution-engine.js'

const HANDLERS = new Set([
  'workflow.robot-observer',
  'workflow.boredom-observer',
  'workflow.boredom-movement',
  'workflow.boredom-reflection',
])

function requestedSessionId(task: QueuedTask, configuredSessionId?: string): string | undefined {
  if (typeof task.input.sessionId === 'string' && task.input.sessionId.trim()) return task.input.sessionId.trim()
  const args = Array.isArray(task.input.args) ? task.input.args : []
  const sessionArg = args.find((value: unknown) => typeof value === 'string' && value.startsWith('--session='))
  return typeof sessionArg === 'string' ? sessionArg.slice('--session='.length).trim() : configuredSessionId
}

function hasObserverMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, any>
  return Boolean(record.metadata?.robotObserver || record.observation?.metadata?.robotObserver)
}

function stimulusAgent(task: QueuedTask): RobotOperatorStimulusAgent {
  if (task.handler === 'workflow.boredom-reflection' || task.input.agentId === 'boredom-reflection') {
    return 'boredom-reflection'
  }
  if (task.handler === 'workflow.boredom-movement' || task.input.agentId === 'boredom-movement') {
    return 'boredom-movement'
  }
  return 'boredom-observer'
}

function anotherRobotAutonomyCycleIsActive(currentTaskId: string): boolean {
  return getQueueManager().getAllTasks().some(candidate => (
    candidate.id !== currentTaskId
    && ['queued', 'leased', 'waiting'].includes(candidate.state)
    && (HANDLERS.has(candidate.handler) || hasObserverMetadata(candidate.input))
  ))
}

export function buildRobotAutonomyStimulus(
  latest: EnvironmentObservation,
  cycle: RobotObserverCycleMetadata,
  agentId: RobotOperatorStimulusAgent,
): EnvironmentObservation {
  return {
    environmentId: latest.environmentId,
    adapter: latest.adapter,
    sessionId: latest.sessionId,
    timestamp: new Date().toISOString(),
    capabilities: latest.capabilities,
    metadata: {
      robotObserver: cycle,
      correlationId: cycle.cycleId,
      autonomousStimulus: agentId,
      currentVisualEvidence: false,
      sourceObservationAt: latest.timestamp,
    },
  }
}

export async function executeRobotAutonomyTriggerWork(
  task: QueuedTask,
  context: WorkHandlerContext,
): Promise<Record<string, unknown>> {
  const agentId = stimulusAgent(task)
  const manual = task.source === 'user'
  const mode = getOperatorMode()
  if (!robotObserverSourceAllowed(mode, manual ? 'user' : 'autonomy')) {
    return { skipped: true, reason: 'active_operator_reactive', mode, agentId }
  }
  if (!isRobotOperatorChildEnabled(agentId)) {
    return { skipped: true, reason: `${agentId.replace(/-/g, '_')}_disabled`, agentId }
  }
  if (anotherRobotAutonomyCycleIsActive(task.id)) {
    return { skipped: true, reason: 'robot_autonomy_cycle_active', agentId }
  }

  const config = loadRobotOperatorConfig()
  const summary = summarizeEnvironmentBridgeState()
  if (!summary.enabled) return { skipped: true, reason: 'environment_bridge_disabled', agentId }

  const requestedSession = requestedSessionId(task, config.sessionId)
  const session = summary.sessions
    .filter(candidate => candidate.status === 'connected')
    .find(candidate => !requestedSession || candidate.sessionId === requestedSession)
  if (!session?.latestObservation) {
    return { skipped: true, reason: 'no_connected_robot_session', sessionId: requestedSession, agentId }
  }
  if (agentId === 'boredom-observer' && !session.latestObservation.capabilities.visual) {
    return { skipped: true, reason: 'robot_camera_unavailable', sessionId: session.sessionId, agentId }
  }
  if (getEnvironmentActionSubscriberCount(session.sessionId) < 1) {
    return { skipped: true, reason: 'robot_action_stream_unavailable', sessionId: session.sessionId, agentId }
  }

  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : randomUUID()
  const suppliedInstruction = typeof task.input.operatorInstruction === 'string'
    ? task.input.operatorInstruction.trim().slice(0, 8_000)
    : ''
  const cycle: RobotObserverCycleMetadata = {
    cycleId,
    step: 1,
    maxSteps: robotOperatorChildMaxSteps(config, agentId),
    triggerSource: manual ? 'user' : 'autonomy',
    graph: robotOperatorChildGraph(config, agentId),
    requestedBy: agentId,
    instruction: suppliedInstruction || buildRobotOperatorInstruction(agentId),
  }

  if (agentId === 'boredom-observer') {
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
        idempotencyKey: `${agentId}:${session.sessionId}:${cycleId}:1`,
      },
    )
    audit({
      level: 'info',
      category: 'action',
      event: 'robot_operator_observer_capture_queued',
      actor: agentId,
      details: { taskId: task.id, commandId: command.id, sessionId: session.sessionId, cycleId, mode },
    })
    return { queued: true, commandId: command.id, sessionId: session.sessionId, agentId, cycle }
  }

  const observation = buildRobotAutonomyStimulus(session.latestObservation, cycle, agentId)
  const cognitionTask = context.enqueue({
    type: 'environment_observation',
    handler: 'environment.observation',
    resource: 'local-llm',
    source: cycle.triggerSource,
    priority: cycle.triggerSource === 'user' ? 'high' : 'background',
    input: { observation, graph: cycle.graph },
    username: task.username,
    cognitiveMode: 'environment',
    parentTaskId: task.id,
    correlationId: cycleId,
    idempotencyKey: `${agentId}:${session.sessionId}:${cycleId}:stimulus`,
    maxAttempts: 1,
    metadata: { producer: agentId, robotOperatorChild: agentId },
  })
  audit({
    level: 'info',
    category: 'action',
    event: 'robot_operator_autonomy_stimulus_queued',
    actor: agentId,
    details: { taskId: task.id, cognitionTaskId: cognitionTask.id, sessionId: session.sessionId, cycleId, mode },
  })
  return {
    queued: true,
    cognitionTaskId: cognitionTask.id,
    sessionId: session.sessionId,
    agentId,
    cycle,
  }
}
