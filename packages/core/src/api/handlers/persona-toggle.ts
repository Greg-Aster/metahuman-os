/** Persona controls share the profile registry; adapter status is a role projection. */
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { loadModelRegistry, updateModelGlobalSettings } from '../../model-resolver.js'
import { getActiveAdapter } from '../../adapters.js'
import { audit } from '../../audit.js'

export async function handleGetPersonaToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    const registry = loadModelRegistry(false, req.user.username)
    const active = getActiveAdapter(req.user.username)
    return successResponse({ success: true, includePersonaSummary: registry.globalSettings?.includePersonaSummary !== false,
      useAdapter: active !== null, activeAdapter: active?.modelName ?? null })
  } catch (error) { return { status: 500, error: (error as Error).message } }
}

export async function handleSetPersonaToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (typeof req.body?.enabled !== 'boolean') return { status: 400, error: 'enabled must be a boolean' }
  try {
    const settings = updateModelGlobalSettings(req.user.username, { includePersonaSummary: req.body.enabled })
    audit({ level: 'info', category: 'action', event: 'persona_summary_toggled',
      details: { enabled: settings.includePersonaSummary }, actor: req.user.username })
    return successResponse({ success: true, ...settings })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
