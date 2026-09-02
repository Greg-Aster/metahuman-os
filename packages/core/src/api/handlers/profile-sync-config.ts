/** Authenticated transport for per-profile remote sync configuration. */

import {
  clearProfileSyncConfig,
  loadProfileSyncConfig,
  profileSyncConfigSummary,
  saveProfileSyncConfig,
} from '../../profile-sync.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

function requireUser(req: UnifiedRequest): UnifiedResponse | null {
  return req.user.isAuthenticated ? null : { status: 401, error: 'Authentication required' }
}

export async function handleGetProfileSyncConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req)
  if (authError) return authError
  try {
    return successResponse(profileSyncConfigSummary(await loadProfileSyncConfig(req.user.username)))
  } catch (error) {
    return { status: 500, error: (error as Error).message }
  }
}

export async function handlePutProfileSyncConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req)
  if (authError) return authError
  try {
    return successResponse(await saveProfileSyncConfig(req.user.username, req.body))
  } catch (error) {
    return { status: 400, error: (error as Error).message }
  }
}

export async function handleDeleteProfileSyncConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const authError = requireUser(req)
  if (authError) return authError
  try {
    await clearProfileSyncConfig(req.user.username)
    return successResponse({ success: true })
  } catch (error) {
    return { status: 500, error: (error as Error).message }
  }
}
