#!/usr/bin/env tsx

import fs from 'node:fs'
import path from 'node:path'
import {
  ACTIVITY_STATE_FILE,
  acquireLock,
  audit,
  getOperatorMode,
  initGlobalLogger,
  isBoredomMovementEnabled,
  isRobotObserverEnabled,
  loadRobotOperatorConfig,
  randomizedRobotOperatorIdleMs,
  readSystemActivityTimestamp,
  systemPaths,
} from '@metahuman/core'
import { submitCoordinatorWork } from '@metahuman/core/queue'

const SERVICE_ID = 'robot-operator'
const ACTIVE_OPERATOR_CONFIG = path.join(systemPaths.etc, 'active-operator.json')
const SERVICES_CONFIG = path.join(systemPaths.etc, 'services.json')
const AGENTS_CONFIG = path.join(systemPaths.etc, 'agents.json')
const RETRY_DELAY_MS = 30_000

type RobotChild = 'robot-observer' | 'boredom-movement'

interface ChildSchedule {
  timer: NodeJS.Timeout | null
  lastAdmittedAt: number
  armedIdleMs: number
}

const schedules: Record<RobotChild, ChildSchedule> = {
  'robot-observer': { timer: null, lastAdmittedAt: 0, armedIdleMs: 0 },
  'boredom-movement': { timer: null, lastAdmittedAt: 0, armedIdleMs: 0 },
}

let activeSince = Date.now()
let previousMode = getOperatorMode()
let shuttingDown = false

function clearChildTimer(child: RobotChild): void {
  const schedule = schedules[child]
  if (schedule.timer) clearTimeout(schedule.timer)
  schedule.timer = null
}

function clearTimers(): void {
  clearChildTimer('robot-observer')
  clearChildTimer('boredom-movement')
}

function username(): string {
  return process.env.MH_TRIGGER_USERNAME?.trim() || 'system'
}

function childEnabled(child: RobotChild): boolean {
  return child === 'robot-observer' ? isRobotObserverEnabled() : isBoredomMovementEnabled()
}

function randomizedChildIdleMs(child: RobotChild): number {
  const config = loadRobotOperatorConfig()
  return randomizedRobotOperatorIdleMs(child === 'robot-observer'
    ? config
    : {
        inactivityThresholdSeconds: config.boredomMovementInactivityThresholdSeconds,
        jitterMs: config.boredomMovementJitterMs,
      })
}

function armChild(child: RobotChild, reason: string, minimumDelayMs = 1_000): void {
  clearChildTimer(child)
  if (shuttingDown) return
  const config = loadRobotOperatorConfig()
  const mode = getOperatorMode()
  if (!config.enabled || mode === 'reactive' || !childEnabled(child)) {
    console.log(
      `[${SERVICE_ID}] ${child} dormant (${!config.enabled
        ? 'Robot Operator disabled'
        : mode === 'reactive'
          ? 'Active Operator is reactive'
          : 'child agent disabled'})`,
    )
    return
  }

  const schedule = schedules[child]
  schedule.armedIdleMs = randomizedChildIdleMs(child)
  const lastActivityAt = readSystemActivityTimestamp() ?? 0
  const baseAt = Math.max(activeSince, lastActivityAt, schedule.lastAdmittedAt)
  const dueAt = Math.max(Date.now() + minimumDelayMs, baseAt + schedule.armedIdleMs)
  schedule.timer = setTimeout(() => void onDeadline(child), dueAt - Date.now())
  console.log(
    `[${SERVICE_ID}] Armed child=${child} reason=${reason} mode=${mode} due=${new Date(dueAt).toISOString()}`,
  )
}

function armAll(reason: string): void {
  armChild('robot-observer', reason)
  armChild('boredom-movement', reason)
}

async function onDeadline(child: RobotChild): Promise<void> {
  const schedule = schedules[child]
  schedule.timer = null
  if (shuttingDown) return
  const mode = getOperatorMode()
  if (mode === 'reactive') {
    armChild(child, 'mode-reactive')
    return
  }

  const config = loadRobotOperatorConfig()
  const lastActivityAt = readSystemActivityTimestamp() ?? 0
  const inactivityBase = Math.max(activeSince, lastActivityAt, schedule.lastAdmittedAt)
  if (Date.now() - inactivityBase < schedule.armedIdleMs) {
    armChild(child, 'activity-reset')
    return
  }

  const admittedAt = Date.now()
  try {
    const task = await submitCoordinatorWork({
      type: 'generic',
      handler: `workflow.${child}`,
      resource: 'system',
      source: 'autonomy',
      priority: 'background',
      username: username(),
      cognitiveMode: 'environment',
      input: {
        agentId: child,
        triggeredBy: SERVICE_ID,
        sessionId: config.sessionId,
      },
      idempotencyKey: `${SERVICE_ID}:${child}:${Math.floor(admittedAt / 60_000)}`,
      maxAttempts: 1,
      metadata: { producer: SERVICE_ID, childAgent: child },
    })
    schedule.lastAdmittedAt = admittedAt
    console.log(`[${SERVICE_ID}] ${child} admitted task=${task.id} mode=${mode}`)
    audit({
      level: 'info',
      category: 'action',
      event: 'robot_operator_child_admitted',
      actor: SERVICE_ID,
      details: { taskId: task.id, child, mode },
    })
    armChild(child, 'child-admitted')
  } catch (error) {
    console.error(`[${SERVICE_ID}] Failed to admit ${child}:`, error)
    audit({
      level: 'error',
      category: 'action',
      event: 'robot_operator_child_admission_failed',
      actor: SERVICE_ID,
      details: { child, error: (error as Error).message, mode },
    })
    armChild(child, 'admission-retry', RETRY_DELAY_MS)
  }
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
  console.log(`[${SERVICE_ID}] Started; Robot Observer and Boredom Movement timers are owned here`)

  const watchers = [
    watchFile(ACTIVITY_STATE_FILE, () => armAll('system-activity')),
    watchFile(SERVICES_CONFIG, () => armAll('service-config')),
    watchFile(AGENTS_CONFIG, () => armAll('agent-config')),
    watchFile(ACTIVE_OPERATOR_CONFIG, () => {
      const mode = getOperatorMode()
      if (previousMode === 'reactive' && mode !== 'reactive') activeSince = Date.now()
      previousMode = mode
      armAll('active-operator-mode')
    }),
  ].filter((watcher): watcher is fs.FSWatcher => watcher !== null)

  armAll('startup')
  let finishShutdown: (() => void) | undefined
  const shutdown = () => {
    shuttingDown = true
    clearTimers()
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
