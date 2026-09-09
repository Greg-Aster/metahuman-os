import { loadConfig } from './config.js'
import {
  getDesireFolderPath,
  listAllDesires,
  saveDesire,
  saveDesireMigrationBackup,
} from './storage.js'
import {
  DESIRE_SOURCE_WEIGHTS,
  initializeDesireMetrics,
  isAboveThreshold,
  statusToStage,
  type AgencyConfig,
  type Desire,
  type DesireEvidence,
  type DesireSource,
  type DesireStatus,
} from './types.js'
import { isDesireStatus, isOpenDesire } from './lifecycle-policy.js'
import { hasTraceableDesireEvidence } from './desire-strength.js'
import { desirePlanExecutionErrors } from './plan-policy.js'

const LEGACY_SOURCE_MAP: Record<string, DesireSource> = {
  unanswered_question: 'curiosity',
  question: 'curiosity',
  goal: 'persona_goal',
  urgent: 'urgent_task',
  memory: 'memory_pattern',
}

const LEGACY_STATUS_MAP: Record<string, DesireStatus> = {
  active: 'executing',
  executed: 'completed',
  outcome_review: 'awaiting_review',
  waiting_approval: 'awaiting_approval',
  new: 'nascent',
}

export interface DesireMigrationItem {
  id: string
  changes: string[]
  warnings: string[]
  safeToApply: boolean
  desire: Desire
}

export interface DesireDuplicateGroup {
  key: string
  desireIds: string[]
}

export interface AgencyMigrationReport {
  username: string
  apply: boolean
  migrationId?: string
  scanned: number
  changed: number
  applied: number
  unsafe: number
  activated: number
  activationReviewRequired: number
  statusCounts: Partial<Record<DesireStatus, number>>
  exactTitleDuplicates: DesireDuplicateGroup[]
  duplicateSourceIds: DesireDuplicateGroup[]
  items: DesireMigrationItem[]
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function duplicateGroups(desires: Desire[], keyFor: (desire: Desire) => string): DesireDuplicateGroup[] {
  const groups = new Map<string, string[]>()
  for (const desire of desires) {
    const key = keyFor(desire)
    if (!key) continue
    groups.set(key, [...(groups.get(key) || []), desire.id])
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, desireIds]) => ({ key, desireIds }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/** Normalize one record without writing it. Unknown contracts are reported, not guessed. */
export function normalizeDesireForMigration(
  sourceDesire: Desire,
  config: AgencyConfig,
  now = new Date().toISOString(),
): DesireMigrationItem {
  const desire = structuredClone(sourceDesire) as Desire
  const changes: string[] = []
  const warnings: string[] = []
  let safeToApply = true

  const rawSource = String(desire.source)
  const normalizedSource = rawSource in DESIRE_SOURCE_WEIGHTS
    ? rawSource as DesireSource
    : LEGACY_SOURCE_MAP[rawSource]
  if (!normalizedSource) {
    warnings.push(`Unknown desire source '${rawSource}'`)
    safeToApply = false
  } else if (normalizedSource !== desire.source) {
    desire.source = normalizedSource
    changes.push(`source:${rawSource}->${normalizedSource}`)
  }

  const rawStatus = String(desire.status)
  const normalizedStatus = isDesireStatus(rawStatus)
    ? rawStatus
    : LEGACY_STATUS_MAP[rawStatus]
  if (!normalizedStatus) {
    warnings.push(`Unknown desire status '${rawStatus}'`)
    safeToApply = false
  } else if (normalizedStatus !== desire.status) {
    desire.status = normalizedStatus
    changes.push(`status:${rawStatus}->${normalizedStatus}`)
  }

  if (!safeToApply) return { id: desire.id, changes, warnings, safeToApply, desire }

  const canonicalFolder = getDesireFolderPath(desire.id)
  if (desire.folderPath !== canonicalFolder) {
    desire.folderPath = canonicalFolder
    changes.push('folderPath')
  }

  const canonicalStage = statusToStage(desire.status)
  if (desire.currentStage !== canonicalStage) {
    desire.currentStage = canonicalStage
    changes.push('currentStage')
  }

  const sourceConfig = config.sources[desire.source]
  if (!Number.isFinite(desire.baseWeight) || desire.baseWeight < 0 || desire.baseWeight > 1) {
    desire.baseWeight = sourceConfig?.weight ?? DESIRE_SOURCE_WEIGHTS[desire.source]
    changes.push('baseWeight')
  }
  if (!Number.isFinite(desire.threshold) || desire.threshold < 0 || desire.threshold > 1) {
    desire.threshold = config.thresholds.activation
    changes.push('threshold')
  }
  if (!Number.isFinite(desire.decayRate) || desire.decayRate < 0) {
    desire.decayRate = config.thresholds.decay.ratePerDay
    changes.push('decayRate')
  }

  const priorMetrics = desire.metrics as Partial<Desire['metrics']> | undefined
  const defaults = initializeDesireMetrics()
  const reinforcementCount = Math.max(
    0,
    finite(priorMetrics?.reinforcementCount, 0),
    finite(desire.reinforcements, 0),
  )
  const decayCount = Math.max(0, finite(priorMetrics?.decayCount, 0))
  const metrics = {
    ...defaults,
    ...priorMetrics,
    lastActivityAt: priorMetrics?.lastActivityAt || desire.updatedAt || desire.createdAt || now,
    reinforcementCount,
    decayCount,
    netReinforcement: reinforcementCount - decayCount,
    peakStrength: Math.max(finite(priorMetrics?.peakStrength, 0), finite(desire.strength, 0)),
    troughStrength: Math.min(finite(priorMetrics?.troughStrength, 1), finite(desire.strength, 1)),
    outcomeRetryCount: Math.max(0, finite(priorMetrics?.outcomeRetryCount, 0)),
  }
  if (JSON.stringify(desire.metrics) !== JSON.stringify(metrics)) {
    desire.metrics = metrics
    changes.push('metrics')
  }
  if (desire.reinforcements !== reinforcementCount) {
    desire.reinforcements = reinforcementCount
    changes.push('reinforcements')
  }

  if (!desire.lastDecayAt || !Number.isFinite(Date.parse(desire.lastDecayAt))) {
    desire.lastDecayAt = desire.lastReviewedAt || desire.updatedAt || desire.createdAt || now
    changes.push('lastDecayAt')
  }

  const existingEvidence = Array.isArray(desire.evidence)
    ? desire.evidence.filter((item): item is DesireEvidence => Boolean(item?.id && item?.observedAt))
    : []
  const hadTraceableEvidence = hasTraceableDesireEvidence({ evidence: existingEvidence })
  if (existingEvidence.length !== (desire.evidence?.length || 0)) changes.push('evidence:invalid-removed')
  if (existingEvidence.length === 0) {
    existingEvidence.push({
      id: `legacy-origin:${desire.id}`,
      kind: 'origin',
      source: desire.source,
      sourceId: desire.sourceId,
      summary: desire.reason || 'Legacy desire origin',
      observedAt: desire.createdAt || now,
    })
    changes.push('evidence:origin')
  }
  desire.evidence = existingEvidence

  const incompleteOutcome = !desire.completionCriteria?.trim()
  const obsoletePlan = desire.plan && desirePlanExecutionErrors(desire.plan).length > 0
  const rejectedByOwner = desire.status === 'rejected'
    && desire.rejectionHistory?.some(entry => entry.rejectedBy === 'user')
  if (rejectedByOwner) {
    desire.status = 'archived'
    desire.currentStage = 'archived'
    desire.dispositionReason = desire.dispositionReason || 'Archived after explicit owner rejection'
    changes.push('ownerRejection:archived')
  } else if (desire.status === 'nascent' && isAboveThreshold(desire) && hadTraceableEvidence
    && !incompleteOutcome && !obsoletePlan) {
    desire.status = 'pending'
    desire.currentStage = 'strengthening'
    desire.activatedAt = desire.activatedAt || now
    changes.push('activation:pending')
  } else if (desire.status === 'nascent' && isAboveThreshold(desire) && !hadTraceableEvidence) {
    warnings.push('Above-threshold legacy strength has no traceable evidence and requires owner review')
  }

  if (isOpenDesire(desire) && (incompleteOutcome || obsoletePlan)) {
    if (desire.status === 'executing') {
      safeToApply = false
      warnings.push('An active execution must settle before migrating its Desire contract')
    } else if (desire.status !== 'needs_attention') {
      desire.status = 'needs_attention'
      desire.currentStage = 'user_attention'
      desire.dispositionReason = incompleteOutcome
        ? 'A finite outcome and observable satisfaction condition must be established before planning.'
        : 'This historical plan must be regenerated and reviewed with completion criteria and explicit execution targets.'
      changes.push('outcomeContract:needs_attention')
    }
  }
  return { id: desire.id, changes, warnings, safeToApply, desire }
}

export async function migrateAgencyDesires(options: {
  username: string
  apply?: boolean
  now?: string
}): Promise<AgencyMigrationReport> {
  const username = options.username.trim()
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
    throw new Error('Agency migration requires a valid profile username')
  }
  const apply = options.apply === true
  const now = options.now || new Date().toISOString()
  const config = await loadConfig(username)
  const desires = await listAllDesires(username)
  const items = desires.map(desire => normalizeDesireForMigration(desire, config, now))
  let applied = 0
  const migrationId = apply ? now.replace(/[^0-9]/g, '').slice(0, 14) : undefined
  if (apply) {
    for (const [index, item] of items.entries()) {
      if (!item.safeToApply || item.changes.length === 0) continue
      await saveDesireMigrationBackup(migrationId!, desires[index], username)
      await saveDesire(item.desire, username)
      applied++
    }
  }
  const normalized = items.map(item => item.desire)
  const statusCounts = normalized.reduce<Partial<Record<DesireStatus, number>>>((counts, desire) => {
    counts[desire.status] = (counts[desire.status] || 0) + 1
    return counts
  }, {})
  return {
    username,
    apply,
    migrationId,
    scanned: desires.length,
    changed: items.filter(item => item.changes.length > 0).length,
    applied,
    unsafe: items.filter(item => !item.safeToApply).length,
    activated: items.filter(item => item.changes.includes('activation:pending')).length,
    activationReviewRequired: items.filter(item => item.warnings.some(warning => warning.includes('requires owner review'))).length,
    statusCounts,
    exactTitleDuplicates: duplicateGroups(normalized, desire => normalizeTitle(desire.title)),
    duplicateSourceIds: duplicateGroups(normalized, desire => desire.sourceId ? `${desire.source}:${desire.sourceId}` : ''),
    items,
  }
}
