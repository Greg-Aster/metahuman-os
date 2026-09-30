/** Profile memory reset through the canonical storage and lifecycle owners. */
import fs from 'node:fs'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { audit } from '../../audit.js'
import { getUserByUsername } from '../../users.js'
import { getProfilePaths } from '../../paths.js'
import { validateProfileDeletion, deleteProfileData } from '../../storage-client.js'
import { acquireLock, profileMemoryResetLockName, type LockHandle } from '../../locks.js'
import { listTrainingProcesses } from '../../training-process.js'
import { ensureQueueSystemStarted, getQueueSystem } from '../../queue/queue-system.js'
import type { UnifiedQueueManager } from '../../queue/unified-queue-manager.js'
import { openExecutionStore } from '../../durable-execution/storage.js'
import { ExecutionCheckpointer } from '../../durable-execution/checkpointer.js'
import { clearBufferForUser, type CanonicalBufferMode } from '../../conversation-buffer.js'
import { flushRecentToolCache } from '../../recent-tools-cache.js'
import { clearIndexCache } from '../../vector-index.js'
import { clearMemoryCaptureCache } from '../../memory.js'
import { getAgencyHistoryResetPaths } from '../../agency/storage.js'
import { createTTSDeliveryQueueStore } from '../../tts/delivery-queue.js'

const BUFFER_MODES: CanonicalBufferMode[] = ['conversation', 'inner', 'system', 'robot']

export interface ResetFactoryDependencies {
  coordinator(): Promise<UnifiedQueueManager>
  cancelExecution(username: string, executionId: string, reason: string): void
  trainingProcesses(): ReturnType<typeof listTrainingProcesses>
  clearChatHistory(username: string): Promise<void>
}

const dependencies: ResetFactoryDependencies = {
  coordinator: async () => (await ensureQueueSystemStarted()).queue,
  cancelExecution: (username, executionId, reason) => getQueueSystem().cancelExecution(username, executionId, reason),
  trainingProcesses: listTrainingProcesses,
  clearChatHistory: async username => {
    const { clearPersonaChatHistoryForUser } = await import('./persona-chat.js')
    clearPersonaChatHistoryForUser(username)
  },
}

function directoryEntries(directory: string): string[] {
  try { return fs.readdirSync(directory) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function deletionScope(username: string): string[] {
  validateProfileDeletion(username, ['memory', 'state', 'logs', 'out/chat'])
  const profile = getProfilePaths(username)
  const preserved = new Set(['tasks', 'projects', 'README.md', 'schema.json'])
  return [
    ...getAgencyHistoryResetPaths(username),
    ...directoryEntries(profile.memory).filter(name => !preserved.has(name)).map(name => `memory/${name}`),
    ...directoryEntries(profile.state).filter(name => /^conversation-buffer(?:-|\.)/.test(name))
      .map(name => `state/${name}`),
    'state/recent-tools', 'state/response-buffers', 'logs', 'out/chat',
  ]
}

/** POST /api/reset-factory. Reset only the confirmed, authenticated owner's memory. */
export async function handleResetFactory(req: UnifiedRequest, deps = dependencies): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (req.user.role !== 'owner') return { status: 403, error: 'Only owners can reset profile memory' }
  if (req.signal?.aborted) return { status: 409, error: 'Reset request was cancelled before deletion' }
  const username = req.user.username
  if (req.body?.confirmToken !== 'CONFIRM_FACTORY_RESET' || req.body?.confirmUsername !== username) {
    return { status: 400, error: 'Confirm the signed-in profile by entering its exact username' }
  }
  const user = getUserByUsername(username)
  if (!user || user.id !== req.user.userId || user.role !== 'owner') {
    return { status: 403, error: 'The authenticated profile no longer matches this reset request' }
  }
  let admission: LockHandle | undefined
  let reset: LockHandle | undefined
  let store: ReturnType<typeof openExecutionStore> | undefined
  let started = false
  try {
    try {
      admission = acquireLock('training-admission', { exitOnSignal: false })
      reset = acquireLock(profileMemoryResetLockName(username), { exitOnSignal: false })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return { status: 409, error: 'A reset or training launch is in progress. Wait for it to finish and retry.' }
      }
      throw error
    }
    const relativePaths = deletionScope(username)
    const expectedPaths = validateProfileDeletion(username, relativePaths)
    const configuredProfileRoot = getProfilePaths(username).root
    const profileRoot = fs.realpathSync(configuredProfileRoot)
    const assertStorageUnchanged = () => {
      if (fs.realpathSync(getProfilePaths(username).root) !== profileRoot) throw new Error('Profile storage changed during reset')
    }
    const queue = await deps.coordinator()
    try { queue.assertProfileIdle(username) }
    catch (error) { return { status: 409, error: `${(error as Error).message}. Open Queue in the right sidebar, then retry.` } }
    if (deps.trainingProcesses().some(process => !process.username || process.username === username)) {
      return { status: 409, error: 'Stop this profile\'s training and wait for its worker to exit, then retry.' }
    }
    const [executionPath] = validateProfileDeletion(username, ['state/sessions/executions.sqlite', 'state/tts-queue.json'])
    let checkpointer: ExecutionCheckpointer | undefined
    if (fs.existsSync(executionPath)) {
      store = openExecutionStore(username)
      checkpointer = new ExecutionCheckpointer(store, { executionId: '', owner: 'profile-memory-reset', generation: 0 })
      try { checkpointer.assertProfileHistoryCanBeReset(username) }
      catch (error) { return { status: 409, error: (error as Error).message } }
    }
    await flushRecentToolCache(configuredProfileRoot)
    assertStorageUnchanged()
    if (req.signal?.aborted) return { status: 409, error: 'Reset request was cancelled before deletion' }
    audit({ level: 'warn', category: 'security', event: 'profile_memory_reset_started', actor: username,
      details: { username } })
    started = true
    // The confirmed reset ends saved conversations as well as removing their
    // history. Preflight excluded live writers and unresolved effects across the
    // whole profile; cancellation stays with the existing Coordinator owner.
    for (const execution of store?.list(username) ?? []) {
      if (!['completed', 'failed', 'cancelled'].includes(execution.status)) {
        deps.cancelExecution(username, execution.executionId, 'Profile memory reset confirmed by owner')
      }
    }
    const executionsDeleted = checkpointer?.resetProfileHistory(username) ?? 0
    queue.forgetProfileHistory(username)
    if (store) for (const id of store.retirements()) store.acknowledgeRetirement(id)
    await deps.clearChatHistory(username)
    clearMemoryCaptureCache(username)
    assertStorageUnchanged()
    createTTSDeliveryQueueStore(username).resetHistory()
    await deleteProfileData(username, relativePaths, expectedPaths)
    for (const mode of BUFFER_MODES) {
      assertStorageUnchanged()
      if (!await clearBufferForUser(username, mode)) throw new Error(`Failed to clear the ${mode} buffer`)
    }
    clearIndexCache()
    audit({ level: 'warn', category: 'security', event: 'profile_memory_reset_completed', actor: username,
      details: { username, executionsDeleted } })
    return successResponse({ success: true, username, executionsDeleted })
  } catch (error) {
    const message = (error as Error).message
    audit({ level: 'error', category: 'security', event: 'profile_memory_reset_failed', actor: username,
      details: { username, deletionStarted: started, error: message } })
    return { status: 500, error: started
      ? `Memory reset is incomplete; some data may have been removed. Resolve the error and retry: ${message}`
      : `Memory reset could not start: ${message}` }
  } finally {
    store?.close()
    reset?.release()
    admission?.release()
  }
}

export async function handleResetFactoryGet(_req: UnifiedRequest): Promise<UnifiedResponse> {
  return { status: 405, error: 'Method not allowed' }
}
