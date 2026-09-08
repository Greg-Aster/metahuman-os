import { randomUUID } from 'node:crypto'
import { audit } from '../audit.js'
import { getOperatorMode } from '../active-operator/mode-controller.js'
import { withUserContext } from '../context.js'
import { canWriteMemory } from '../cognitive-mode.js'
import {
  getEnvironmentActionSubscriberCount,
  summarizeEnvironmentBridgeState,
} from '../environment-interface/index.js'
import {
  isRobotOperatorChildEnabled,
  hasActiveRobotAutonomyCycle,
  loadRobotOperatorConfig,
  robotAutonomyControllerContext,
  robotObserverSourceAllowed,
  robotOperatorChildGraph,
  type RobotObserverCycleMetadata,
  type RobotOperatorStimulusAgent,
} from '../robot-operator.js'
import { getQueueManager } from './unified-queue-manager.js'
import type { QueuedTask } from './types.js'
import type { WorkHandlerContext } from './execution-engine.js'
import { getUserByUsername } from '../users.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requestedSessionId(task: QueuedTask, configuredSessionId?: string): string | undefined {
  if (typeof task.input.sessionId === 'string' && task.input.sessionId.trim()) return task.input.sessionId.trim()
  const args = Array.isArray(task.input.args) ? task.input.args : []
  const sessionArg = args.find((value: unknown) => typeof value === 'string' && value.startsWith('--session='))
  return typeof sessionArg === 'string' ? sessionArg.slice('--session='.length).trim() : configuredSessionId
}

function stimulusAgent(task: QueuedTask): RobotOperatorStimulusAgent {
  if (
    task.handler === 'workflow.robot-autonomy-controller'
    || task.input.agentId === 'robot-autonomy-controller'
  ) {
    return 'robot-autonomy-controller'
  }
  if (task.handler === 'workflow.robot-status' || task.input.agentId === 'robot-status') {
    return 'robot-status'
  }
  if (task.handler === 'workflow.robot-goal-review' || task.input.agentId === 'robot-goal-review') {
    return 'robot-goal-review'
  }
  if (task.handler === 'workflow.boredom-reflection' || task.input.agentId === 'boredom-reflection') {
    return 'boredom-reflection'
  }
  if (task.handler === 'workflow.boredom-movement' || task.input.agentId === 'boredom-movement') {
    return 'boredom-movement'
  }
  return 'boredom-observer'
}

async function executeRobotStatusGraph(
  task: QueuedTask,
  graphName: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const [{ loadGraphForMode }, { collectNodeOutputs, listFailedNodes, runGraph }] = await Promise.all([
    import('../graph-streaming.js'),
    import('../graph-runtime.js'),
  ])
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Robot Status user not found: ${task.username}`)
  const loaded = await loadGraphForMode(graphName, user.username)
  if (!loaded) throw new Error(`Robot Status graph not found: ${graphName}`)
  const graphState = await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => runGraph({
      graph: loaded.graph,
      signal,
      context: {
        userId: user.id,
        username: user.username,
        cognitiveMode: 'environment',
        mode: 'system',
        dialogueType: 'system',
        environment: 'server',
        abortSignal: signal,
      },
    }),
  )
  const failures = listFailedNodes(graphState)
  if (graphState.status === 'failed' || graphState.error || failures.length > 0) {
    throw new Error(`Robot Status graph failed: ${graphState.error?.message || failures[0]?.error || graphState.status}`, { cause: graphState.error })
  }
  const outputs = collectNodeOutputs(graphState)
  const persisted = Object.values(outputs).some(output => output?.persisted === true)
  if (!persisted) throw new Error('Robot Status graph completed without persisting a snapshot')
  return { graphExecuted: true, graph: graphName, persisted: true, agentId: 'robot-status' }
}

async function executeRobotAutonomyControllerGraph(
  task: QueuedTask,
  graphName: string,
  autonomyGraph: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const [{ loadGraphForMode }, { listFailedNodes, requireGraphNodeOutput, runGraph }] = await Promise.all([
    import('../graph-streaming.js'),
    import('../graph-runtime.js'),
  ])
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Robot Autonomy Controller user not found: ${task.username}`)
  const loaded = await loadGraphForMode(graphName, user.username)
  if (!loaded) throw new Error(`Robot Autonomy Controller graph not found: ${graphName}`)
  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : task.correlationId?.trim()
      ? task.correlationId.trim()
      : randomUUID()
  const operatorContext = robotAutonomyControllerContext(cycleId, graphName, sessionId)
  const robotObserver = operatorContext.robotObserver
  const graphState = await withUserContext(
    { userId: user.id, username: user.username, role: user.role },
    () => runGraph({
      graph: loaded.graph,
      signal,
      context: {
        userId: user.id,
        username: user.username,
        cognitiveMode: 'environment',
        mode: 'system',
        dialogueType: 'system',
        allowMemoryWrites: canWriteMemory('environment'),
        environment: 'server',
        robotOperatorContext: operatorContext,
        robotOperatorEnvironmentGraph: autonomyGraph,
        abortSignal: signal,
      },
    }),
  )
  const failures = listFailedNodes(graphState)
  if (graphState.status === 'failed' || graphState.error || failures.length > 0) {
    throw new Error(`Robot Autonomy Controller graph failed: ${graphState.error?.message || failures[0]?.error || graphState.status}`, { cause: graphState.error })
  }
  const parsed = requireGraphNodeOutput(graphState, 'robot_autonomy_controller_parser')
  const decision = isRecord(parsed.decisionReceipt) ? parsed.decisionReceipt : null
  if (!decision) throw new Error('Robot Autonomy Controller completed without a validated decision receipt')
  const selectedTaskId = typeof decision.taskId === 'string' ? decision.taskId : ''
  const dispatchType = selectedTaskId === 'robot-autonomy-executor'
    ? 'robot_operator_environment_dispatch' : 'robot_autonomy_task_dispatch'
  const dispatchNodes = [...graphState.nodes.values()]
    .filter(node => node.definition?.type === dispatchType)
  // Selected branches can still be inactive when a required input is absent.
  // Report that execution outcome without selecting a different task.
  const dispatch = selectedTaskId === 'none'
    ? { queued: false, taskId: '', status: 'none_selected' }
    : dispatchNodes.length === 1 && dispatchNodes[0].status === 'skipped'
      ? { queued: false, taskId: '', status: 'skipped', reason: dispatchNodes[0].skipReason }
      : requireGraphNodeOutput(graphState, dispatchType)
  return {
    graphExecuted: true,
    executionId: graphState.executionId,
    executionStatus: graphState.status,
    graph: graphName,
    agentId: 'robot-autonomy-controller',
    cycle: robotObserver,
    decision,
    dispatch: {
      queued: dispatch.queued === true,
      taskId: typeof dispatch.taskId === 'string' ? dispatch.taskId : '',
      status: typeof dispatch.status === 'string' ? dispatch.status : 'unknown',
      ...(typeof dispatch.reason === 'string' ? { reason: dispatch.reason } : {}),
    },
  }
}

function anotherRobotAutonomyCycleIsActive(task: QueuedTask): boolean {
  const cycleId = typeof task.input.cycleId === 'string' && task.input.cycleId.trim()
    ? task.input.cycleId.trim()
    : task.correlationId?.trim() ?? ''
  return hasActiveRobotAutonomyCycle(getQueueManager().getAllTasks(), task.id, cycleId)
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
  if (anotherRobotAutonomyCycleIsActive(task)) {
    return { skipped: true, reason: 'robot_autonomy_cycle_active', agentId }
  }

  const config = loadRobotOperatorConfig()
  if (agentId === 'robot-autonomy-controller') {
    const result = await executeRobotAutonomyControllerGraph(
      task,
      robotOperatorChildGraph(config, agentId),
      config.autonomyGraph,
      requestedSessionId(task, config.sessionId),
      context.signal,
    )
    audit({
      level: 'info',
      category: 'action',
      event: 'robot_autonomy_controller_completed',
      actor: agentId,
      details: { taskId: task.id, mode, graph: robotOperatorChildGraph(config, agentId) },
    })
    return result
  }
  if (agentId === 'robot-status') {
    const result = await executeRobotStatusGraph(task, robotOperatorChildGraph(config, agentId), context.signal)
    audit({
      level: 'info',
      category: 'data',
      event: 'robot_status_updated',
      actor: agentId,
      details: { taskId: task.id, mode, graph: robotOperatorChildGraph(config, agentId) },
    })
    return result
  }
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
    : task.correlationId?.trim()
      ? task.correlationId.trim()
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

  const observation = session.latestObservation
  const [{ loadGraphForMode }, { runGraph }] = await Promise.all([
    import('../graph-streaming.js'), import('../graph-runtime.js'),
  ])
  const user = getUserByUsername(task.username)
  if (!user) throw new Error(`Robot workflow user not found: ${task.username}`)
  const loaded = await loadGraphForMode(cycle.graph, user.username)
  if (!loaded) throw new Error(`Robot workflow not found: ${cycle.graph}`)
  const graphState = await withUserContext({ userId: user.id, username: user.username, role: user.role }, () => runGraph({
    graph: loaded.graph, signal: context.signal,
    context: { userId: user.id, username: user.username, cognitiveMode: 'environment',
      mode: 'system', dialogueType: 'system', environment: 'server',
      allowMemoryWrites: canWriteMemory('environment'),
      environmentObservation: observation, environmentObservationCurrent: false,
      robotOperatorEnvironmentGraph: config.autonomyGraph,
      robotOperatorContext: { robotObserver: cycle, stimulusAgent: agentId,
        sourceObservationAt: observation.timestamp, currentVisualEvidence: false },
    },
  }))
  if (graphState.status === 'failed') throw graphState.error ?? new Error(`Robot workflow failed: ${cycle.graph}`)
  audit({
    level: 'info',
    category: 'action',
    event: 'robot_operator_autonomy_stimulus_executed',
    actor: agentId,
    details: { taskId: task.id, executionId: graphState.executionId, sessionId: session.sessionId, cycleId, mode },
  })
  return {
    graphExecuted: true,
    executionId: graphState.executionId,
    executionStatus: graphState.status,
    sessionId: session.sessionId,
    agentId,
    cycle,
  }
}
