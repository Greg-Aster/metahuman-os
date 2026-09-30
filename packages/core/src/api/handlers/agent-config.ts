/** Existing agent controls delegate to the profile model-settings owner. */
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { loadModelRegistry, updateModelGlobalSettings } from '../../model-resolver.js'
import { audit } from '../../audit.js'

export async function handleGetAgentConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    const registry = loadModelRegistry(false, req.user.username)
    return successResponse({ success: true, config: { includePersonaSummary: registry.globalSettings?.includePersonaSummary !== false } })
  } catch (error) { return { status: 500, error: (error as Error).message } }
}

export async function handleSetAgentConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (req.user.role !== 'owner') return { status: 403, error: 'Owner role required' }
  try {
    const config = updateModelGlobalSettings(req.user.username, req.body)
    audit({ level: 'info', category: 'security', event: 'agent_config_updated', details: config, actor: req.user.username })
    return successResponse({ success: true, config })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
