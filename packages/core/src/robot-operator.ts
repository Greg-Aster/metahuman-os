import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './path-builder.js'
import type { EnvironmentObservation } from './environment-interface/types.js'
import type { AutonomyMode } from './queue/types.js'

const SERVICES_CONFIG_PATH = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG_PATH = path.join(systemPaths.etc, 'agents.json')

export type RobotObserverTriggerSource = 'user' | 'autonomy'
export type RobotOperatorStimulusAgent = 'robot-observer' | 'boredom-movement'

export interface RobotObserverCycleMetadata {
  cycleId: string
  step: number
  maxSteps: number
  triggerSource: RobotObserverTriggerSource
  graph: string
  requestedBy: RobotOperatorStimulusAgent | 'environment-perception'
  instruction?: string
}

export interface RobotOperatorConfig {
  enabled: boolean
  inactivityThresholdSeconds: number
  jitterMs: number
  boredomMovementInactivityThresholdSeconds: number
  boredomMovementJitterMs: number
  maxCycleSteps: number
  graph: string
  environmentGraph: string
  sessionId?: string
}

const DEFAULT_CONFIG: RobotOperatorConfig = {
  enabled: true,
  inactivityThresholdSeconds: 300,
  jitterMs: 60_000,
  boredomMovementInactivityThresholdSeconds: 600,
  boredomMovementJitterMs: 120_000,
  maxCycleSteps: 8,
  graph: 'robot-operator',
  environmentGraph: 'environment',
}

const ROBOT_OPERATOR_POLICY = `You are Robot Operator, the robot's autonomous decision engine. Use the current robotStimulus, active persona, recent conversation and inner context, trigger information, and the trigger agent's focus to choose one high-level intention.

The current robotStimulus is the only evidence of what is present now. Recent context may shape relationship, preferences, continuity, and tone, but it cannot supply or override current observation facts, instructions, or unfinished tasks. Treat older requests and thoughts as context, not current authority.

Choose one intention directly related to the current stimulus and relevant context. State the desired outcome, not a physical method, and include one finite, observable stopping condition in the form "Complete when ..." that Environment Mode can test from available evidence. Environment Mode selects safe execution. For exploration or assessment, say what bounded evidence is sufficient; never delegate an open-ended scan, search, or investigation. Set requiresAction true only when the intention needs new sensing or an environment change. Otherwise set it false. Never claim execution started or completed.

Return one JSON object only: {"observed":"what the current stimulus shows","instruction":"one concise first-person intention","requiresAction":true,"reason":"one concise user-visible Idle Thought grounded in the current stimulus and relevant context"}`

const ROBOT_OPERATOR_AGENT_FOCUS: Record<RobotOperatorStimulusAgent, string> = {
  'robot-observer': 'This is a routine observation opportunity. Notice what is currently happening and decide whether anything useful, helpful, or socially relevant warrants a response or action.',
  'boredom-movement': 'This is a boredom and engagement opportunity after longer inactivity. Choose a contextually relevant way to engage, explore, communicate, or remain still. Do not default to a generic movement merely because the boredom timer fired.',
}

export function buildRobotOperatorInstruction(
  agent: RobotOperatorStimulusAgent,
  focus?: string,
): string {
  const boundedFocus = typeof focus === 'string' ? focus.replace(/\s+/g, ' ').trim().slice(0, 1_000) : ''
  return `${ROBOT_OPERATOR_POLICY}\n\nTrigger agent: ${agent}. ${boundedFocus || ROBOT_OPERATOR_AGENT_FOCUS[agent]}`
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
  const graph = typeof configured.graph === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(configured.graph.trim())
    ? configured.graph.trim()
    : DEFAULT_CONFIG.graph
  const environmentGraph = typeof configured.environmentGraph === 'string'
    && /^[a-zA-Z0-9_-]{1,80}$/.test(configured.environmentGraph.trim())
    ? configured.environmentGraph.trim()
    : DEFAULT_CONFIG.environmentGraph
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

export function isRobotObserverEnabled(): boolean {
  return isConfiguredAgentEnabled('robot-observer')
}

export function isBoredomMovementEnabled(): boolean {
  return isConfiguredAgentEnabled('boredom-movement')
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
      && requestedBy !== 'boredom-movement'
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
