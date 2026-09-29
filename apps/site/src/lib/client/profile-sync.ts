/** Browser adapter for the canonical server-side Profile Sync agent. */

import { apiEventSource, apiFetch, normalizeUrl } from './api-config'

export interface RemoteSyncProgress {
  phase: 'authenticating' | 'queued' | 'running' | 'downloading' | 'complete' | 'error'
  message: string
  current?: number
  total?: number
}

export interface RemoteSyncResult {
  success: boolean
  taskId?: string
  profileFiles?: number
  memoriesImported?: number
  credentialsSynced?: boolean
  error?: string
}

export interface RemoteSyncConfig {
  configured: boolean
  serverUrl?: string
  username?: string
  lastSyncAt?: string
  lastMemorySyncAt?: string
}

async function responseData(response: Response): Promise<Record<string, any>> {
  return await response.json().catch(() => ({}))
}

export async function configureRemoteSyncServer(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const response = await apiFetch('/api/profile-sync/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl: normalizeUrl(serverUrl), username, password }),
  })
  const data = await responseData(response)
  if (!response.ok || data.success === false) {
    return { success: false, error: data.error || `Could not save sync configuration (${response.status})` }
  }
  return { success: true }
}

export async function getRemoteSyncConfig(): Promise<RemoteSyncConfig> {
  const response = await apiFetch('/api/profile-sync/config')
  const data = await responseData(response)
  if (!response.ok) throw new Error(data.error || `Could not load sync configuration (${response.status})`)
  return data as RemoteSyncConfig
}

export async function clearRemoteSyncConfig(): Promise<void> {
  const response = await apiFetch('/api/profile-sync/config', { method: 'DELETE' })
  const data = await responseData(response)
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Could not clear sync configuration (${response.status})`)
  }
}

export async function runProfileSyncAgent(
  args: string[] = [],
  onProgress?: (progress: RemoteSyncProgress) => void,
  options: { signal?: AbortSignal } = {},
): Promise<RemoteSyncResult> {
  if (options.signal?.aborted) return { success: false, error: 'Stopped waiting for Profile Sync' }
  const response = await apiFetch('/api/unified-queue/trigger/profile-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  const data = await responseData(response)
  if (!response.ok || !data.taskId) {
    return { success: false, error: data.error || `Could not queue Profile Sync (${response.status})` }
  }
  const taskId = String(data.taskId)
  onProgress?.({ phase: 'queued', message: `Profile Sync queued as ${taskId}` })
  return new Promise(resolve => {
    const stream = apiEventSource(`/api/unified-queue/tasks/${encodeURIComponent(taskId)}/stream`)
    let settled = false
    const finish = (success: boolean, error?: string) => {
      if (settled) return
      settled = true
      stream.close()
      options.signal?.removeEventListener('abort', abort)
      onProgress?.({ phase: success ? 'complete' : 'error', message: error || 'Profile Sync completed' })
      resolve({ success, taskId, ...(error ? { error } : {}) })
    }
    const abort = () => finish(false, `Stopped waiting for Profile Sync ${taskId}; the queued job may still be running`)
    stream.onmessage = event => {
      let message: { type?: string; data?: { taskId?: string; message?: string } }
      try {
        message = JSON.parse(event.data)
        if (!message || typeof message.type !== 'string') throw new Error('Invalid task event')
      } catch {
        finish(false, 'Profile Sync returned an invalid task event')
        return
      }
      if (message.type === 'queued_task_completed' && message.data?.taskId === taskId) {
        finish(true)
      } else if (message.type === 'error') {
        finish(false, message.data?.message || 'Profile Sync failed')
      } else if (message.type === 'queued_task_started') {
        onProgress?.({ phase: 'running', message: 'Profile Sync is running' })
      }
    }
    stream.onerror = () => finish(false, `Lost the status connection for Profile Sync ${taskId}; completion is unconfirmed`)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
  })
}
