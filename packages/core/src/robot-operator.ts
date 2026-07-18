import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './path-builder.js'
import type { EnvironmentObservation } from './environment-interface/types.js'
import type { AutonomyMode } from './queue/types.js'

const SERVICES_CONFIG_PATH = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG_PATH = path.join(systemPaths.etc, 'agents.json')
const BOREDOM_MOVEMENT_CONFIG_PATH = path.join(systemPaths.etc, 'boredom-movement.json')

export type RobotObserverTriggerSource = 'user' | 'autonomy'

export interface RobotObserverCycleMetadata {
  cycleId: string
  step: number
  maxSteps: number
  triggerSource: RobotObserverTriggerSource
  graph: string
  requestedBy: 'robot-observer'
}

export interface BoredomMovementMetadata {
  cycleId: string
  triggerSource: RobotObserverTriggerSource
  requestedBy: 'boredom-movement'
  stationaryCommands: string[]
  selectedCommand: string
}

export interface RobotOperatorConfig {
  enabled: boolean
  inactivityThresholdSeconds: number
  jitterMs: number
  boredomMovementInactivityThresholdSeconds: number
  boredomMovementJitterMs: number
  maxCycleSteps: number
  graph: string
  sessionId?: string
}

const DEFAULT_CONFIG: RobotOperatorConfig = {
  enabled: true,
  inactivityThresholdSeconds: 300,
  jitterMs: 60_000,
  boredomMovementInactivityThresholdSeconds: 600,
  boredomMovementJitterMs: 120_000,
  maxCycleSteps: 3,
  graph: 'environment',
}

const FORBIDDEN_BOREDOM_COMMANDS = new Set(['stop', 'walk', 'backward', 'left', 'right'])

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
  const graph = typeof configured.graph === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(configured.graph.trim())
    ? configured.graph.trim()
    : DEFAULT_CONFIG.graph
  const sessionId = typeof configured.sessionId === 'string' && configured.sessionId.trim()
    ? configured.sessionId.trim()
    : undefined
  return {
    enabled: typeof configured.enabled === 'boolean' ? configured.enabled : DEFAULT_CONFIG.enabled,
    inactivityThresholdSeconds: boundedNumber(
      configured.inactivityThreshold,
      DEFAULT_CONFIG.inactivityThresholdSeconds,
      1,
      86_400,
    ),
    jitterMs: boundedNumber(configured.jitterMs, DEFAULT_CONFIG.jitterMs, 0, 3_600_000),
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
    maxCycleSteps: Math.floor(boundedNumber(configured.maxCycleSteps, DEFAULT_CONFIG.maxCycleSteps, 1, 10)),
    graph,
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

export function isRobotObserverEnabled(): boolean {
  return isConfiguredAgentEnabled('robot-observer')
}

export function isBoredomMovementEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-movement')
}

export function loadBoredomMovementCommandAllowlist(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(BOREDOM_MOVEMENT_CONFIG_PATH, 'utf8')) as {
      stationaryCommands?: unknown
    }
    const configured = parsed.stationaryCommands
    if (!Array.isArray(configured)) return []
    return [...new Set(
      configured
        .filter((command): command is string => typeof command === 'string')
        .map(command => command.trim().toLowerCase())
        .filter(command => command && !FORBIDDEN_BOREDOM_COMMANDS.has(command)),
    )]
  } catch {
    return []
  }
}

export function randomizedRobotOperatorIdleMs(
  config: Pick<RobotOperatorConfig, 'inactivityThresholdSeconds' | 'jitterMs'>,
  random: () => number = Math.random,
): number {
  const centerMs = Math.max(1_000, config.inactivityThresholdSeconds * 1_000)
  const jitterMs = Math.max(0, config.jitterMs)
  const sample = Math.max(0, Math.min(1, random()))
  return Math.max(1_000, Math.round(centerMs - jitterMs + sample * jitterMs * 2))
}

export function robotObserverSourceAllowed(
  mode: AutonomyMode,
  source: RobotObserverTriggerSource,
): boolean {
  return source === 'user' || mode === 'semi' || mode === 'full'
}

export function eligibleBoredomMovementCommands(
  advertisedCommands: string[] | null | undefined,
  configuredCommands: string[] = loadBoredomMovementCommandAllowlist(),
): string[] {
  const advertised = new Set(
    (advertisedCommands ?? [])
      .map(command => command.trim().toLowerCase())
      .filter(Boolean),
  )
  return [...new Set(
    configuredCommands
      .map(command => command.trim().toLowerCase())
      .filter(command => command && advertised.has(command) && !FORBIDDEN_BOREDOM_COMMANDS.has(command)),
  )]
}

export function chooseBoredomMovementCommand(
  commands: string[],
  random: () => number = Math.random,
): string | null {
  if (commands.length === 0) return null
  const sample = Math.max(0, Math.min(0.999999999, random()))
  return commands[Math.floor(sample * commands.length)] ?? null
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
  ) return null
  return {
    cycleId,
    step,
    maxSteps,
    triggerSource,
    graph,
    requestedBy: 'robot-observer',
  }
}

export function nextRobotObserverCycle(
  current: RobotObserverCycleMetadata,
): RobotObserverCycleMetadata | null {
  if (current.step >= current.maxSteps) return null
  return { ...current, step: current.step + 1 }
}
