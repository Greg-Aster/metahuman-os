#!/usr/bin/env node
import {
  getTargetUser, withUserContext, loadGraphForMode, runGraph, requireGraphNodeOutput,
  readEnvironmentTrainingBank, readEnvironmentTrainingReviews,
  readFreestyleTrainingBank, readFreestyleTrainingReviews,
  readEnvironmentTrainingProposal,
} from '@metahuman/core'

type Bank = 'decision' | 'freestyle'

function option(name: string): string | undefined {
  const position = process.argv.indexOf(`--${name}`)
  return position < 0 ? undefined : process.argv[position + 1]
}

async function main() {
  const username = option('username') || process.env.MH_TRIGGER_USERNAME
  const user = getTargetUser(username ? { username } : undefined)
  if (!user) throw new Error('An authenticated profile is required')
  const bankOption = option('bank') || 'all'
  if (!['all', 'decision', 'freestyle'].includes(bankOption)) throw new Error('--bank must be decision, freestyle, or all')
  const limit = Number(option('limit') || 10)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1..100')
  const force = process.argv.includes('--force')
  await withUserContext(user, async () => {
    const { graph } = await loadGraphForMode('environment-training-curator', user.username)
    const candidates: Array<
      | { bank: 'decision'; candidate: ReturnType<typeof readEnvironmentTrainingBank>['candidates'][number] }
      | { bank: 'freestyle'; candidate: ReturnType<typeof readFreestyleTrainingBank>[number] }
    > = [
      ...(bankOption === 'freestyle' ? [] : readEnvironmentTrainingBank(user.username).candidates
        .map(candidate => ({ bank: 'decision' as const, candidate }))),
      ...(bankOption === 'decision' ? [] : readFreestyleTrainingBank(user.username)
        .map(candidate => ({ bank: 'freestyle' as const, candidate }))),
    ].sort((a, b) => a.candidate.recordedAt.localeCompare(b.candidate.recordedAt))
    const reviewed = new Set([
      ...readEnvironmentTrainingReviews(user.username).reviews.map(review => review.candidateId),
      ...readFreestyleTrainingReviews(user.username).reviews.map(review => review.candidateId),
    ])
    let attempted = 0, saved = 0
    for (const { bank, candidate } of candidates) {
      if (attempted >= limit) break
      if (reviewed.has(candidate.id) || !force && readEnvironmentTrainingProposal(user.username, bank, candidate.id)) continue
      attempted++
      const state = await runGraph({ graph, context: {
        username: user.username, userId: user.userId, cognitiveMode: 'environment',
        environmentTrainingReview: { bank, candidateId: candidate.id },
      } })
      if (state.status !== 'completed') {
        throw state.error ?? new Error(`Training curator graph failed for ${candidate.id}`)
      }
      const result = requireGraphNodeOutput(state, 'environment_training_review_save')
      if (result.saved !== true) {
        throw new Error(`Training curator graph did not save its proposal for ${candidate.id}`)
      }
      saved++
    }
    console.log(JSON.stringify({ username: user.username, attempted, proposalsSaved: saved }))
  })
}

main().catch(error => { console.error(error); process.exitCode = 1 })
