import { readable } from 'svelte/store'

export type SleepState = 'awake' | 'sleeping' | 'dreaming'

export interface SleepStatus {
  status: SleepState
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
      const res = await fetch('/api/sleep-status', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as SleepStatus
      if (!disposed) set(data)
    } catch (error) {
      console.error('[sleep-status] Failed to fetch status:', error)
    }
  }

  fetchStatus()
  const interval = window.setInterval(fetchStatus, 60_000)

  return () => {
    disposed = true
    window.clearInterval(interval)
  }
})
