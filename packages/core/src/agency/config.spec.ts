import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { ROOT } from '../path-builder.js'
import { DEFAULT_AGENCY_CONFIG, validateConfig } from './config.js'

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
  assert.equal(validateConfig({
    ...DEFAULT_AGENCY_CONFIG,
    execution: { ...DEFAULT_AGENCY_CONFIG.execution, maxPlanRetries: -1 },
  }).valid, false)
})
