/** Thin history transport. Process history belongs to training-process. */
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'
import { readTrainingHistoryForUser, listUnconfirmedTrainingCleanup, recoverTrainingCleanup } from '../../training-process.js'
import { listTrainingCandidates, prepareTrainingCandidate, testTrainingCandidate, decideTrainingCandidate, reopenTrainingCandidateReview } from '../../adapters.js'

/** GET /api/training/history */
export async function handleGetTrainingHistory(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  try {
    const runs = readTrainingHistoryForUser(req.user.username)
    return successResponse({ success: true, runs, count: runs.length, candidates: listTrainingCandidates(req.user.username), cleanup: listUnconfirmedTrainingCleanup(req.user.username) })
  } catch (error) {
    return { status: 500, error: (error as Error).message }
  }
}

export async function handleReviewTrainingCandidate(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' }
  if (req.user.role !== 'owner') return { status: 403, error: 'Owner role required' }
  const body = req.body
  if (!body || typeof body.runLabel !== 'string') return { status: 400, error: 'A training run is required' }
  try {
    const result = body.action === 'prepare' ? await prepareTrainingCandidate(req.user.username, body.runLabel)
      : body.action === 'test' ? await testTrainingCandidate(req.user.username, body.runLabel, body)
      : body.action === 'decide' ? await decideTrainingCandidate(req.user.username, body.runLabel, body)
      : body.action === 'reopen' ? await reopenTrainingCandidateReview(req.user.username, body.runLabel)
      : body.action === 'recover-cleanup' ? await recoverTrainingCleanup(req.user.username, body.runLabel) : null
    if (!result) return { status: 400, error: 'Unknown candidate review action' }
    return successResponse({ success: true, result })
  } catch (error) { return { status: 400, error: (error as Error).message } }
}
