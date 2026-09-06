import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { ROOT } from '../path-builder.js'
import {
  canAutoApprove,
  DEFAULT_AGENCY_CONFIG,
  resolveAutoApprovalTrustRequirement,
  validateConfig,
} from './config.js'
import { createDesireFromCandidate } from './desire-strength.js'

test('Agency config leaves scheduling to Trigger Manager and validates execution policy', () => {
  const tracked = JSON.parse(fs.readFileSync(`${ROOT}/etc/agency.json`, 'utf8'))
  assert.equal('scheduling' in tracked, false)
  assert.deepEqual(Object.keys(tracked.execution).sort(), [
    'fallbackBackend',
    'feasibilityCheckEnabled',
    'maxPlanRetries',
    'preferredBackend',
  ])
  assert.equal(validateConfig(DEFAULT_AGENCY_CONFIG).valid, true)
  assert.equal(validateConfig({ ...DEFAULT_AGENCY_CONFIG, mode: 'yolo' }).valid, true)
  assert.equal('ratePerDay' in DEFAULT_AGENCY_CONFIG.thresholds.decay, true)
  assert.equal('ratePerRun' in DEFAULT_AGENCY_CONFIG.thresholds.decay, false)
  assert.deepEqual(
    Object.keys(tracked.sources).sort(),
    Object.keys(DEFAULT_AGENCY_CONFIG.sources).sort(),
  )
  assert.deepEqual(Object.keys(tracked.riskPolicy).sort(), [
    'autoApproveRisk',
    'autoApproveTrustLevel',
    'blockRisk',
    'requireApprovalRisk',
    'reviewBypass',
  ])
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    execution: { ...DEFAULT_AGENCY_CONFIG.execution, maxPlanRetries: -1 },
  }).valid, false)
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    riskPolicy: { ...DEFAULT_AGENCY_CONFIG.riskPolicy, reviewBypass: 'sometimes' as never },
  }).valid, false)
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    riskPolicy: { ...DEFAULT_AGENCY_CONFIG.riskPolicy, autoApproveTrustLevel: 'absolute' as never },
  }).valid, false)
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    thresholds: { ...DEFAULT_AGENCY_CONFIG.thresholds, activation: Number.NaN },
  }).valid, false)
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    limits: { ...DEFAULT_AGENCY_CONFIG.limits, maxActiveDesires: 1.5 },
  }).valid, false)
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    sources: {
      ...DEFAULT_AGENCY_CONFIG.sources,
      user_request: { enabled: true, weight: Number.POSITIVE_INFINITY },
    },
  }).valid, false)
  const { user_request: _missingUserRequest, ...missingSource } = DEFAULT_AGENCY_CONFIG.sources
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    sources: missingSource as typeof DEFAULT_AGENCY_CONFIG.sources,
  }).valid, false)
})

test('very strong mature desires can reduce trust requirements without bypassing observe', () => {
  const desire = createDesireFromCandidate({
    title: 'Persistent goal',
    description: 'A repeatedly reinforced low-risk goal',
    reason: 'Trust policy test',
    source: 'user_request',
    sourceId: 'request-1',
    risk: 'low',
    suggestedAction: 'Plan it',
  }, DEFAULT_AGENCY_CONFIG)
  desire.strength = 0.99
  const requirement = resolveAutoApprovalTrustRequirement(DEFAULT_AGENCY_CONFIG, desire.strength, desire)
  assert.equal(requirement.requiredTrust, 'suggest')
  assert.equal(requirement.reduction, 2)
})

test('the tracked supervised mode always requires owner approval', async () => {
  const result = await canAutoApprove('low', 1, 'adaptive_auto')
  assert.equal(result.autoApprove, false)
  assert.match(result.reason, /supervised mode requires owner approval/i)
})
