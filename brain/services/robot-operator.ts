#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'
import {
  ACTIVITY_STATE_FILE,
  acquireLock,
  audit,
  getOperatorMode,
  getCurrentlyActiveUser,
  hasActiveRobotAutonomyCycle,
  initGlobalLogger,
  isRobotOperatorChildEnabled,
  isSleepRuntimeActive,
  loadActiveOperatorConfig,
  loadQueueState,
  loadRobotOperatorConfig,
  loadRobotStatus,
  nextRobotOperatorFullChild,
  randomizedRobotOperatorIdleMs,
  readSystemActivityTimestamp,
  robotOperatorChildGraph,
  robotOperatorFullDueAt,
  SLEEP_RUNTIME_FILE,
  systemPaths,
  writeRobotOperatorRuntimeState,
  type RobotOperatorChildRuntimeState,
  type RobotOperatorStimulusAgent,
} from '@metahuman/core'
import { submitCoordinatorWork } from '@metahuman/core/queue'

const SERVICE_ID = 'robot-operator'
const ACTIVE_OPERATOR_CONFIG = path.join(systemPaths.etc, 'active-operator.json')
const SERVICES_CONFIG = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG = path.join(systemPaths.etc, 'agents.json')
const RETRY_DELAY_MS = 30_000
const FULL_CYCLE_POLL_MS = 1_000
const FULL_IDLE_CONFIRMATIONS = 2
const CHILDREN: RobotOperatorStimulusAgent[] = [
  'robot-status',
  'robot-goal-review',
  'boredom-observer',
  'boredom-movement',
  'boredom-reflection',
]

interface ChildSchedule {
  timer: NodeJS.Timeout | null
  nextRunAt: number
  lastAdmittedAt: number
  lastTaskId?: string
  lastOutcome?: string
  armedIdleMs: number
}

const schedules = Object.fromEntries(CHILDREN.map(child => [child, {
  timer: null,
  nextRunAt: 0,
  lastAdmittedAt: 0,
  armedIdleMs: 0,
}])) as Record<RobotOperatorStimulusAgent, ChildSchedule>

let activeSince = Date.now()
let previousMode = getOperatorMode()
let shuttingDown = false
let fullTimer: NodeJS.Timeout | null = null
let fullCursor = 0
let fullIdleConfirmations = 0
let lastFullCycleCompletedAt = 0
let lifecycle: 'starting' | 'armed' | 'dormant' | 'admitting' | 'stopped' = 'starting'
let lifecycleReason = 'startup'

function iso(timestamp: number): string | undefined {
  return timestamp > 0 ? new Date(timestamp).toISOString() : undefined
}

function publishRuntime(): void {
  const config = loadRobotOperatorConfig()
  const children = {} as Record<RobotOperatorStimulusAgent, RobotOperatorChildRuntimeState>
  for (const child of CHILDREN) {
    const schedule = schedules[child]
    children[child] = {
      id: child,
      enabled: config.enabled && isRobotOperatorChildEnabled(child),
      handler: `workflow.${child}`,
      graph: robotOperatorChildGraph(config, child),
      ...(iso(schedule.nextRunAt) ? { nextRunAt: iso(schedule.nextRunAt) } : {}),
      ...(iso(schedule.lastAdmittedAt) ? { lastAdmittedAt: iso(schedule.lastAdmittedAt) } : {}),
      ...(schedule.lastTaskId ? { lastTaskId: schedule.lastTaskId } : {}),
      ...(schedule.lastOutcome ? { lastOutcome: schedule.lastOutcome } : {}),
    }
  }
  writeRobotOperatorRuntimeState({
    mode: getOperatorMode(),
    lifecycle,
    reason: lifecycleReason,
    fullCooldownMs: loadActiveOperatorConfig().cooldownMs,
    children,
  })
}

function clearChildTimer(child: RobotOperatorStimulusAgent): void {
  const schedule = schedules[child]
  if (schedule.timer) clearTimeout(schedule.timer)
  schedule.timer = null
  schedule.nextRunAt = 0
}

function clearTimers(): void {
  for (const child of CHILDREN) clearChildTimer(child)
  if (fullTimer) clearTimeout(fullTimer)
  fullTimer = null
  fullIdleConfirmations = 0
}

function randomizedChildIdleMs(child: RobotOperatorStimulusAgent): number {
  const config = loadRobotOperatorConfig()
  if (child === 'robot-status') {
    return randomizedRobotOperatorIdleMs({
      inactivityThresholdSeconds: config.robotStatusInactivityThresholdSeconds,
      jitterMs: config.robotStatusJitterMs,
    })
  }
  if (child === 'robot-goal-review') {
    return randomizedRobotOperatorIdleMs({
      inactivityThresholdSeconds: config.robotGoalReviewInactivityThresholdSeconds,
      jitterMs: config.robotGoalReviewJitterMs,
    })
  }
  if (child === 'boredom-observer') {
    return randomizedRobotOperatorIdleMs({
      inactivityThresholdSeconds: config.boredomObserverInactivityThresholdSeconds,
      jitterMs: config.boredomObserverJitterMs,
    })
  }
  if (child === 'boredom-movement') {
    return randomizedRobotOperatorIdleMs({
      inactivityThresholdSeconds: config.boredomMovementInactivityThresholdSeconds,
      jitterMs: config.boredomMovementJitterMs,
    })
  }
  return randomizedRobotOperatorIdleMs({
    inactivityThresholdSeconds: config.boredomReflectionInactivityThresholdSeconds,
    jitterMs: config.boredomReflectionJitterMs,
  })
}

function robotAutonomyCycleActive(): boolean {
  return hasActiveRobotAutonomyCycle(loadQueueState()?.items ?? [])
}

function robotGoalNeedsReview(username: string): boolean {
  const task = loadRobotStatus(username)?.task
  return Boolean(task?.objective.trim() && task.decision.objectiveComplete === false)
}

function dormantReason(): string | null {
  const config = loadRobotOperatorConfig()
  const mode = getOperatorMode()
  if (!config.enabled) return 'Robot Operator disabled'
  if (mode === 'reactive') return 'Active Operator is reactive'
  if (isSleepRuntimeActive()) return 'sleep workflow active'
  if (!CHILDREN.some(isRobotOperatorChildEnabled)) return 'all child triggers disabled'
  return null
}

function armSemiChild(child: RobotOperatorStimulusAgent, reason: string, minimumDelayMs = 1_000): void {
  clearChildTimer(child)
  if (shuttingDown || getOperatorMode() !== 'semi' || !isRobotOperatorChildEnabled(child)) return
  const schedule = schedules[child]
  schedule.armedIdleMs = randomizedChildIdleMs(child)
  const lastActivityAt = readSystemActivityTimestamp() ?? 0
  const baseAt = Math.max(activeSince, lastActivityAt, schedule.lastAdmittedAt)
  const dueAt = Math.max(Date.now() + minimumDelayMs, baseAt + schedule.armedIdleMs)
  schedule.nextRunAt = dueAt
  schedule.timer = setTimeout(() => void onDeadline(child, 'semi'), dueAt - Date.now())
  console.log(`[${SERVICE_ID}] Armed child=${child} reason=${reason} mode=semi due=${new Date(dueAt).toISOString()}`)
}

function armFull(reason: string, minimumDelayMs = 1_000): void {
  if (fullTimer) clearTimeout(fullTimer)
  fullTimer = null
  for (const child of CHILDREN) schedules[child].nextRunAt = 0
  if (shuttingDown || getOperatorMode() !== 'full') return
  const configured = CHILDREN.filter(isRobotOperatorChildEnabled)
  const activeUser = getCurrentlyActiveUser()
  const goalReviewPending = Boolean(
    activeUser?.role === 'owner'
    && robotGoalNeedsReview(activeUser.username),
  )
  const enabled = goalReviewPending && configured.includes('robot-goal-review')
    ? ['robot-goal-review'] as RobotOperatorStimulusAgent[]
    : configured.filter(child => child !== 'robot-goal-review')
  if (enabled.length === 0) return
  const child = nextRobotOperatorFullChild(enabled, fullCursor)
  if (!child) return
  const cooldownMs = Math.max(1_000, loadActiveOperatorConfig().cooldownMs)
  const dueAt = robotOperatorFullDueAt(Date.now(), lastFullCycleCompletedAt, cooldownMs, minimumDelayMs)
  schedules[child].nextRunAt = dueAt
  fullTimer = setTimeout(() => void onDeadline(child, 'full'), dueAt - Date.now())
  console.log(`[${SERVICE_ID}] Armed child=${child} reason=${reason} mode=full due=${new Date(dueAt).toISOString()}`)
}

function watchFullCycle(reason: string): void {
  if (fullTimer) clearTimeout(fullTimer)
  fullTimer = null
  for (const child of CHILDREN) schedules[child].nextRunAt = 0
  if (shuttingDown || getOperatorMode() !== 'full') return
  lifecycle = 'armed'
  lifecycleReason = reason
  fullTimer = setTimeout(checkFullCycle, FULL_CYCLE_POLL_MS)
}

function checkFullCycle(): void {
  fullTimer = null
  if (shuttingDown) return
  if (getOperatorMode() !== 'full' || dormantReason()) {
    armForMode('eligibility-changed')
    return
  }
  if (robotAutonomyCycleActive()) {
    fullIdleConfirmations = 0
    watchFullCycle('cycle-active')
    publishRuntime()
    return
  }
  fullIdleConfirmations += 1
  if (fullIdleConfirmations < FULL_IDLE_CONFIRMATIONS) {
    watchFullCycle('cycle-settling')
    publishRuntime()
    return
  }
  fullIdleConfirmations = 0
  lastFullCycleCompletedAt = Date.now()
  lifecycle = 'armed'
  lifecycleReason = 'cycle-complete'
  armFull('cycle-complete')
  publishRuntime()
}

function armForMode(reason: string): void {
  clearTimers()
  if (shuttingDown) return
  const dormant = dormantReason()
  if (dormant) {
    lifecycle = 'dormant'
    lifecycleReason = dormant
    console.log(`[${SERVICE_ID}] Dormant (${dormant})`)
    publishRuntime()
    return
  }
  lifecycle = 'armed'
  lifecycleReason = reason
  if (getOperatorMode() === 'full') {
    if (robotAutonomyCycleActive()) watchFullCycle('cycle-active')
    else armFull(reason)
  }
  else for (const child of CHILDREN) armSemiChild(child, reason)
  publishRuntime()
}

async function onDeadline(
  child: RobotOperatorStimulusAgent,
  expectedMode: 'semi' | 'full',
): Promise<void> {
  if (expectedMode === 'full') fullTimer = null
  clearChildTimer(child)
  if (shuttingDown) return
  if (getOperatorMode() !== expectedMode || dormantReason()) {
    armForMode('eligibility-changed')
    return
  }

  const schedule = schedules[child]
  if (expectedMode === 'semi') {
    const lastActivityAt = readSystemActivityTimestamp() ?? 0
    const inactivityBase = Math.max(activeSince, lastActivityAt, schedule.lastAdmittedAt)
    if (Date.now() - inactivityBase < schedule.armedIdleMs) {
      armSemiChild(child, 'activity-reset')
      publishRuntime()
      return
    }
  }

  if (robotAutonomyCycleActive()) {
    schedule.lastOutcome = 'waiting_for_active_cycle'
    if (expectedMode === 'full') {
      watchFullCycle('cycle-active')
    } else {
      armSemiChild(child, 'active-cycle', RETRY_DELAY_MS)
    }
    publishRuntime()
    return
  }

  const admittedAt = Date.now()
  const activeUser = getCurrentlyActiveUser()
  if (!activeUser || activeUser.role !== 'owner') {
    schedule.lastOutcome = 'no_authorized_owner'
    console.log(`[${SERVICE_ID}] ${child} waiting because no authorized owner is active`)
    if (expectedMode === 'full') armFull('no-active-user', RETRY_DELAY_MS)
    else armSemiChild(child, 'no-active-user', RETRY_DELAY_MS)
    publishRuntime()
    return
  }
  if (child === 'robot-goal-review' && !robotGoalNeedsReview(activeUser.username)) {
    schedule.lastOutcome = 'no_unfinished_goal'
    lifecycle = 'armed'
    lifecycleReason = 'goal-review-not-needed'
    if (expectedMode === 'full') armFull('goal-review-not-needed')
    else armSemiChild(child, 'goal-review-not-needed')
    publishRuntime()
    return
  }

  lifecycle = 'admitting'
  lifecycleReason = child
  publishRuntime()
  const config = loadRobotOperatorConfig()
  try {
    const task = await submitCoordinatorWork({
      type: 'generic',
      handler: `workflow.${child}`,
      resource: 'system',
      source: 'autonomy',
      priority: 'background',
      username: activeUser.username,
      cognitiveMode: 'environment',
      input: {
        agentId: child,
        triggeredBy: SERVICE_ID,
        sessionId: config.sessionId,
      },
      idempotencyKey: `${SERVICE_ID}:${child}:${admittedAt}`,
      maxAttempts: 1,
      metadata: { producer: SERVICE_ID, childAgent: child },
    })
    schedule.lastAdmittedAt = admittedAt
    schedule.lastTaskId = task.id
    schedule.lastOutcome = 'admitted'
    if (expectedMode === 'full') {
      fullCursor += 1
    }
    console.log(`[${SERVICE_ID}] ${child} admitted task=${task.id} mode=${expectedMode}`)
    audit({
      level: 'info',
      category: 'action',
      event: 'robot_operator_child_admitted',
      actor: SERVICE_ID,
      details: { taskId: task.id, child, mode: expectedMode },
    })
    lifecycle = 'armed'
    lifecycleReason = expectedMode === 'full' ? 'cycle-active' : 'child-admitted'
    if (expectedMode === 'full') watchFullCycle('cycle-active')
    else armSemiChild(child, 'child-admitted')
  } catch (error) {
    schedule.lastOutcome = `admission_failed: ${(error as Error).message}`
    console.error(`[${SERVICE_ID}] Failed to admit ${child}:`, error)
    audit({
      level: 'error',
      category: 'action',
      event: 'robot_operator_child_admission_failed',
      actor: SERVICE_ID,
      details: { child, error: (error as Error).message, mode: expectedMode },
    })
    lifecycle = 'armed'
    lifecycleReason = 'admission-retry'
    if (expectedMode === 'full') armFull('admission-retry', RETRY_DELAY_MS)
    else armSemiChild(child, 'admission-retry', RETRY_DELAY_MS)
  }
  publishRuntime()
}

function watchFile(file: string, onChange: () => void): fs.FSWatcher | null {
  try {
    return fs.watch(path.dirname(file), (_event, filename) => {
      if (filename?.toString() === path.basename(file)) onChange()
    })
  } catch (error) {
    console.warn(`[${SERVICE_ID}] Could not watch ${file}:`, error)
    return null
  }
}

export async function run(): Promise<void> {
  const lock = acquireLock('agent-robot-operator', { exitOnSignal: false })
  initGlobalLogger(SERVICE_ID)
  console.log(`[${SERVICE_ID}] Started; Robot Status and boredom schedules are owned here`)

  const watchers = [
    watchFile(ACTIVITY_STATE_FILE, () => armForMode('system-activity')),
    watchFile(SLEEP_RUNTIME_FILE, () => armForMode('sleep-state')),
    watchFile(SERVICES_CONFIG, () => armForMode('service-config')),
    watchFile(AGENTS_CONFIG, () => armForMode('agent-config')),
    watchFile(ACTIVE_OPERATOR_CONFIG, () => {
      const mode = getOperatorMode()
      if (previousMode === 'reactive' && mode !== 'reactive') activeSince = Date.now()
      previousMode = mode
      armForMode('active-operator-mode')
    }),
  ].filter((watcher): watcher is fs.FSWatcher => watcher !== null)

  armForMode('startup')
  let finishShutdown: (() => void) | undefined
  const shutdown = () => {
    shuttingDown = true
    clearTimers()
    lifecycle = 'stopped'
    lifecycleReason = 'shutdown'
    publishRuntime()
    finishShutdown?.()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  try {
    await new Promise<void>(resolve => { finishShutdown = resolve })
  } finally {
    for (const watcher of watchers) watcher.close()
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
    lock.release()
    console.log(`[${SERVICE_ID}] Stopped`)
  }
}

export default run
