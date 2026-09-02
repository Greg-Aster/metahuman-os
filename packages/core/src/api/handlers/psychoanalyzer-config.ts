import { audit } from '../../audit.js'
import {
  loadPsychoanalyzerConfig,
  mergePsychoanalyzerConfig,
  savePsychoanalyzerConfig,
} from '../../psychoanalyzer-config.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

export async function handleGetPsychoanalyzerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    return successResponse({
      success: true,
      config: loadPsychoanalyzerConfig(req.user.username),
    })
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to load config:', error)
    return { status: 500, error: (error as Error).message }
  }
}

export async function handleSetPsychoanalyzerConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req
  if (!user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (user.role !== 'owner') return { status: 403, error: 'Only owner can update psychoanalyzer config' }

  let config
  try {
    config = mergePsychoanalyzerConfig(loadPsychoanalyzerConfig(user.username), body)
  } catch (error) {
    return { status: 400, error: (error as Error).message }
  }

  try {
    savePsychoanalyzerConfig(user.username, config)
    audit({
      level: 'info',
      category: 'system',
      event: 'psychoanalyzer_config_updated',
      details: { fields: Object.keys(body ?? {}) },
      actor: user.username,
    })
    return successResponse({ success: true, config })
  } catch (error) {
    console.error('[psychoanalyzer-config] Failed to update config:', error)
    return { status: 500, error: (error as Error).message }
  }
}
