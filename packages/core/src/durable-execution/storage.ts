import { profileDataCodec, resolvePath } from '../storage-client.js'
import { ExecutionStore } from './store.js'
import { getAuthenticatedRuntimeId } from '../sessions.js'

/** One profile-resolved database for graph checkpoints, events and pending effects. */
export function openExecutionStore(username: string): ExecutionStore {
  if (!username.trim()) throw new Error('Durable execution requires a profile owner')
  const resolved = resolvePath({ username, category: 'state', subcategory: 'sessions', relativePath: 'executions.sqlite' })
  if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Execution storage is unavailable')
  return new ExecutionStore(resolved.path, profileDataCodec(username), getAuthenticatedRuntimeId())
}
