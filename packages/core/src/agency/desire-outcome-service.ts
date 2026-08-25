import { listDesiresByStatus, loadDesire } from './storage.js'
import { reviewOutcomeViaGraph, type ReviewOutcomeResult } from './executor.js'
import type { Desire } from './types.js'

export interface DesireOutcomeReviewOptions {
  username: string
  desireId?: string
  signal?: AbortSignal
}

export interface DesireOutcomeReviewResult {
  considered: number
  reviewed: number
  skipped: number
  desireIds: string[]
  actions: Record<string, number>
}

export interface DesireOutcomeReviewDependencies {
  loadDesire: typeof loadDesire
  listReviewable: (username: string) => Promise<Desire[]>
  reviewGraph: typeof reviewOutcomeViaGraph
}

const activeReviews = new Set<string>()

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Desire outcome review cancelled', 'AbortError')
}

function isReviewable(desire: Desire): boolean {
  return ['awaiting_review', 'completed', 'failed'].includes(desire.status)
    && !desire.outcomeReview
}

export function createDesireOutcomeReviewer(
  dependencies: Partial<DesireOutcomeReviewDependencies> = {},
) {
  const deps: DesireOutcomeReviewDependencies = {
    loadDesire,
    listReviewable: async username => {
      const groups = await Promise.all(
        ['awaiting_review', 'completed', 'failed'].map(status =>
          listDesiresByStatus(status as Desire['status'], username)),
      )
      return groups.flat().filter(isReviewable)
    },
    reviewGraph: reviewOutcomeViaGraph,
    ...dependencies,
  }

  return async function reviewPendingDesireOutcomes(
    options: DesireOutcomeReviewOptions,
  ): Promise<DesireOutcomeReviewResult> {
    if (!options.username.trim()) throw new Error('Desire outcome review requires a username')
    throwIfAborted(options.signal)

    const desires = options.desireId
      ? [await deps.loadDesire(options.desireId, options.username)]
          .filter((item): item is Desire => Boolean(item))
      : await deps.listReviewable(options.username)
    if (options.desireId && desires.length === 0) {
      throw new Error(`Desire not found: ${options.desireId}`)
    }
    if (options.desireId && !isReviewable(desires[0])) {
      throw new Error(
        `Desire ${options.desireId} is not awaiting an outcome review`,
      )
    }

    const result: DesireOutcomeReviewResult = {
      considered: desires.length,
      reviewed: 0,
      skipped: 0,
      desireIds: [],
      actions: {},
    }

    for (const candidate of desires) {
      throwIfAborted(options.signal)
      const key = `${options.username}:${candidate.id}`
      if (activeReviews.has(key)) {
        result.skipped += 1
        continue
      }
      activeReviews.add(key)
      try {
        const desire = await deps.loadDesire(candidate.id, options.username)
        if (!desire || !isReviewable(desire)) {
          result.skipped += 1
          continue
        }
        const reviewed: ReviewOutcomeResult = await deps.reviewGraph(
          desire,
          options.username,
          options.signal,
        )
        if (!reviewed.success || !reviewed.desire || !reviewed.outcomeReview) {
          throw new Error(reviewed.error || `Outcome graph failed for desire ${desire.id}`)
        }
        const action = reviewed.action || reviewed.verdict || 'unknown'
        result.reviewed += 1
        result.desireIds.push(desire.id)
        result.actions[action] = (result.actions[action] || 0) + 1
      } finally {
        activeReviews.delete(key)
      }
    }

    return result
  }
}

export const reviewPendingDesireOutcomes = createDesireOutcomeReviewer()
