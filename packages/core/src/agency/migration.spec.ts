import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_AGENCY_CONFIG } from './config.js'
import { normalizeDesireForMigration } from './migration.js'
import { initializeDesireMetrics, type Desire } from './types.js'

function legacy(overrides: Partial<Desire> = {}): Desire {
  return {
    id: 'desire-legacy',
    title: 'Legacy desire',
    description: 'Old record',
    reason: 'Old evidence',
    source: 'unanswered_question',
    sourceId: 'question-1',
    status: 'nascent',
    strength: 0.75,
    baseWeight: 0.4,
    threshold: 0.7,
    decayRate: 0.03,
    lastReviewedAt: '2026-08-01T00:00:00.000Z',
    reinforcements: 4,
    runCount: 9,
    risk: 'low',
    requiredTrustLevel: 'suggest',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    metrics: { ...initializeDesireMetrics(), reinforcementCount: 0 },
    ...overrides,
  } as Desire
}

test('migration repairs legacy provenance and metrics without activating untraceable strength', () => {
  const result = normalizeDesireForMigration(
    legacy(),
    DEFAULT_AGENCY_CONFIG,
    '2026-09-04T00:00:00.000Z',
  )
  assert.equal(result.safeToApply, true)
  assert.equal(result.desire.source, 'curiosity')
  assert.equal(result.desire.status, 'needs_attention')
  assert.equal(result.desire.currentStage, 'user_attention')
  assert.match(result.desire.dispositionReason!, /finite outcome/)
  assert.equal(result.desire.folderPath, 'folders/desire-legacy')
  assert.equal(result.desire.metrics.reinforcementCount, 4)
  assert.equal(result.desire.metrics.netReinforcement, 4)
  assert.equal(result.desire.metrics.outcomeRetryCount, 0)
  assert.equal(result.desire.evidence?.[0]?.kind, 'origin')
  assert.equal(result.desire.lastDecayAt, '2026-08-01T00:00:00.000Z')
  assert.match(result.warnings.join(' '), /requires owner review/)
})

test('explicitly owner-rejected legacy records migrate to archived history', () => {
  const result = normalizeDesireForMigration(legacy({
    status: 'rejected',
    rejectionHistory: [{
      rejectedAt: '2026-08-03T00:00:00.000Z',
      rejectedBy: 'user',
      reason: 'Owner declined it',
      canRetry: false,
    }],
  }), DEFAULT_AGENCY_CONFIG)
  assert.equal(result.desire.status, 'archived')
  assert.equal(result.desire.currentStage, 'archived')
})

test('traceable above-threshold evidence can restore a pending lifecycle state', () => {
  const result = normalizeDesireForMigration(legacy({
    source: 'curiosity',
    completionCriteria: 'A cited answer to the original question is saved.',
    evidence: [{
      id: 'curiosity:question-1',
      kind: 'origin',
      source: 'curiosity',
      sourceId: 'question-1',
      summary: 'Original question',
      observedAt: '2026-08-01T00:00:00.000Z',
    }],
  }), DEFAULT_AGENCY_CONFIG)
  assert.equal(result.desire.status, 'pending')
  assert.ok(result.changes.includes('activation:pending'))
})

test('migration reports unknown provenance instead of fabricating it', () => {
  const result = normalizeDesireForMigration(
    legacy({ source: 'mystery_source' as Desire['source'] }),
    DEFAULT_AGENCY_CONFIG,
  )
  assert.equal(result.safeToApply, false)
  assert.match(result.warnings.join(' '), /Unknown desire source/)
})

test('an unbounded backlog is held without activation and an executing record is never rewritten', () => {
  const strong = legacy({
    strength: 1, source: 'user_request',
    evidence: [{ id: 'user_request:request-1', kind: 'origin', source: 'user_request', sourceId: 'request-1',
      summary: 'A style preference', observedAt: '2026-09-01T00:00:00.000Z' }],
  })
  const held = normalizeDesireForMigration(strong, DEFAULT_AGENCY_CONFIG)
  assert.equal(held.desire.status, 'needs_attention')
  assert.equal(held.changes.includes('activation:pending'), false)
  const again = normalizeDesireForMigration(held.desire, DEFAULT_AGENCY_CONFIG)
  assert.deepEqual(again.changes, [])
  const active = normalizeDesireForMigration({ ...strong, status: 'executing' }, DEFAULT_AGENCY_CONFIG)
  assert.equal(active.safeToApply, false)
  assert.equal(active.desire.status, 'executing')
  assert.match(active.warnings.join(' '), /active execution must settle/)
})
