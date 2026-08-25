import {
  addScratchpadEntryToFolder,
  listDesiresByStatus,
  loadDesire,
  saveDesireManifest,
} from './storage.js'
import {
  executeDesireViaGraph,
  type DesireProgressCallback,
  type ExecuteDesireResult,
} from './executor.js'
import type { Desire, DesireExecution } from './types.js'

export interface ApprovedDesireExecutionOptions {
  username: string
  desireId?: string
  signal?: AbortSignal
  onProgress?: DesireProgressCallback
}

export interface ApprovedDesireExecutionResult {
  considered: number
  executed: number
  succeeded: number
  failed: number
  skipped: number
  desireIds: string[]
}

export interface DesireExecutionDependencies {
  loadDesire: typeof loadDesire
  listApproved: (username: string) => Promise<Desire[]>
  saveManifest: typeof saveDesireManifest
  addScratchpadEntry: typeof addScratchpadEntryToFolder
  executeGraph: typeof executeDesireViaGraph
}

const activeExecutions = new Set<string>()

function executionKey(username: string, desireId: string): string {
  return `${username}:${desireId}`
}

function cancellationError(signal: AbortSignal): Error {
  const reason = signal.reason
  return reason instanceof Error
    ? reason
    : new DOMException(typeof reason === 'string' ? reason : 'Desire execution cancelled', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationError(signal)
}

function validateExecutableDesire(desire: Desire): void {
  if (desire.status !== 'approved') {
    throw new Error(`Cannot execute desire ${desire.id} in '${desire.status}' status; expected 'approved'`)
  }
  if (!desire.plan?.steps?.length) {
    throw new Error(`Cannot execute desire ${desire.id} without an approved plan`)
  }
}

function failedExecution(desire: Desire, error: string, startedAt: string): DesireExecution {
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    status: 'failed',
    stepsCompleted: desire.execution?.stepsCompleted || 0,
    stepsTotal: desire.plan?.steps.length || 0,
    stepResults: desire.execution?.stepResults || [],
    error,
  }
}

async function recordInfrastructureFailure(
  deps: DesireExecutionDependencies,
  claimed: Desire,
  username: string,
  error: string,
): Promise<void> {
  const current = await deps.loadDesire(claimed.id, username)
  if (!current || current.status !== 'executing') return

  const now = new Date().toISOString()
  const execution = failedExecution(current, error, claimed.execution?.startedAt || now)
  const updated: Desire = {
    ...current,
    status: 'awaiting_review',
    currentStage: 'outcome_review',
    execution,
    updatedAt: now,
    metrics: current.metrics
      ? {
          ...current.metrics,
          executionAttemptCount: current.metrics.executionAttemptCount + 1,
          executionFailCount: current.metrics.executionFailCount + 1,
          lastActivityAt: now,
        }
      : current.metrics,
    stageIterations: {
      planning: current.stageIterations?.planning || 0,
      planReview: current.stageIterations?.planReview || 0,
      userApproval: current.stageIterations?.userApproval || 0,
      executing: (current.stageIterations?.executing || 0) + 1,
      outcomeReview: current.stageIterations?.outcomeReview || 0,
    },
  }

  await deps.saveManifest(updated, username)
  await deps.addScratchpadEntry(claimed.id, {
    timestamp: now,
    type: 'execution_failed',
    description: `Execution infrastructure failed: ${error}`,
    actor: 'system',
    data: {
      status: execution.status,
      error,
      stepsCompleted: execution.stepsCompleted,
      stepsTotal: execution.stepsTotal,
    },
  }, username)
}

async function executeOne(
  deps: DesireExecutionDependencies,
  desire: Desire,
  options: ApprovedDesireExecutionOptions,
): Promise<ExecuteDesireResult | null> {
  const key = executionKey(options.username, desire.id)
  if (activeExecutions.has(key)) return null
  activeExecutions.add(key)

  try {
    throwIfAborted(options.signal)
    const current = await deps.loadDesire(desire.id, options.username)
    if (!current || current.status !== 'approved') return null
    validateExecutableDesire(current)

    const now = new Date().toISOString()
    const claimed: Desire = {
      ...current,
      status: 'executing',
      updatedAt: now,
      execution: {
        startedAt: now,
        status: 'in_progress',
        stepsCompleted: 0,
        stepsTotal: current.plan!.steps.length,
        stepResults: [],
      },
    }
    await deps.saveManifest(claimed, options.username)

    const result = await deps.executeGraph(
      claimed,
      options.username,
      options.onProgress,
      options.signal,
    )
    if (!result.graphCompleted) {
      const message = result.error || 'Desire execution graph did not complete'
      await recordInfrastructureFailure(deps, claimed, options.username, message)
      throw new Error(message)
    }

    return result
  } catch (error) {
    const message = (error as Error).message
    try {
      const current = await deps.loadDesire(desire.id, options.username)
      if (current?.status === 'executing') {
        await recordInfrastructureFailure(deps, current, options.username, message)
      }
    } catch (persistenceError) {
      throw new AggregateError(
        [error, persistenceError],
        `Desire ${desire.id} failed and its failure state could not be persisted`,
      )
    }
    throw error
  } finally {
    activeExecutions.delete(key)
  }
}

export function createApprovedDesireExecutor(dependencies: Partial<DesireExecutionDependencies> = {}) {
  const deps: DesireExecutionDependencies = {
    loadDesire,
    listApproved: username => listDesiresByStatus('approved', username),
    saveManifest: saveDesireManifest,
    addScratchpadEntry: addScratchpadEntryToFolder,
    executeGraph: executeDesireViaGraph,
    ...dependencies,
  }

  return async function executeApprovedDesires(
    options: ApprovedDesireExecutionOptions,
  ): Promise<ApprovedDesireExecutionResult> {
    if (!options.username.trim()) throw new Error('Desire execution requires a username')
    throwIfAborted(options.signal)

    const desires = options.desireId
      ? [await deps.loadDesire(options.desireId, options.username)].filter((item): item is Desire => Boolean(item))
      : await deps.listApproved(options.username)
    if (options.desireId && desires.length === 0) {
      throw new Error(`Desire not found: ${options.desireId}`)
    }

    const summary: ApprovedDesireExecutionResult = {
      considered: desires.length,
      executed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      desireIds: [],
    }

    for (const desire of desires) {
      throwIfAborted(options.signal)
      const result = await executeOne(deps, desire, options)
      if (!result) {
        summary.skipped += 1
        continue
      }
      summary.executed += 1
      summary.desireIds.push(desire.id)
      if (result.success) summary.succeeded += 1
      else summary.failed += 1
    }

    return summary
  }
}

export const executeApprovedDesires = createApprovedDesireExecutor()
