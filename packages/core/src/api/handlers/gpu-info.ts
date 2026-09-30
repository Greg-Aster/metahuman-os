import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { getTrainingCapabilities } from '../../training-launch.js'

export async function handleGetGpuInfo(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try { return successResponse(await getTrainingCapabilities(req.user.username)) }
  catch (error) { return { status: 500, error: (error as Error).message } }
}
