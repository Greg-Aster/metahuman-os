import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { getAutomaticTrainingStatus, saveAutomaticTrainingConfig } from '../../training-automation.js'

export async function handleGetAutomaticTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try { return successResponse(getAutomaticTrainingStatus(req.user.username)) }
  catch (error) { return { status: 500, error: (error as Error).message } }
}

export async function handleUpdateAutomaticTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    saveAutomaticTrainingConfig(req.user.username, req.body)
    return successResponse({ ...getAutomaticTrainingStatus(req.user.username), success: true })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
