/** Thin credentials-sync transport over the canonical Profile Sync owner. */

import {
  applySyncableCredentials,
  getSyncableCredentials,
  type SyncableCredentials,
} from '../../profile-sync.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

function requireOwner(req: UnifiedRequest): UnifiedResponse | null {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (req.user.role !== 'owner') return { status: 403, error: 'Owner role required' }
  return null
}

/** GET /api/profile-sync/credentials */
export async function handleGetCredentialsSync(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req)
  if (authError) return authError
  try {
    const credentials = await getSyncableCredentials(req.user.username)
    return successResponse({ success: true, credentials, syncedAt: new Date().toISOString() })
  } catch (error) {
    return { status: 500, error: (error as Error).message }
  }
}

/** POST /api/profile-sync/credentials */
export async function handleSaveCredentialsSync(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireOwner(req)
  if (authError) return authError
  const credentials = req.body?.credentials as SyncableCredentials | undefined
  if (!credentials) return { status: 400, error: 'No credentials provided' }
  try {
    const result = await applySyncableCredentials(req.user.username, credentials)
    if (!result.success) {
      return { status: 500, data: result, error: result.errors.join('; ') }
    }
    return successResponse(result)
  } catch (error) {
    return { status: 400, error: (error as Error).message }
  }
}
