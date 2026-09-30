import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { listTrainingCandidates, getActiveAdapter } from '../../adapters.js'

export async function handleGetFineTuneModels(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (req.user.role !== 'owner') return { status: 403, error: 'Owner role required' }
  try {
    const active = getActiveAdapter(req.user.username)
    const models = listTrainingCandidates(req.user.username).filter(run => run.method === 'fine-tune').map(run => ({
      ...run, runId: run.runLabel, username: req.user.username, modelPath: run.candidateDirectory,
      totalSamples: run.trainingSamples, trainingSuccess: run.status === 'candidate',
      isActive: active?.runLabel === run.runLabel,
    }))
    return successResponse({ success: true, models, count: models.length })
  } catch (error) { return { status: 500, error: (error as Error).message } }
}
