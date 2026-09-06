import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_AGENCY_CONFIG } from './config.js'
import {
  createDesireFromCandidate,
  hasDesireActivationCapacity,
  isDesireActivationEligible,
} from './desire-strength.js'
import {
  calculateElapsedDecay,
  isAboveThreshold,
  type DesireCandidate,
  type DesireSource,
} from './types.js'

function candidate(source: DesireSource): DesireCandidate {
  return {
    title: `Desire from ${source}`,
    description: 'A durable, evidence-backed desire',
    reason: 'Contract test',
    source,
    sourceId: `${source}-1`,
    risk: 'low',
    suggestedAction: 'Plan it',
  }
}

test('every enabled source can cross the common activation threshold', () => {
  for (const source of Object.keys(DEFAULT_AGENCY_CONFIG.sources) as DesireSource[]) {
    const desire = createDesireFromCandidate(candidate(source), DEFAULT_AGENCY_CONFIG)
    desire.strength = desire.threshold
    assert.equal(isAboveThreshold(desire), true, `${source} should be mathematically activatable`)
  }
})

test('explicit user requests begin low and activate after genuine reinforcement', () => {
  const desire = createDesireFromCandidate(candidate('user_request'), DEFAULT_AGENCY_CONFIG, {
    id: 'user-request:request-1',
    kind: 'origin',
    source: 'user_request',
    sourceId: 'request-1',
    summary: 'The user expressed a durable want',
    observedAt: '2026-09-04T00:00:00.000Z',
  })
  assert.equal(desire.status, 'nascent')
  desire.strength += DEFAULT_AGENCY_CONFIG.thresholds.decay.reinforcementBoost
  assert.equal(isAboveThreshold(desire), true)
  assert.equal(isDesireActivationEligible(desire), true)
})

test('legacy numeric strength cannot activate without traceable evidence', () => {
  const desire = createDesireFromCandidate(candidate('user_request'), DEFAULT_AGENCY_CONFIG, {
    id: 'legacy-origin:desire-1',
    kind: 'origin',
    source: 'user_request',
    sourceId: 'legacy-request-1',
    summary: 'Migrated legacy metadata',
    observedAt: '2026-09-04T00:00:00.000Z',
  })
  desire.strength = 1
  assert.equal(isAboveThreshold(desire), true)
  assert.equal(isDesireActivationEligible(desire), false)
  assert.equal(desire.status, 'nascent')
  desire.evidence?.push({
    id: 'generator:desire-1:fresh-batch',
    kind: 'reinforcement',
    source: 'user_request',
    sourceId: 'fresh-batch',
    summary: 'A new observation genuinely reinforced the legacy desire',
    observedAt: '2026-09-05T00:00:00.000Z',
  })
  assert.equal(isDesireActivationEligible(desire), true)
})

test('elapsed decay is independent of scheduler invocation count', () => {
  const start = '2026-09-01T00:00:00.000Z'
  const end = '2026-09-03T12:00:00.000Z'
  assert.equal(calculateElapsedDecay(start, end, 0.03), 0.075)
  assert.equal(calculateElapsedDecay(end, end, 0.03), 0)
  assert.equal(calculateElapsedDecay(end, start, 0.03), 0)
})

test('activation capacity is enforced independently from total stored desire count', () => {
  const config = structuredClone(DEFAULT_AGENCY_CONFIG)
  config.limits.maxActiveDesires = 2
  assert.equal(hasDesireActivationCapacity(0, config), true)
  assert.equal(hasDesireActivationCapacity(1, config), true)
  assert.equal(hasDesireActivationCapacity(2, config), false)
})
