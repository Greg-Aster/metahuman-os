import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './path-builder.js'
import type { EnvironmentObservation } from './environment-interface/types.js'
import type { AutonomyMode } from './queue/types.js'

const SERVICES_CONFIG_PATH = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG_PATH = path.join(systemPaths.etc, 'agents.json')
export const ROBOT_OPERATOR_RUNTIME_FILE = path.join(systemPaths.logs, 'run', 'robot-operator-state.json')

export type RobotObserverTriggerSource = 'user' | 'autonomy'
export type RobotOperatorStimulusAgent =
  | 'boredom-observer'
  | 'boredom-movement'
  | 'boredom-reflection'
export type RobotOperatorCycleRequester =
  | RobotOperatorStimulusAgent
  | 'robot-observer'
  | 'environment-perception'

export interface RobotObserverCycleMetadata {
  cycleId: string
  step: number
  maxSteps: number
  triggerSource: RobotObserverTriggerSource
  graph: string
  requestedBy: RobotOperatorCycleRequester
  instruction?: string
}

export interface RobotOperatorConfig {
  enabled: boolean
  boredomObserverInactivityThresholdSeconds: number
  boredomObserverJitterMs: number
  boredomMovementInactivityThresholdSeconds: number
  boredomMovementJitterMs: number
  boredomReflectionInactivityThresholdSeconds: number
  boredomReflectionJitterMs: number
  maxCycleSteps: number
  graph: string
  boredomObserverGraph: string
  boredomMovementGraph: string
  boredomReflectionGraph: string
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
  fullCooldownMs?: number
  children: Record<RobotOperatorStimulusAgent, RobotOperatorChildRuntimeState>
}

const DEFAULT_CONFIG: RobotOperatorConfig = {
  enabled: true,
  boredomObserverInactivityThresholdSeconds: 300,
  boredomObserverJitterMs: 60_000,
  boredomMovementInactivityThresholdSeconds: 600,
  boredomMovementJitterMs: 120_000,
  boredomReflectionInactivityThresholdSeconds: 900,
  boredomReflectionJitterMs: 180_000,
  maxCycleSteps: 8,
  graph: 'robot-operator',
  boredomObserverGraph: 'boredom-observer',
  boredomMovementGraph: 'boredom-movement',
  boredomReflectionGraph: 'boredom-reflection',
  environmentGraph: 'environment',
}

const ROBOT_OPERATOR_POLICY = `You are a child autonomy trigger owned and scheduled by Robot Operator. You deliberate about one bounded opportunity; you do not execute robot commands, speak, or control hardware yourself.

The current robotStimulus is the only evidence of what is present now. A sampled memory is historical inspiration only and is never evidence of the robot's current surroundings. Do not infer unseen obstacles, clearance, or people.

Choose at most one intention. If speech, sensing, or physical behavior is warranted, set requiresAction true and describe the desired outcome plus a finite stopping condition in the form "Complete when ...". Environment Mode alone selects and executes actions. Never delegate an open-ended scan, walk, search, survey, or investigation. If only a private reflection is warranted, set requiresAction false. Never claim execution started or completed, and never mention timer, boredom trigger, service, agent, workflow, or implementation details in the reason.

Return one JSON object only: {"observed":"what the supplied stimulus establishes","instruction":"one concise first-person intention or private reflection","requiresAction":true,"reason":"one concise private thought grounded in the supplied stimulus"}`

const ROBOT_OPERATOR_AGENT_FOCUS: Record<RobotOperatorStimulusAgent, string> = {
  'boredom-observer': 'Use the single current camera observation. You may privately reflect, request a bounded closer inspection, request speech, or request one other bounded response through Environment Mode. Remaining still is valid. Do not turn a vague desire for more context into repeated movement.',
  'boredom-movement': 'Choose one safe, bounded movement opportunity first, such as a posture change, stretch, expressive motion, or small reorientation supported by current capabilities. Environment Mode must execute it and assess the returned observation. Do not request open-ended locomotion or a room survey.',
  'boredom-reflection': 'Use the sampled memory as historical inspiration. You may privately reflect, request speech, or request one bounded physical response through Environment Mode. The memory does not establish anything about the current environment.',
}

export function buildRobotOperatorInstruction(
  agent: RobotOperatorStimulusAgent | 'robot-observer',
  focus?: string,
): string {
  const normalizedAgent = agent === 'robot-observer' ? 'boredom-observer' : agent
  const boundedFocus = typeof focus === 'string' ? focus.replace(/\s+/g, ' ').trim().slice(0, 1_000) : ''
  return `${ROBOT_OPERATOR_POLICY}\n\nTrigger agent: ${normalizedAgent}. ${boundedFocus || ROBOT_OPERATOR_AGENT_FOCUS[normalizedAgent]}`
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
  const graph = configuredGraph(configured.graph, DEFAULT_CONFIG.graph)
  const environmentGraph = configuredGraph(configured.environmentGraph, DEFAULT_CONFIG.environmentGraph)
  const sessionId = typeof configured.sessionId === 'string' && configured.sessionId.trim()
    ? configured.sessionId.trim()
    : undefined
  return {
    enabled: typeof configured.enabled === 'boolean' ? configured.enabled : DEFAULT_CONFIG.enabled,
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
    maxCycleSteps: Math.floor(boundedNumber(configured.maxCycleSteps, DEFAULT_CONFIG.maxCycleSteps, 1, 10)),
    graph,
    boredomObserverGraph: configuredGraph(configured.boredomObserverGraph, DEFAULT_CONFIG.boredomObserverGraph),
    boredomMovementGraph: configuredGraph(configured.boredomMovementGraph, DEFAULT_CONFIG.boredomMovementGraph),
    boredomReflectionGraph: configuredGraph(configured.boredomReflectionGraph, DEFAULT_CONFIG.boredomReflectionGraph),
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

export function isBoredomMovementEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-movement')
}

export function isBoredomReflectionEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-reflection')
}

/** Compatibility for callers that still use the former child name. */
export function isRobotObserverEnabled(): boolean {
  return isBoredomObserverEnabled() || isConfiguredAgentEnabled('robot-observer')
}

export function isRobotOperatorChildEnabled(agent: RobotOperatorStimulusAgent): boolean {
  if (agent === 'boredom-observer') return isBoredomObserverEnabled()
  if (agent === 'boredom-movement') return isBoredomMovementEnabled()
  return isBoredomReflectionEnabled()
}

export function robotOperatorChildGraph(
  config: RobotOperatorConfig,
  agent: RobotOperatorStimulusAgent,
): string {
  if (agent === 'boredom-observer') return config.boredomObserverGraph
  if (agent === 'boredom-movement') return config.boredomMovementGraph
  return config.boredomReflectionGraph
}

export function robotOperatorChildMaxSteps(
  config: RobotOperatorConfig,
  agent: RobotOperatorStimulusAgent,
): number {
  const childLimit = agent === 'boredom-observer' ? 4 : 3
  return Math.max(1, Math.min(config.maxCycleSteps, childLimit))
}

export function nextRobotOperatorFullChild(
  enabled: RobotOperatorStimulusAgent[],
  cursor: number,
): RobotOperatorStimulusAgent | null {
  if (enabled.length === 0) return null
  const normalizedCursor = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0
  return enabled[normalizedCursor % enabled.length] ?? null
}

export function robotOperatorFullDueAt(
  now: number,
  lastAdmittedAt: number,
  cooldownMs: number,
  minimumDelayMs = 1_000,
): number {
  return Math.max(
    now + Math.max(1_000, minimumDelayMs),
    Math.max(0, lastAdmittedAt) + Math.max(1_000, cooldownMs),
  )
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
      ...(typeof parsed.fullCooldownMs === 'number'
        ? { fullCooldownMs: boundedNumber(parsed.fullCooldownMs, 30_000, 1_000, 3_600_000) }
        : {}),
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
  const value = observation?.metadata?.robotObserver
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const cycleId = typeof record.cycleId === 'string' ? record.cycleId.trim() : ''
  const step = typeof record.step === 'number' ? Math.floor(record.step) : 0
  const maxSteps = typeof record.maxSteps === 'number' ? Math.floor(record.maxSteps) : 0
  const triggerSource = record.triggerSource
  const requestedBy = record.requestedBy
  const instruction = typeof record.instruction === 'string'
    ? record.instruction.trim().slice(0, 8_000)
    : ''
  const graph = typeof record.graph === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(record.graph)
    ? record.graph
    : 'environment'
  if (
    !cycleId
    || step < 1
    || maxSteps < 1
    || maxSteps > 10
    || step > maxSteps
    || (triggerSource !== 'user' && triggerSource !== 'autonomy')
    || (
      requestedBy !== 'robot-observer'
      && requestedBy !== 'boredom-observer'
      && requestedBy !== 'boredom-movement'
      && requestedBy !== 'boredom-reflection'
      && requestedBy !== 'environment-perception'
    )
  ) return null
  return {
    cycleId,
    step,
    maxSteps,
    triggerSource,
    graph,
    requestedBy,
    ...(instruction ? { instruction } : {}),
  }
}

export function beginEnvironmentPerceptionCycle(
  cycleId: string,
  graph: string,
  maxSteps: number,
): RobotObserverCycleMetadata | null {
  const normalizedCycleId = cycleId.trim()
  const normalizedGraph = /^[a-zA-Z0-9_-]{1,80}$/.test(graph) ? graph : 'environment'
  const boundedSteps = Math.floor(maxSteps)
  if (!normalizedCycleId || boundedSteps < 1 || boundedSteps > 10) return null
  return {
    cycleId: normalizedCycleId,
    step: 1,
    maxSteps: boundedSteps,
    triggerSource: 'user',
    graph: normalizedGraph,
    requestedBy: 'environment-perception',
  }
}

export function nextRobotObserverCycle(
  current: RobotObserverCycleMetadata,
): RobotObserverCycleMetadata | null {
  if (current.step >= current.maxSteps) return null
  return { ...current, step: current.step + 1 }
}
