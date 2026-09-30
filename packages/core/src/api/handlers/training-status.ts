import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { readTrainingOperations } from '../../training-process.js'

export async function handleGetTrainingStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try { return successResponse({ operations: readTrainingOperations(req.user.username) }) }
  catch (error) { return { status: 500, error: (error as Error).message } }
}
