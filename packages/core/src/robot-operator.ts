import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './path-builder.js'
import type { EnvironmentObservation } from './environment-interface/types.js'
import type { AutonomyMode, QueuedTask } from './queue/types.js'
import type { RobotStatusTask } from './robot-status.js'

const SERVICES_CONFIG_PATH = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG_PATH = path.join(systemPaths.etc, 'agents.json')
export const ROBOT_OPERATOR_RUNTIME_FILE = path.join(systemPaths.logs, 'run', 'robot-operator-state.json')

export type RobotObserverTriggerSource = 'user' | 'autonomy'
export type RobotOperatorStimulusAgent =
  | 'robot-autonomy-controller'
  | 'robot-status'
  | 'robot-goal-review'
  | 'boredom-observer'
  | 'boredom-movement'
  | 'boredom-reflection'
export type RobotOperatorCycleRequester =
  | RobotOperatorStimulusAgent
  | 'environment-perception'

const ROBOT_AUTONOMY_HANDLERS = new Set([
  'workflow.robot-autonomy-controller',
  'workflow.robot-status',
  'workflow.robot-goal-review',
  'workflow.boredom-observer',
  'workflow.boredom-movement',
  'workflow.boredom-reflection',
])

export interface RobotObserverCycleMetadata {
  cycleId: string
  step: number
  triggerSource: RobotObserverTriggerSource
  graph: string
  requestedBy: RobotOperatorCycleRequester
}

export interface RobotOperatorConfig {
  enabled: boolean
  robotStatusInactivityThresholdSeconds: number
  robotStatusJitterMs: number
  robotGoalReviewInactivityThresholdSeconds: number
  robotGoalReviewJitterMs: number
  boredomObserverInactivityThresholdSeconds: number
  boredomObserverJitterMs: number
  boredomMovementInactivityThresholdSeconds: number
  boredomMovementJitterMs: number
  boredomReflectionInactivityThresholdSeconds: number
  boredomReflectionJitterMs: number
  robotStatusGraph: string
  robotAutonomyControllerGraph: string
  robotGoalReviewGraph: string
  boredomObserverGraph: string
  boredomMovementGraph: string
  boredomReflectionGraph: string
  autonomyGraph: string
  environmentGraph: string
  sessionId?: string
}

export interface RobotOperatorChildRuntimeState {
  id: RobotOperatorStimulusAgent
  enabled: boolean
  handler: string
  graph: string
  nextRunAt?: string
  lastAdmittedAt?: string
  lastTaskId?: string
  lastOutcome?: string
}

export interface RobotOperatorRuntimeState {
  version: 1
  serviceId: 'robot-operator'
  updatedAt: string
  mode: AutonomyMode
  lifecycle: 'starting' | 'armed' | 'dormant' | 'admitting' | 'stopped'
  reason: string
  children: Record<RobotOperatorStimulusAgent, RobotOperatorChildRuntimeState>
}

const DEFAULT_CONFIG: RobotOperatorConfig = {
  enabled: true,
  robotStatusInactivityThresholdSeconds: 300,
  robotStatusJitterMs: 60_000,
  robotGoalReviewInactivityThresholdSeconds: 60,
  robotGoalReviewJitterMs: 0,
  boredomObserverInactivityThresholdSeconds: 300,
  boredomObserverJitterMs: 60_000,
  boredomMovementInactivityThresholdSeconds: 600,
  boredomMovementJitterMs: 120_000,
  boredomReflectionInactivityThresholdSeconds: 900,
  boredomReflectionJitterMs: 180_000,
  robotStatusGraph: 'robot-status',
  robotAutonomyControllerGraph: 'robot-autonomy-controller',
  robotGoalReviewGraph: 'robot-goal-review',
  boredomObserverGraph: 'boredom-observer',
  boredomMovementGraph: 'boredom-movement',
  boredomReflectionGraph: 'boredom-reflection',
  autonomyGraph: 'boredom-autonomy',
  environmentGraph: 'environment',
}

function configuredGraph(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.trim())
    ? value.trim()
    : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback
}

function serviceConfig(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVICES_CONFIG_PATH, 'utf8')) as {
      services?: Record<string, Record<string, unknown>>
    }
    return parsed.services?.['robot-operator'] ?? {}
  } catch {
    return {}
  }
}

export function loadRobotOperatorConfig(): RobotOperatorConfig {
  const configured = serviceConfig()
  const autonomyGraph = configuredGraph(configured.autonomyGraph, DEFAULT_CONFIG.autonomyGraph)
  const environmentGraph = configuredGraph(configured.environmentGraph, DEFAULT_CONFIG.environmentGraph)
  const sessionId = typeof configured.sessionId === 'string' && configured.sessionId.trim()
    ? configured.sessionId.trim()
    : undefined
  return {
    enabled: typeof configured.enabled === 'boolean' ? configured.enabled : DEFAULT_CONFIG.enabled,
    robotStatusInactivityThresholdSeconds: boundedNumber(
      configured.robotStatusInactivityThreshold,
      DEFAULT_CONFIG.robotStatusInactivityThresholdSeconds,
      1,
      86_400,
    ),
    robotStatusJitterMs: boundedNumber(
      configured.robotStatusJitterMs,
      DEFAULT_CONFIG.robotStatusJitterMs,
      0,
      3_600_000,
    ),
    robotGoalReviewInactivityThresholdSeconds: boundedNumber(
      configured.robotGoalReviewInactivityThreshold,
      DEFAULT_CONFIG.robotGoalReviewInactivityThresholdSeconds,
      1,
      86_400,
    ),
    robotGoalReviewJitterMs: boundedNumber(
      configured.robotGoalReviewJitterMs,
      DEFAULT_CONFIG.robotGoalReviewJitterMs,
      0,
      3_600_000,
    ),
    boredomObserverInactivityThresholdSeconds: boundedNumber(
      configured.boredomObserverInactivityThreshold ?? configured.inactivityThreshold,
      DEFAULT_CONFIG.boredomObserverInactivityThresholdSeconds,
      1,
      86_400,
    ),
    boredomObserverJitterMs: boundedNumber(
      configured.boredomObserverJitterMs ?? configured.jitterMs,
      DEFAULT_CONFIG.boredomObserverJitterMs,
      0,
      3_600_000,
    ),
    boredomMovementInactivityThresholdSeconds: boundedNumber(
      configured.boredomMovementInactivityThreshold,
      DEFAULT_CONFIG.boredomMovementInactivityThresholdSeconds,
      1,
      86_400,
    ),
    boredomMovementJitterMs: boundedNumber(
      configured.boredomMovementJitterMs,
      DEFAULT_CONFIG.boredomMovementJitterMs,
      0,
      3_600_000,
    ),
    boredomReflectionInactivityThresholdSeconds: boundedNumber(
      configured.boredomReflectionInactivityThreshold,
      DEFAULT_CONFIG.boredomReflectionInactivityThresholdSeconds,
      1,
      86_400,
    ),
    boredomReflectionJitterMs: boundedNumber(
      configured.boredomReflectionJitterMs,
      DEFAULT_CONFIG.boredomReflectionJitterMs,
      0,
      3_600_000,
    ),
    robotStatusGraph: configuredGraph(configured.robotStatusGraph, DEFAULT_CONFIG.robotStatusGraph),
    robotAutonomyControllerGraph: configuredGraph(
      configured.robotAutonomyControllerGraph,
      DEFAULT_CONFIG.robotAutonomyControllerGraph,
    ),
    robotGoalReviewGraph: configuredGraph(configured.robotGoalReviewGraph, DEFAULT_CONFIG.robotGoalReviewGraph),
    boredomObserverGraph: configuredGraph(configured.boredomObserverGraph, DEFAULT_CONFIG.boredomObserverGraph),
    boredomMovementGraph: configuredGraph(configured.boredomMovementGraph, DEFAULT_CONFIG.boredomMovementGraph),
    boredomReflectionGraph: configuredGraph(configured.boredomReflectionGraph, DEFAULT_CONFIG.boredomReflectionGraph),
    autonomyGraph,
    environmentGraph,
    sessionId,
  }
}

function isConfiguredAgentEnabled(id: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, 'utf8')) as {
      agents?: Record<string, { enabled?: unknown }>
    }
    return parsed.agents?.[id]?.enabled === true
  } catch {
    return false
  }
}

export function isBoredomObserverEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-observer')
}

export function isRobotStatusEnabled(): boolean {
  return isConfiguredAgentEnabled('robot-status')
}

export function isBoredomMovementEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-movement')
}

export function isBoredomReflectionEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-reflection')
}

export function isRobotOperatorChildEnabled(agent: RobotOperatorStimulusAgent): boolean {
  if (agent === 'robot-autonomy-controller') return isConfiguredAgentEnabled('robot-autonomy-controller')
  if (agent === 'robot-status') return isRobotStatusEnabled()
  if (agent === 'robot-goal-review') return isConfiguredAgentEnabled('robot-goal-review')
  if (agent === 'boredom-observer') return isBoredomObserverEnabled()
  if (agent === 'boredom-movement') return isBoredomMovementEnabled()
  return isBoredomReflectionEnabled()
}

export function robotOperatorChildGraph(
  config: RobotOperatorConfig,
  agent: RobotOperatorStimulusAgent,
): string {
  if (agent === 'robot-autonomy-controller') return config.robotAutonomyControllerGraph
  if (agent === 'robot-status') return config.robotStatusGraph
  if (agent === 'robot-goal-review') return config.robotGoalReviewGraph
  if (agent === 'boredom-observer') return config.boredomObserverGraph
  if (agent === 'boredom-movement') return config.boredomMovementGraph
  return config.boredomReflectionGraph
}

/**
 * A goal needs a new LLM review only after a terminal action result says the
 * objective remains unresolved. Decisions made by Goal Review itself already
 * describe what happens next and must not re-admit the reviewer immediately.
 */
export function robotGoalNeedsReview(task: RobotStatusTask | null | undefined): boolean {
  if (!task?.objective.trim() || task.decision.objectiveComplete) return false
  return task.decision.outcome === 'incomplete' || task.decision.outcome === 'failed'
}

function hasRobotObserverMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, any>
  return Boolean(
    record.metadata?.robotObserver
    || record.observation?.metadata?.robotObserver
    || record.actionContext?.robotObserver
    || record.robotOperatorContext?.robotObserver,
  )
}

export function isRobotAutonomyWorkItem(
  task: Pick<QueuedTask, 'handler' | 'input'>,
): boolean {
  return ROBOT_AUTONOMY_HANDLERS.has(task.handler)
    || hasRobotObserverMetadata(task.input)
}

export function hasActiveRobotAutonomyCycle(
  tasks: Array<Pick<QueuedTask, 'id' | 'handler' | 'input' | 'state'>>,
  ignoreTaskId?: string,
): boolean {
  return tasks.some(task => (
    task.id !== ignoreTaskId
    && (task.state === 'queued' || task.state === 'leased' || task.state === 'waiting')
    && isRobotAutonomyWorkItem(task)
  ))
}

export function randomizedRobotOperatorIdleMs(
  config: { inactivityThresholdSeconds: number; jitterMs: number },
  random: () => number = Math.random,
): number {
  const centerMs = Math.max(1_000, config.inactivityThresholdSeconds * 1_000)
  const jitterMs = Math.max(0, config.jitterMs)
  const sample = Math.max(0, Math.min(1, random()))
  return Math.max(1_000, Math.round(centerMs - jitterMs + sample * jitterMs * 2))
}

export function readRobotOperatorRuntimeState(): RobotOperatorRuntimeState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROBOT_OPERATOR_RUNTIME_FILE, 'utf8')) as Record<string, any>
    if (parsed?.version !== 1 || parsed.serviceId !== 'robot-operator') return null
    if (!['reactive', 'semi', 'full'].includes(parsed.mode)) return null
    if (!['starting', 'armed', 'dormant', 'admitting', 'stopped'].includes(parsed.lifecycle)) return null
    const childIds: RobotOperatorStimulusAgent[] = [
      'robot-autonomy-controller',
      'robot-status',
      'robot-goal-review',
      'boredom-observer',
      'boredom-movement',
      'boredom-reflection',
    ]
    const children = {} as Record<RobotOperatorStimulusAgent, RobotOperatorChildRuntimeState>
    for (const id of childIds) {
      const child = parsed.children?.[id]
      if (!child || typeof child !== 'object' || Array.isArray(child)) return null
      const optionalText = (value: unknown, maxLength: number): string | undefined => (
        typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined
      )
      children[id] = {
        id,
        enabled: child.enabled === true,
        handler: optionalText(child.handler, 100) ?? `workflow.${id}`,
        graph: configuredGraph(child.graph, robotOperatorChildGraph(DEFAULT_CONFIG, id)),
        ...(optionalText(child.nextRunAt, 50) ? { nextRunAt: optionalText(child.nextRunAt, 50) } : {}),
        ...(optionalText(child.lastAdmittedAt, 50) ? { lastAdmittedAt: optionalText(child.lastAdmittedAt, 50) } : {}),
        ...(optionalText(child.lastTaskId, 200) ? { lastTaskId: optionalText(child.lastTaskId, 200) } : {}),
        ...(optionalText(child.lastOutcome, 500) ? { lastOutcome: optionalText(child.lastOutcome, 500) } : {}),
      }
    }
    return {
      version: 1,
      serviceId: 'robot-operator',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt.slice(0, 50) : '',
      mode: parsed.mode,
      lifecycle: parsed.lifecycle,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
      children,
    }
  } catch {
    return null
  }
}

export function writeRobotOperatorRuntimeState(
  state: Omit<RobotOperatorRuntimeState, 'version' | 'serviceId' | 'updatedAt'>,
): RobotOperatorRuntimeState {
  const next: RobotOperatorRuntimeState = {
    version: 1,
    serviceId: 'robot-operator',
    updatedAt: new Date().toISOString(),
    ...state,
  }
  fs.mkdirSync(path.dirname(ROBOT_OPERATOR_RUNTIME_FILE), { recursive: true })
  const temporary = `${ROBOT_OPERATOR_RUNTIME_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`)
  fs.renameSync(temporary, ROBOT_OPERATOR_RUNTIME_FILE)
  return next
}

export function robotObserverSourceAllowed(
  mode: AutonomyMode,
  source: RobotObserverTriggerSource,
): boolean {
  return source === 'user' || mode === 'semi' || mode === 'full'
}

export function readRobotObserverCycle(
  observation: Pick<EnvironmentObservation, 'metadata'> | null | undefined,
): RobotObserverCycleMetadata | null {
  return parseRobotObserverCycle(observation?.metadata?.robotObserver)
}

export function parseRobotObserverCycle(value: unknown): RobotObserverCycleMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const cycleId = typeof record.cycleId === 'string' ? record.cycleId.trim() : ''
  const step = typeof record.step === 'number' ? Math.floor(record.step) : 0
  const triggerSource = record.triggerSource
  const requestedBy = record.requestedBy
  const graph = typeof record.graph === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(record.graph)
    ? record.graph
    : 'environment'
  if (
    !cycleId
    || step < 1
    || (triggerSource !== 'user' && triggerSource !== 'autonomy')
    || (
      requestedBy !== 'boredom-observer'
      && requestedBy !== 'robot-autonomy-controller'
      && requestedBy !== 'robot-goal-review'
      && requestedBy !== 'boredom-movement'
      && requestedBy !== 'boredom-reflection'
      && requestedBy !== 'environment-perception'
    )
  ) return null
  return {
    cycleId,
    step,
    triggerSource,
    graph,
    requestedBy,
  }
}

export function beginEnvironmentPerceptionCycle(
  cycleId: string,
  graph: string,
): RobotObserverCycleMetadata | null {
  const normalizedCycleId = cycleId.trim()
  const normalizedGraph = /^[a-zA-Z0-9_-]{1,80}$/.test(graph) ? graph : 'environment'
  if (!normalizedCycleId) return null
  return {
    cycleId: normalizedCycleId,
    step: 1,
    triggerSource: 'user',
    graph: normalizedGraph,
    requestedBy: 'environment-perception',
  }
}

export function nextRobotObserverCycle(
  current: RobotObserverCycleMetadata,
): RobotObserverCycleMetadata {
  return { ...current, step: current.step + 1 }
}
