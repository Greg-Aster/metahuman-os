import type { Desire, DesireStatus } from './types.js'

const OWNER_ADVANCE_TARGETS: Record<DesireStatus, DesireStatus[]> = {
  nascent: ['pending', 'planning', 'abandoned'],
  pending: ['planning', 'abandoned'],
  evaluating: ['planning', 'abandoned'],
  planning: ['abandoned'],
  questioning: ['planning', 'abandoned'],
  reviewing: ['planning', 'abandoned'],
  awaiting_approval: ['planning', 'abandoned'],
  approved: ['planning', 'abandoned'],
  executing: ['abandoned'],
  awaiting_review: ['abandoned'],
  completed: ['abandoned'],
  rejected: ['pending'],
  abandoned: ['pending'],
  failed: ['pending', 'abandoned'],
}

const OWNER_RESET_TARGETS: readonly DesireStatus[] = ['nascent', 'pending', 'planning']

export function allowedOwnerAdvanceTargets(status: DesireStatus): readonly DesireStatus[] {
  return OWNER_ADVANCE_TARGETS[status]
}

export function canOwnerAdvanceDesire(from: DesireStatus, to: DesireStatus): boolean {
  return OWNER_ADVANCE_TARGETS[from].includes(to)
}

export function allowedOwnerResetTargets(): readonly DesireStatus[] {
  return OWNER_RESET_TARGETS
}

export function canOwnerResetDesireTo(status: DesireStatus): boolean {
  return OWNER_RESET_TARGETS.includes(status)
}

export function validateDesireForUserApproval(desire: Desire): string | null {
  if (desire.status !== 'awaiting_approval') {
    return `Cannot approve desire in '${desire.status}' status; canonical plan review must first produce 'awaiting_approval'.`
  }
  if (!desire.plan || !desire.review) {
    return 'Cannot approve desire without a persisted plan and review.'
  }
  if (desire.review.planId !== desire.plan.id
    || desire.review.planVersion !== desire.plan.version
    || desire.review.verdict === 'reject') {
    return 'Cannot approve desire because its persisted review does not match the current plan version.'
  }
  return null
}
