import { listDesiresByStatus, loadDesire, saveDesireManifest } from './storage.js'
import {
  reviewDesireOutcomeViaGraph,
  type DesireOutcomeReviewGraphResult,
} from './executor.js'
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
  transitions: Array<{ desireId: string; action: string; status: Desire['status'] }>
}

export interface DesireOutcomeReviewDependencies {
  loadDesire: typeof loadDesire
  listReviewable: (username: string) => Promise<Desire[]>
  reviewGraph: typeof reviewDesireOutcomeViaGraph
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
    reviewGraph: reviewDesireOutcomeViaGraph,
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
      transitions: [],
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
        const reviewed: DesireOutcomeReviewGraphResult = await deps.reviewGraph(
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
        result.transitions.push({
          desireId: desire.id,
          action,
          status: reviewed.desire.status,
        })
      } finally {
        activeReviews.delete(key)
      }
    }

    return result
  }
}

export const reviewPendingDesireOutcomes = createDesireOutcomeReviewer()


export interface DesireArchiveResult {
  operation: 'archive'
  desireId: string
  archived: boolean
  cancellationRequestedTaskIds: string[]
  executionId?: string
}

/** Archive relevance-exhausted work through the existing outcome lifecycle owner. */
export async function archiveDesireWork(
  username: string,
  desireId: string,
  reason: string,
  currentTaskId: string,
  coordinator: Pick<import('../queue/queue-system.js').QueueSystem, 'getAllTasks' | 'cancelTask' | 'cancelExecution'>,
  storage = { loadDesire, saveDesireManifest },
): Promise<DesireArchiveResult> {
  const desire = await storage.loadDesire(desireId, username)
  if (!desire) throw new Error(`Desire not found: ${desireId}`)
  const result: DesireArchiveResult = { operation: 'archive', desireId, archived: false, cancellationRequestedTaskIds: [] }
  // A newer relevance assessment may have changed this queued request's premise.
  if (desire.strength !== 0) return result
  if (desire.status !== 'archived') {
    const { isOpenDesire } = await import('./lifecycle-policy.js')
    if (!isOpenDesire(desire)) return result
    const now = new Date().toISOString()
    await storage.saveDesireManifest({ ...desire, status: 'archived', currentStage: 'archived',
      dispositionReason: reason, completedAt: now, updatedAt: now }, username)
  }
  result.archived = true
  const executionId = desire.execution?.executionId
  if (executionId) {
    coordinator.cancelExecution(username, executionId, reason)
    result.executionId = executionId
  }
  for (const task of coordinator.getAllTasks()) {
    if (task.id === currentTaskId || task.username !== username
      || !['queued', 'waiting', 'leased'].includes(task.state)) continue
    const args = Array.isArray(task.input.args) ? task.input.args : []
    const argumentIndex = args.indexOf('--desire-id')
    const matches = task.input.desireId === desireId
      || (task.handler === 'agent.desire-planner' && argumentIndex >= 0 && args[argumentIndex + 1] === desireId)
    if (!matches) continue
    coordinator.cancelTask(task.id, reason)
    result.cancellationRequestedTaskIds.push(task.id)
  }
  return result
}
