import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { listTrainingBaseModels } from '../../training-launch.js'

export async function handleGetTrainingModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    return successResponse({ success: true, models: listTrainingBaseModels(req.user.username), cached: false,
      notes: { usage: 'Training uses native Hugging Face weights or a compatible local weight directory. Inference-only Ollama tags are not training bases.',
        setup_guide: '/user-guide#ai-training' } })
  } catch (error) { return { status: 500, error: (error as Error).message } }
}
