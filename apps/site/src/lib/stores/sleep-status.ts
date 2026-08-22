import { readable } from 'svelte/store'
import { apiFetch } from '../client/api-config'

export type SleepState = 'awake' | 'sleeping' | 'dreaming'
export type SleepPhase = 'awake' | 'sleeping' | 'waking'

export interface SleepStageStatus {
  id: string
  displayName: string
  handler: string
  state: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'
  taskId?: string
  startedAt?: string
  completedAt?: string
  error?: string
  queueState?: string
  attempt?: number
  maxAttempts?: number
}

export interface SleepSessionStatus {
  id: string
  parentTaskId: string
  username: string
  reason: string
  state: 'running' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: string
  completedAt?: string
  currentStageId?: string
  stages: SleepStageStatus[]
}

export interface SleepStatus {
  status: SleepState
  phase: SleepPhase
  config: {
    enabled: boolean
    window: { start: string; end: string }
    minIdleMins: number
  }
  currentSession: SleepSessionStatus | null
  recentSessions: SleepSessionStatus[]
  configuredStages: Array<Pick<SleepStageStatus, 'id' | 'displayName' | 'handler'>>
  learningsFile: string | null
  learningsContent: string | null
  lastChecked: string
}

export const sleepStatus = readable<SleepStatus | null>(null, (set) => {
  if (typeof window === 'undefined') {
    // Avoid running fetch logic during SSR
    return () => {}
  }

  let disposed = false

  const fetchStatus = async () => {
    try {
      const res = await apiFetch('/api/sleep-status', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as SleepStatus
      if (!disposed) set(data)
    } catch (error) {
      console.error('[sleep-status] Failed to fetch status:', error)
    }
  }

  fetchStatus()
  const interval = window.setInterval(fetchStatus, 10_000)

  return () => {
    disposed = true
    window.clearInterval(interval)
  }
})
