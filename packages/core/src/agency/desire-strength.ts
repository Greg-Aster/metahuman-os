import type { AgencyConfig, Desire, DesireCandidate, DesireEvidence } from './types.js'
import {
  generateDesireId,
  initializeDesireMetrics,
  initializeScratchpadSummary,
  initializeStageIterations,
  isAboveThreshold,
} from './types.js'

export function hasDesireActivationCapacity(activeCount: number, config: AgencyConfig): boolean {
  return Number.isInteger(activeCount)
    && activeCount >= 0
    && activeCount < config.limits.maxActiveDesires
}

export function hasTraceableDesireEvidence(desire: Pick<Desire, 'evidence'>): boolean {
  return Boolean(desire.evidence?.some(item => (
    item.id?.trim()
    && !item.id.startsWith('legacy-origin:')
    && item.sourceId?.trim()
    && Number.isFinite(Date.parse(item.observedAt))
  )))
}

export function isDesireActivationEligible(desire: Desire): boolean {
  return hasTraceableDesireEvidence(desire) && isAboveThreshold(desire)
}

export function createDesireFromCandidate(
  candidate: DesireCandidate,
  config: AgencyConfig,
  evidence?: DesireEvidence,
  now = new Date().toISOString(),
): Desire {
  const sourceConfig = config.sources[candidate.source]
  if (!sourceConfig?.enabled) {
    throw new Error(`Desire source '${candidate.source}' is not enabled in Agency configuration`)
  }
  const initialStrength = Math.min(
    0.8,
    config.thresholds.decay.initialStrength + sourceConfig.weight * 0.5,
  )
  const desire: Desire = {
    id: generateDesireId(),
    title: candidate.title.trim(),
    description: candidate.description.trim(),
    reason: candidate.reason.trim(),
    source: candidate.source,
    sourceId: candidate.sourceId,
    evidence: evidence ? [evidence] : [],
    strength: initialStrength,
    baseWeight: sourceConfig.weight,
    threshold: config.thresholds.activation,
    decayRate: config.thresholds.decay.ratePerDay,
    lastReviewedAt: now,
    lastDecayAt: now,
    reinforcements: 0,
    runCount: 1,
    risk: candidate.risk,
    requiredTrustLevel: candidate.risk === 'none' || candidate.risk === 'low'
      ? 'suggest'
      : candidate.risk === 'medium' ? 'supervised_auto' : 'bounded_auto',
    status: 'nascent',
    currentStage: 'nascent',
    createdAt: now,
    updatedAt: now,
    tags: [candidate.source, candidate.risk],
    metrics: {
      ...initializeDesireMetrics(),
      lastActivityAt: now,
      peakStrength: initialStrength,
      troughStrength: initialStrength,
    },
    stageIterations: initializeStageIterations(),
    scratchpad: initializeScratchpadSummary(),
  }
  if (isDesireActivationEligible(desire)) {
    desire.status = 'pending'
    desire.currentStage = 'strengthening'
    desire.activatedAt = now
  }
  return desire
}
