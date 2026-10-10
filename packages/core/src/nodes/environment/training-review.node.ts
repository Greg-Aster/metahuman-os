import {
  readEnvironmentTrainingBank, readFreestyleTrainingBank,
  readEnvironmentTrainingEvidenceForProfile, saveEnvironmentTrainingProposal,
} from '../../environment-training-bank.js'
import { defineNode } from '../types.js'
import { environmentTrainingReviewInputSchema, environmentTrainingReviewSaveSchema } from './training-review.schemas.js'

type Bank = 'decision' | 'freestyle'

function reviewIdentity(context: Record<string, any>): { username: string; bank: Bank; candidateId: string } {
  const username = context.username
  const request = context.environmentTrainingReview
  if (typeof username !== 'string' || !username
    || !request || !['decision', 'freestyle'].includes(request.bank)
    || typeof request.candidateId !== 'string' || !request.candidateId) {
    throw new Error('Training curator requires a profile, bank, and saved decision identity')
  }
  return { username, bank: request.bank, candidateId: request.candidateId }
}

export const environmentTrainingReviewInputNode = defineNode({
  ...environmentTrainingReviewInputSchema,
  async execute(_inputs, context, properties) {
    const { username, bank, candidateId } = reviewIdentity(context)
    const candidate = bank === 'freestyle'
      ? readFreestyleTrainingBank(username).find(value => value.id === candidateId)
      : readEnvironmentTrainingBank(username).candidates.find(value => value.id === candidateId)
    if (!candidate) throw new Error(`Training decision ${candidateId} does not exist`)
    const systemPrompt = properties?.systemPrompt
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) throw new Error('Training curator graph has no instructions')
    const evidence = readEnvironmentTrainingEvidenceForProfile(username, candidate.executionId)
    const specialist = 'specialist' in candidate ? candidate.specialist : 'freestyle'
    const generation = 'generationError' in candidate
      ? { generationError: candidate.generationError, validatedAction: candidate.generatedAction }
      : {}
    return {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ specialist,
          originalInput: { system: candidate.system, user: candidate.user },
          originalOutput: candidate.observedOutput, ...generation,
          executionEvidence: evidence }) },
      ],
      bank, candidateId, sourceDigest: candidate.sourceDigest,
    }
  },
})

export const environmentTrainingReviewSaveNode = defineNode({
  ...environmentTrainingReviewSaveSchema,
  async execute(inputs, context) {
    const { username } = reviewIdentity(context)
    const bank = inputs.bank as Bank
    const candidateId = String(inputs.candidateId ?? '')
    const sourceDigest = String(inputs.sourceDigest ?? '')
    const parsed = JSON.parse(String(inputs.response ?? '')) as Record<string, unknown>
    const correction = parsed.correctedOutput ?? parsed.corrected_output ?? parsed['corrected output']
    const correctedOutput = typeof correction === 'string' ? correction
      : correction && typeof correction === 'object' ? JSON.stringify(correction) : undefined
    if (!['correct', 'incorrect', 'uncertain'].includes(String(parsed.verdict))
      || typeof parsed.reason !== 'string' || !parsed.reason.trim()
      || parsed.verdict === 'incorrect' && !correctedOutput?.trim()) {
      throw new Error(`Curator returned an incomplete review for ${candidateId}`)
    }
    saveEnvironmentTrainingProposal(username, bank, {
      candidateId, sourceDigest, verdict: parsed.verdict as 'correct' | 'incorrect' | 'uncertain',
      reason: parsed.reason, ...(correctedOutput ? { correctedOutput } : {}),
    })
    return { saved: true, verdict: parsed.verdict }
  },
})
