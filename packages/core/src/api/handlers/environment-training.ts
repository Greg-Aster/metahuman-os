import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { errorResponse, forbiddenResponse, successResponse, unauthorizedResponse } from '../types.js'
import { getSecurityPolicy } from '../../security-policy.js'
import { openExecutionStore } from '../../durable-execution/storage.js'
import {
  readEnvironmentTrainingBank, readEnvironmentTrainingReviews, readFreestyleTrainingBank,
  readFreestyleTrainingReviews, readEnvironmentTrainingEvidence, readEnvironmentTrainingProposal,
  reviewEnvironmentTrainingCandidate, reviewFreestyleTrainingCandidate,
} from '../../environment-training-bank.js'

function reviewInventory(username: string) {
  const decisions = readEnvironmentTrainingBank(username).candidates
  const freestyle = readFreestyleTrainingBank(username)
  const decisionReviews = new Map(readEnvironmentTrainingReviews(username).reviews.map(review => [review.candidateId, review]))
  const freestyleReviews = new Map(readFreestyleTrainingReviews(username).reviews.map(review => [review.candidateId, review]))
  return { decisions, freestyle, decisionReviews, freestyleReviews }
}

export async function handleGetEnvironmentTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return unauthorizedResponse('Authentication required')
  if (!getSecurityPolicy({ username: req.user.username }).canReadMemory) return forbiddenResponse('Memory reading is unavailable')
  try {
    const inventory = reviewInventory(req.user.username)
    const id = req.query?.id
    const bank = req.query?.bank
    if (id) {
      const candidate = bank === 'freestyle'
        ? inventory.freestyle.find(value => value.id === id)
        : inventory.decisions.find(value => value.id === id)
      if (!candidate) return errorResponse('Training record not found', 404)
      const review = bank === 'freestyle' ? inventory.freestyleReviews.get(id) : inventory.decisionReviews.get(id)
      const store = openExecutionStore(req.user.username)
      try {
        return successResponse({ candidate, review: review ?? null,
          proposal: readEnvironmentTrainingProposal(req.user.username, bank === 'freestyle' ? 'freestyle' : 'decision', id),
          executionEvidence: readEnvironmentTrainingEvidence(store, candidate.executionId) })
      } finally { store.close() }
    }
    const items = [
      ...inventory.decisions.map(candidate => ({ id: candidate.id, bank: 'decision' as const,
        specialist: candidate.specialist, recordedAt: candidate.recordedAt,
        executionId: candidate.executionId, preview: candidate.observedOutput.slice(0, 180),
        review: inventory.decisionReviews.get(candidate.id)?.decision ?? 'pending' })),
      ...inventory.freestyle.map(candidate => ({ id: candidate.id, bank: 'freestyle' as const,
        specialist: 'freestyle', recordedAt: candidate.recordedAt,
        executionId: candidate.executionId, preview: candidate.observedOutput.slice(0, 180) || candidate.generationError,
        review: inventory.freestyleReviews.get(candidate.id)?.decision ?? 'pending' })),
    ].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id))
    return successResponse({ items })
  } catch (error) { return errorResponse((error as Error).message, 500) }
}

export async function handleReviewEnvironmentTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return unauthorizedResponse('Authentication required')
  if (!getSecurityPolicy({ username: req.user.username }).canWriteMemory) return forbiddenResponse('Memory writing is unavailable')
  const body = req.body
  if (!body || !['decision', 'freestyle'].includes(body.bank)
    || typeof body.id !== 'string' || !['accept', 'correct', 'reject', 'defer'].includes(body.decision)
    || typeof body.reason !== 'string' || !body.reason.trim()
    || body.decision === 'correct' && typeof body.correctedOutput !== 'string') {
    return errorResponse('Review requires a bank, record ID, decision, reason and corrected output when correcting', 400)
  }
  try {
    const review = { candidateId: body.id, decision: body.decision, reason: body.reason,
      correctedOutput: body.correctedOutput }
    if (body.bank === 'freestyle') reviewFreestyleTrainingCandidate(req.user.username, review)
    else reviewEnvironmentTrainingCandidate(req.user.username, review)
    return successResponse({ reviewed: body.id, decision: body.decision })
  } catch (error) { return errorResponse((error as Error).message, 400) }
}
