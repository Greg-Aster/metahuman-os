import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { systemPaths } from './path-builder.js'
import type { QueuedTask } from './queue/types.js'

export type SleepRuntimePhase = 'awake' | 'sleeping' | 'waking'
export type SleepStageState = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface SleepStageRuntime {
  id: string
  displayName: string
  handler: string
  state: SleepStageState
  taskId?: string
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface SleepSessionRuntime {
  id: string
  parentTaskId: string
  username: string
  source: QueuedTask['source']
  reason: string
  state: 'running' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: string
  completedAt?: string
  currentStageId?: string
  stages: SleepStageRuntime[]
}

export interface SleepRuntimeState {
  version: 1
  phase: SleepRuntimePhase
  updatedAt: string
  currentSession?: SleepSessionRuntime
  recentSessions: SleepSessionRuntime[]
}

export interface SleepStageDefinition {
  id: string
  displayName: string
  handler: string
}

export const SLEEP_RUNTIME_FILE = process.env.MH_SLEEP_RUNTIME_FILE
  ? path.resolve(process.env.MH_SLEEP_RUNTIME_FILE)
  : path.join(systemPaths.run, 'sleep-state.json')
const MAX_RECENT_SESSIONS = 10

function defaultState(): SleepRuntimeState {
  return {
    version: 1,
    phase: 'awake',
    updatedAt: new Date().toISOString(),
    recentSessions: [],
  }
}

function isRuntimeState(value: unknown): value is SleepRuntimeState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SleepRuntimeState>
  return candidate.version === 1
    && ['awake', 'sleeping', 'waking'].includes(String(candidate.phase))
    && Array.isArray(candidate.recentSessions)
}

function cloneSession(session: SleepSessionRuntime): SleepSessionRuntime {
  return { ...session, stages: session.stages.map(stage => ({ ...stage })) }
}

export function readSleepRuntimeState(): SleepRuntimeState {
  try {
    if (!fs.existsSync(SLEEP_RUNTIME_FILE)) return defaultState()
    const parsed = JSON.parse(fs.readFileSync(SLEEP_RUNTIME_FILE, 'utf8'))
    return isRuntimeState(parsed) ? parsed : defaultState()
  } catch {
    return defaultState()
  }
}

function writeSleepRuntimeState(state: SleepRuntimeState): SleepRuntimeState {
  fs.mkdirSync(path.dirname(SLEEP_RUNTIME_FILE), { recursive: true })
  const next = { ...state, updatedAt: new Date().toISOString() }
  const temporary = `${SLEEP_RUNTIME_FILE}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, SLEEP_RUNTIME_FILE)
  return next
}

export function isSleepRuntimeActive(state = readSleepRuntimeState()): boolean {
  return Boolean(state.currentSession && (state.phase === 'sleeping' || state.phase === 'waking'))
}

export function beginSleepSession(input: {
  parentTaskId: string
  username: string
  source: QueuedTask['source']
  reason: string
  stages: readonly SleepStageDefinition[]
}): SleepSessionRuntime | null {
  const state = readSleepRuntimeState()
  if (isSleepRuntimeActive(state)) return null
  const now = new Date().toISOString()
  const session: SleepSessionRuntime = {
    id: randomUUID(),
    parentTaskId: input.parentTaskId,
    username: input.username,
    source: input.source,
    reason: input.reason,
    state: 'running',
    startedAt: now,
    stages: input.stages.map(stage => ({ ...stage, state: 'pending' })),
  }
  writeSleepRuntimeState({ ...state, phase: 'sleeping', currentSession: session })
  return cloneSession(session)
}

export function updateSleepStage(
  sessionId: string,
  stageId: string,
  patch: Partial<Omit<SleepStageRuntime, 'id' | 'displayName' | 'handler'>>,
): SleepSessionRuntime | null {
  const state = readSleepRuntimeState()
  const session = state.currentSession
  if (!session || session.id !== sessionId || session.state !== 'running') return null
  const stage = session.stages.find(candidate => candidate.id === stageId)
  if (!stage) return null
  Object.assign(stage, patch)
  session.currentStageId = ['queued', 'running'].includes(patch.state ?? stage.state) ? stageId : session.currentStageId
  writeSleepRuntimeState({ ...state, currentSession: session })
  return cloneSession(session)
}

function finishSession(
  state: SleepRuntimeState,
  session: SleepSessionRuntime,
  outcome: SleepSessionRuntime['state'],
  reason?: string,
): SleepRuntimeState {
  const completedAt = new Date().toISOString()
  const finished = cloneSession(session)
  finished.state = outcome
  finished.completedAt = completedAt
  finished.currentStageId = undefined
  if (reason) finished.reason = reason
  if (outcome !== 'completed') {
    for (const stage of finished.stages) {
      if (stage.state === 'running' || stage.state === 'queued') {
        stage.state = 'cancelled'
        stage.completedAt = completedAt
        stage.error = reason
      } else if (stage.state === 'pending') {
        stage.state = 'skipped'
        stage.completedAt = completedAt
        stage.error = reason
      }
    }
  }
  return writeSleepRuntimeState({
    ...state,
    phase: 'awake',
    currentSession: undefined,
    recentSessions: [finished, ...state.recentSessions].slice(0, MAX_RECENT_SESSIONS),
  })
}

export function completeSleepSession(sessionId: string): SleepRuntimeState {
  const state = readSleepRuntimeState()
  const session = state.currentSession
  if (!session || session.id !== sessionId) return state
  return finishSession(state, session, 'completed')
}

export function wakeSleepSession(reason = 'User activity resumed'): SleepRuntimeState {
  const state = readSleepRuntimeState()
  const session = state.currentSession
  if (!session) return state.phase === 'awake' ? state : writeSleepRuntimeState({ ...state, phase: 'awake' })
  return finishSession({ ...state, phase: 'waking' }, session, 'cancelled', reason)
}

export function reconcileSleepRuntime(activeTasks: readonly QueuedTask[]): SleepRuntimeState {
  const state = readSleepRuntimeState()
  const session = state.currentSession
  if (!session) return state
  const sessionStillActive = activeTasks.some(task =>
    task.id === session.parentTaskId || task.input?.sleepWorkflow?.sessionId === session.id,
  )
  return sessionStillActive
    ? state
    : finishSession(state, session, 'interrupted', 'Sleep workflow was interrupted before coordinator recovery')
}
