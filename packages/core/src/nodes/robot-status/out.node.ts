import type {
  EnvironmentFeedback,
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js'
import {
  loadRobotStatus,
  robotStatusPath,
  saveRobotStatus,
  type RobotStatusAction,
  type RobotStatusBody,
  type RobotStatusSnapshot,
  type RobotStatusTask,
  type RobotStatusTaskAction,
} from '../../robot-status.js'
import { defineNode } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function taskAction(value: unknown): RobotStatusTaskAction | null {
  if (!isRecord(value)) return null
  const type = cleanText(value.type, 80)
  if (!type) return null
  const metadata = isRecord(value.metadata) ? value.metadata : null
  const description = cleanText(metadata?.motionSummary, 500)
  return {
    type,
    ...(cleanText(value.command, 160) ? { command: cleanText(value.command, 160) } : {}),
    ...(cleanText(value.direction, 80) ? { direction: cleanText(value.direction, 80) } : {}),
    ...(cleanText(value.target, 200) ? { target: cleanText(value.target, 200) } : {}),
    ...(description ? { description } : {}),
  }
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? value.find(isRecord) ?? null : null
}

function currentAction(inputs: Record<string, unknown>): Record<string, unknown> | null {
  const bridgeRecord = isRecord(inputs.bridgeRecord) ? inputs.bridgeRecord : null
  const actionContext = isRecord(inputs.actionContext) ? inputs.actionContext : null
  return firstRecord(bridgeRecord?.requestedActions)
    ?? firstRecord(inputs.actions)
    ?? firstRecord(inputs.generatedActions)
    ?? (isRecord(actionContext?.requested) ? actionContext.requested : null)
}

function actionId(inputs: Record<string, unknown>): string {
  const terminal = isRecord(inputs.terminalFeedback) ? inputs.terminalFeedback : null
  const actionContext = isRecord(inputs.actionContext) ? inputs.actionContext : null
  const bridgeRecord = isRecord(inputs.bridgeRecord) ? inputs.bridgeRecord : null
  const command = firstRecord(bridgeRecord?.commands)
  return cleanText(terminal?.actionId, 200)
    || cleanText(actionContext?.actionId, 200)
    || cleanText(command?.id, 200)
}

function lastAction(
  inputs: Record<string, unknown>,
  previous: RobotStatusSnapshot | null,
  observedAt: string,
): RobotStatusAction | null {
  const selected = currentAction(inputs)
  const terminal = isRecord(inputs.terminalFeedback) ? inputs.terminalFeedback : null
  const bridgeRecord = isRecord(inputs.bridgeRecord) ? inputs.bridgeRecord : null
  const id = actionId(inputs)
  const previousAction = previous?.lastAction
  const matchingPrevious = previousAction && (!id || previousAction.actionId === id)
    ? previousAction
    : null
  const compact = taskAction(selected)
  if (!compact && !terminal) return previousAction ?? null
  return {
    actionId: id || matchingPrevious?.actionId || '',
    type: compact?.type || matchingPrevious?.type || '',
    command: compact?.command || matchingPrevious?.command || '',
    description: compact?.description || matchingPrevious?.description || compact?.target || '',
    status: cleanText(terminal?.type, 80)
      || cleanText(bridgeRecord?.status, 80)
      || matchingPrevious?.status
      || '',
    message: cleanText(terminal?.message, 500)
      || cleanText(bridgeRecord?.message, 500)
      || matchingPrevious?.message
      || '',
    completedAt: terminal ? observedAt : matchingPrevious?.completedAt || '',
  }
}

function bodyFromObservation(
  observation: EnvironmentObservation | null,
  previous: RobotStatusSnapshot | null,
): RobotStatusBody | null {
  if (!observation) return previous?.body ?? null
  const previousBody = previous?.body?.sessionId === observation.sessionId
    ? previous.body
    : null
  const state = isRecord(observation.state) ? observation.state : {}
  const body = isRecord(state.body) ? state.body : {}
  const motionAvailable = typeof body.motionAvailable === 'boolean'
    ? body.motionAvailable
    : previousBody?.motion.available ?? null
  return {
    sessionId: observation.sessionId,
    environmentId: observation.environmentId,
    connectionStatus: previousBody?.connectionStatus ?? '',
    observationAt: observation.timestamp,
    telemetryAt: previousBody?.telemetryAt ?? '',
    battery: previousBody?.battery ?? { voltage: null, observedAt: '' },
    motion: {
      available: motionAvailable,
      activity: previousBody?.motion.activity ?? '',
      observedAt: observation.timestamp,
    },
    state,
    telemetry: previousBody?.telemetry ?? {},
    capabilities: observation.capabilities as unknown as Record<string, unknown>,
  }
}

function selectedFrame(value: unknown): EnvironmentVisualFrame | null {
  if (!Array.isArray(value)) return null
  return value.find(frame => isRecord(frame) && cleanText(frame.id, 200)) as EnvironmentVisualFrame | undefined ?? null
}

function statusTask(
  inputs: Record<string, unknown>,
  previous: RobotStatusSnapshot | null,
  now: string,
): RobotStatusTask | undefined {
  const decision = isRecord(inputs.taskDecision) ? inputs.taskDecision : null
  if (!decision) return undefined
  const previousTask = previous?.task
  const userInstruction = cleanText(inputs.userInstruction, 4_000)
  const instruction = cleanText(inputs.instruction, 4_000)
    || (!userInstruction ? previousTask?.instruction ?? '' : '')
  const objective = cleanText(decision.objective, 1_000)
    || instruction
    || previousTask?.objective
    || ''
  if (!objective) return undefined
  const selected = taskAction(currentAction(inputs))
  const id = actionId(inputs)
  const terminal = isRecord(inputs.terminalFeedback)
    ? inputs.terminalFeedback as unknown as EnvironmentFeedback
    : null
  const bridgeRecord = isRecord(inputs.bridgeRecord) ? inputs.bridgeRecord : null
  const newUserTurn = Boolean(userInstruction)
  const frame = selectedFrame(inputs.frames)
  const previousBaseline = !newUserTurn ? previousTask?.baselineFrame ?? null : null
  return {
    objective,
    instruction: instruction || objective,
    source: inputs.inputSource === 'autonomy'
      ? 'autonomy'
      : newUserTurn
        ? 'user'
        : previousTask?.source || 'user',
    decision: {
      outcome: cleanText(decision.outcome, 80),
      reason: cleanText(decision.reason, 1_000),
      objectiveComplete: decision.objectiveComplete === true,
      ...(cleanText(decision.continuationPolicy, 80) ? { continuationPolicy: cleanText(decision.continuationPolicy, 80) } : {}),
      ...(cleanText(decision.requiredCompletionBasis, 80) ? { requiredCompletionBasis: cleanText(decision.requiredCompletionBasis, 80) } : {}),
      ...(cleanText(decision.motionClass, 80) ? { motionClass: cleanText(decision.motionClass, 80) } : {}),
      ...(cleanText(decision.actionPurpose, 80) ? { actionPurpose: cleanText(decision.actionPurpose, 80) } : {}),
      ...(cleanText(decision.observationSummary, 500) ? { observationSummary: cleanText(decision.observationSummary, 500) } : {}),
      ...(cleanText(decision.visualEvidenceMode, 80) ? { visualEvidenceMode: cleanText(decision.visualEvidenceMode, 80) } : {}),
      ...(cleanText(decision.completionEvidence, 1_000) ? { completionEvidence: cleanText(decision.completionEvidence, 1_000) } : {}),
      ...(cleanText(decision.nextInstruction, 1_000) ? { nextInstruction: cleanText(decision.nextInstruction, 1_000) } : {}),
    },
    selectedAction: selected ?? (!newUserTurn ? previousTask?.selectedAction ?? null : null),
    actionId: id || (!newUserTurn ? previousTask?.actionId ?? '' : ''),
    actionStatus: cleanText(terminal?.type, 80)
      || cleanText(bridgeRecord?.status, 80)
      || (!newUserTurn ? previousTask?.actionStatus ?? '' : ''),
    feedback: terminal
      ? {
          type: terminal.type,
          actionId: terminal.actionId ?? id,
          message: cleanText(terminal.message, 500),
          observedAt: now,
        }
      : !newUserTurn
        ? previousTask?.feedback ?? null
        : null,
    baselineFrame: decision.visualEvidenceMode === 'comparison' && frame
      ? {
          id: frame.id,
          timestamp: frame.timestamp,
          ...(frame.source ? { source: frame.source } : {}),
          ...(cleanText(frame.metadata?.correlationId, 200)
            ? { correlationId: cleanText(frame.metadata?.correlationId, 200) }
            : {}),
        }
      : previousBaseline,
    updatedAt: now,
  }
}

export const robotStatusOutNode = defineNode({
  id: 'robot_status_out',
  name: 'Robot Status Out',
  category: 'output',
  inputs: [
    { name: 'observation', type: 'object', optional: true, description: 'Current Environment Bridge observation' },
    { name: 'instruction', type: 'string', optional: true, description: 'Current resolved instruction' },
    { name: 'userInstruction', type: 'string', optional: true, description: 'Current human instruction, when present' },
    { name: 'inputSource', type: 'string', optional: true, description: 'Instruction provenance: user or autonomy' },
    { name: 'taskDecision', type: 'object', optional: true, description: 'Validated task decision authored by the Environment LLM' },
    { name: 'actions', type: 'array', optional: true, description: 'Validated advertised actions selected by the Environment LLM' },
    { name: 'generatedActions', type: 'array', optional: true, description: 'Validated freestyle actions from Movement Generator' },
    { name: 'response', type: 'string', optional: true, description: 'Model-authored conversational response' },
    { name: 'terminalFeedback', type: 'object', optional: true, description: 'Correlated terminal action feedback' },
    { name: 'actionContext', type: 'object', optional: true, description: 'Matched Work Coordinator record for the returning robot result' },
    { name: 'bridgeRecord', type: 'object', optional: true, description: 'Environment Bridge dispatch result when this pass sent an action' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated current frame metadata' },
  ],
  outputs: [
    { name: 'status', type: 'object', description: 'Updated canonical Robot Status snapshot' },
    { name: 'context', type: 'object', description: 'Updated snapshot for downstream context' },
    { name: 'task', type: 'object', description: 'Current LLM-authored task record' },
    { name: 'lastAction', type: 'object', description: 'Latest selected or completed robot action' },
    { name: 'path', type: 'string', description: 'Profile-resolved Robot Status path' },
    { name: 'persisted', type: 'boolean', description: 'Whether Robot Status was atomically updated' },
  ],
  properties: {},
  description: 'Atomically updates the canonical Robot Status file from one completed Environment workflow pass. It does not call a model or choose an action.',
  async execute(inputs, context) {
    const username = cleanText(context.username, 160)
    if (!username) throw new Error('Robot Status Out requires an authenticated username')
    const previous = loadRobotStatus(username)
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null
    const now = observation?.timestamp || new Date().toISOString()
    const task = statusTask(inputs, previous, now)
    const action = lastAction(inputs, previous, now)
    const decision = isRecord(inputs.taskDecision) ? inputs.taskDecision : null
    const response = cleanText(inputs.response, 1_000)
    const userInstruction = cleanText(inputs.userInstruction, 500)
    const semanticSummary = cleanText(decision?.observationSummary, 1_000)
      || response
      || cleanText(decision?.reason, 1_000)
      || cleanText((inputs.terminalFeedback as Record<string, unknown> | undefined)?.message, 500)
      || userInstruction
      || previous?.situation.situationalSummary
      || ''
    if (!semanticSummary) throw new Error('Robot Status Out requires a model decision, response, feedback, or prior status')
    const previousSituation = previous?.situation
    const situation = {
      situationalSummary: semanticSummary,
      environmentDescription: cleanText(decision?.observationSummary, 1_000)
        || previousSituation?.environmentDescription
        || semanticSummary,
      currentGoal: task?.decision.objectiveComplete === true
        ? ''
        : task?.objective || previousSituation?.currentGoal || '',
      currentIntent: cleanText(decision?.reason, 500)
        || previousSituation?.currentIntent
        || '',
      userContext: userInstruction || previousSituation?.userContext || '',
      uncertainties: previousSituation?.uncertainties ?? [],
    }
    const sourceUpdatedAt = previous?.sourceUpdatedAt ?? {
      environment: '',
      telemetry: '',
      conversation: '',
      robotHistory: '',
      agency: '',
    }
    const status = saveRobotStatus(username, situation, {
      sourceUpdatedAt: {
        ...sourceUpdatedAt,
        environment: observation?.timestamp || sourceUpdatedAt.environment,
        conversation: userInstruction || response ? now : sourceUpdatedAt.conversation,
        robotHistory: isRecord(inputs.terminalFeedback) ? now : sourceUpdatedAt.robotHistory,
      },
      body: bodyFromObservation(observation, previous),
      lastAction: action,
      task,
      activeDesires: previous?.agency.activeDesires ?? [],
    })
    return {
      status,
      context: status,
      task: status.task,
      lastAction: status.lastAction,
      path: robotStatusPath(username),
      persisted: true,
    }
  },
})
