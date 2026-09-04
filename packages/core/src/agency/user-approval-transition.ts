import {
  addScratchpadEntryToFolder,
  saveDesireManifest,
} from './storage.js'
import {
  initializeDesireMetrics,
  initializeStageIterations,
  statusToStage,
  type Desire,
} from './types.js'
import { validateDesireForUserApproval } from './lifecycle-policy.js'

export interface UserApprovalTransitionDependencies {
  addScratchpadEntry: typeof addScratchpadEntryToFolder
  saveManifest: typeof saveDesireManifest
  now: () => string
}

export async function approveDesireForExecution(
  desire: Desire,
  username: string,
  dependencies: Partial<UserApprovalTransitionDependencies> = {},
): Promise<Desire> {
  const deps: UserApprovalTransitionDependencies = {
    addScratchpadEntry: addScratchpadEntryToFolder,
    saveManifest: saveDesireManifest,
    now: () => new Date().toISOString(),
    ...dependencies,
  }

  if (!username.trim()) throw new Error('Desire approval requires a username')
  const validationError = validateDesireForUserApproval(desire)
  if (validationError) throw new Error(validationError)

  const now = deps.now()
  const scratchpad = await deps.addScratchpadEntry(desire.id, {
    timestamp: now,
    type: 'approved',
    description: `User approved plan version ${desire.plan!.version} for execution`,
    actor: 'user',
    data: {
      fromStatus: desire.status,
      planId: desire.plan!.id,
      planVersion: desire.plan!.version,
      reviewId: desire.review!.id,
      idempotencyKey: `desire-plan-approval:${desire.id}:v${desire.plan!.version}`,
    },
  }, username)
  const metrics = desire.metrics || initializeDesireMetrics()
  const stageIterations = desire.stageIterations || initializeStageIterations()
  const updated: Desire = {
    ...desire,
    status: 'approved',
    currentStage: statusToStage('approved'),
    activatedAt: desire.activatedAt || now,
    updatedAt: now,
    scratchpad,
    metrics: {
      ...metrics,
      userApprovalCount: metrics.userApprovalCount + 1,
      lastActivityAt: now,
    },
    stageIterations: {
      ...stageIterations,
      userApproval: stageIterations.userApproval + 1,
    },
  }

  await deps.saveManifest(updated, username)
  return updated
}
