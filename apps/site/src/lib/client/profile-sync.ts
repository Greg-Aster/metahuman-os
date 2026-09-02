/** Browser adapter for the canonical server-side Profile Sync agent. */

import { apiFetch, normalizeUrl, remoteFetch } from './api-config'

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

interface QueueTaskView {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  state: string
  error?: string
}

async function responseData(response: Response): Promise<Record<string, any>> {
  return await response.json().catch(() => ({}))
}

export async function testRemoteServerConnection(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await remoteFetch(`${normalizeUrl(serverUrl)}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await responseData(response)
    if (!response.ok || data.success === false) {
      return { success: false, error: data.error || `Remote server returned ${response.status}` }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Connection failed' }
  }
}

export async function configureRemoteSyncServer(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  const connection = await testRemoteServerConnection(serverUrl, username, password)
  if (!connection.success) return connection
  const response = await apiFetch('/api/profile-sync/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, username, password }),
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

async function readTask(taskId: string): Promise<QueueTaskView> {
  const response = await apiFetch(`/api/unified-queue/tasks/${encodeURIComponent(taskId)}`)
  const data = await responseData(response)
  if (!response.ok || !data.task) throw new Error(data.error || `Could not read sync task (${response.status})`)
  return data.task as QueueTaskView
}

export async function runProfileSyncAgent(
  args: string[] = [],
  onProgress?: (progress: RemoteSyncProgress) => void,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RemoteSyncResult> {
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
  const timeoutMs = options.timeoutMs ?? 5 * 60_000
  const deadline = Date.now() + timeoutMs
  onProgress?.({ phase: 'queued', message: `Profile Sync queued as ${taskId}` })
  while (Date.now() < deadline) {
    if (options.signal?.aborted) return { success: false, taskId, error: 'Stopped waiting for Profile Sync' }
    const task = await readTask(taskId)
    if (task.status === 'completed') {
      onProgress?.({ phase: 'complete', message: 'Profile Sync completed' })
      return { success: true, taskId }
    }
    if (task.status === 'failed') {
      const error = task.error || `Profile Sync ${task.state}`
      onProgress?.({ phase: 'error', message: error })
      return { success: false, taskId, error }
    }
    onProgress?.({
      phase: task.status === 'running' ? 'running' : 'queued',
      message: task.status === 'running' ? 'Profile Sync is running' : 'Profile Sync is waiting to run',
    })
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return { success: false, taskId, error: `Profile Sync is still running as ${taskId}` }
}
