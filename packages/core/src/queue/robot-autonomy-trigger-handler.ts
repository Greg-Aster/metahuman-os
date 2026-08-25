import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import {
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
  type EnvironmentObservation,
} from '../environment-interface/index.js'
import {
  isRobotOperatorChildEnabled,
  hasActiveRobotAutonomyCycle,
  loadRobotOperatorConfig,
  robotObserverSourceAllowed,
  robotOperatorChildGraph,
  type RobotObserverCycleMetadata,
  type RobotOperatorStimulusAgent,
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
  return hasActiveRobotAutonomyCycle(getQueueManager().getAllTasks(), currentTaskId)
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
    state: latest.state,
    location: latest.location,
    map: latest.map,
    feedback: [],
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
  if (
    agentId === 'boredom-movement'
    && (
      !session.latestObservation.capabilities.actions.includes('robotMotionPlan')
      && (
        !session.latestObservation.capabilities.actions.includes('robotCommand')
        || !session.latestObservation.capabilities.robotCommands?.length
      )
    )
  ) {
    return { skipped: true, reason: 'robot_movement_unavailable', sessionId: session.sessionId, agentId }
  }
  if (getEnvironmentActionSubscriberCount(session.sessionId) < 1) {
    return { skipped: true, reason: 'robot_action_stream_unavailable', sessionId: session.sessionId, agentId }
  }

  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : randomUUID()
  const cycle: RobotObserverCycleMetadata = {
    cycleId,
    step: 1,
    // Agent Monitor supplies user authorization to run this agent, but the
    // resulting stimulus is still authored by an autonomy service. Keeping
    // those concepts separate prevents a manual agent run from masquerading
    // as conversational user input downstream.
    triggerSource: 'autonomy',
    graph: robotOperatorChildGraph(config, agentId),
    requestedBy: agentId,
  }

  const observation = buildRobotAutonomyStimulus(session.latestObservation, cycle, agentId)
  const cognitionTask = context.enqueue({
    type: 'environment_observation',
    handler: 'environment.observation',
    resource: 'local-llm',
    source: cycle.triggerSource,
    priority: manual ? 'high' : 'background',
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
