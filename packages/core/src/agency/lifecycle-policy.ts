import { desirePlanExecutionErrors } from './plan-policy.js'
import type { Desire, DesireStatus } from './types.js'

export const DESIRE_STATUSES: readonly DesireStatus[] = [
  'nascent', 'pending', 'evaluating', 'planning', 'questioning', 'reviewing',
  'awaiting_approval', 'approved', 'executing', 'awaiting_review',
  'needs_attention', 'paused', 'completed', 'rejected', 'abandoned', 'archived', 'failed',
]

export const OPEN_DESIRE_STATUSES: readonly DesireStatus[] = [
  'nascent', 'pending', 'evaluating', 'planning', 'questioning', 'reviewing',
  'awaiting_approval', 'approved', 'executing', 'awaiting_review',
  'needs_attention', 'paused',
]

/** Desires committed to the operational lifecycle and visible to Robot Status. */
export const ACTIVE_DESIRE_STATUSES: readonly DesireStatus[] = [
  'pending', 'evaluating', 'planning', 'questioning', 'reviewing',
  'awaiting_approval', 'approved', 'executing', 'awaiting_review', 'needs_attention',
]

export const NEEDS_ACTION_DESIRE_STATUSES: readonly DesireStatus[] = [
  'questioning', 'awaiting_approval', 'needs_attention',
]

/** Mutually exclusive dashboard bucket for work progressing without owner input. */
export const IN_PROGRESS_DESIRE_STATUSES: readonly DesireStatus[] = [
  'evaluating', 'planning', 'reviewing', 'approved', 'executing', 'awaiting_review',
]

/** Mutually exclusive dashboard bucket for dormant or not-yet-admitted work. */
export const WAITING_DESIRE_STATUSES: readonly DesireStatus[] = [
  'nascent', 'pending', 'paused',
]

export const TERMINAL_DESIRE_STATUSES: readonly DesireStatus[] = [
  'completed', 'rejected', 'abandoned', 'archived', 'failed',
]

export type DesireStatusGroup = 'all' | 'open' | 'active' | 'waiting' | 'needs_action' | 'completed' | 'archived'

const STATUS_GROUPS: Record<Exclude<DesireStatusGroup, 'all'>, readonly DesireStatus[]> = {
  open: OPEN_DESIRE_STATUSES,
  active: ACTIVE_DESIRE_STATUSES,
  waiting: WAITING_DESIRE_STATUSES,
  needs_action: NEEDS_ACTION_DESIRE_STATUSES,
  completed: ['completed', 'failed'],
  archived: ['rejected', 'abandoned', 'archived'],
}

export function isDesireStatus(value: string): value is DesireStatus {
  return DESIRE_STATUSES.includes(value as DesireStatus)
}

export function statusesForDesireGroup(group: DesireStatusGroup): readonly DesireStatus[] {
  return group === 'all' ? DESIRE_STATUSES : STATUS_GROUPS[group]
}

export function isOpenDesire(desire: Pick<Desire, 'status'>): boolean {
  return OPEN_DESIRE_STATUSES.includes(desire.status)
}

export function isActiveDesire(desire: Pick<Desire, 'status'>): boolean {
  return ACTIVE_DESIRE_STATUSES.includes(desire.status)
}

/** Awareness only. Full intentions and plans belong to the selected Agency workflow. */
export interface DesireAwareness {
  id: string
  title: string
  status: DesireStatus
  nextAction: 'desire-agent' | 'owner_input' | 'execution_result'
  updatedAt: string
}

export function projectDesireAwareness(value: unknown, limit = 5): DesireAwareness[] {
  if (!Array.isArray(value)) return []
  const text = (v: unknown, length: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, length) : ''
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || !isActiveDesire(item)) return []
    const id = text(item.id, 160)
    const title = text(item.title, 120)
    if (!id || !title) return []
    return [{
      id, title, status: item.status as DesireStatus,
      nextAction: NEEDS_ACTION_DESIRE_STATUSES.includes(item.status) ? 'owner_input' as const
        : item.status === 'executing' ? 'execution_result' as const : 'desire-agent' as const,
      updatedAt: text(item.updatedAt, 80),
    }]
  }).slice(0, limit)
}

const OWNER_ADVANCE_TARGETS: Record<DesireStatus, DesireStatus[]> = {
  nascent: ['pending', 'planning', 'paused', 'archived', 'abandoned'],
  pending: ['planning', 'paused', 'archived', 'abandoned'],
  evaluating: ['planning', 'pending', 'paused', 'archived', 'abandoned'],
  planning: ['paused', 'archived', 'abandoned'],
  questioning: ['planning', 'paused', 'archived', 'abandoned'],
  reviewing: ['planning', 'paused', 'archived', 'abandoned'],
  awaiting_approval: ['planning', 'paused', 'archived', 'abandoned'],
  approved: ['planning', 'paused', 'archived', 'abandoned'],
  // Work Coordinator owns an active execution until it reaches outcome review.
  executing: [],
  awaiting_review: ['needs_attention', 'archived'],
  needs_attention: ['planning', 'paused', 'archived'],
  paused: ['nascent', 'pending', 'planning', 'archived'],
  completed: ['archived'],
  rejected: ['pending', 'archived'],
  abandoned: ['pending', 'archived'],
  archived: ['pending', 'planning'],
  failed: ['pending', 'needs_attention', 'archived'],
}

const OWNER_RESET_TARGETS: readonly DesireStatus[] = ['nascent', 'pending', 'planning', 'paused']

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
  const errors = desirePlanExecutionErrors(desire.plan)
  if (errors.length) return `Cannot approve desire: ${errors.join('; ')}`
  if (desire.review.planId !== desire.plan.id
    || desire.review.planVersion !== desire.plan.version
    || desire.review.verdict !== 'approve') {
    return 'Cannot approve desire because its persisted review does not match the current plan version.'
  }
  return null
}
