import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadSystemPsychoanalyzerConfig,
  mergePsychoanalyzerConfig,
  validatePsychoanalyzerConfig,
} from './psychoanalyzer-config.js'

test('tracked psychoanalyzer config satisfies the canonical contract', () => {
  const config = loadSystemPsychoanalyzerConfig()
  assert.equal(config.version, '2.0.0')
  assert.equal(config.memorySelection.strategy, 'priority_recent')
  assert.equal(config.memorySelection.maxScanFiles, 1000)
  assert.equal(config.analysis.model, 'psychotherapist')
  assert.equal(config.analysis.maxEvidenceCharacters, 60000)
  assert.equal(config.updateStrategy.preserveUserEdits, false)
  assert.equal('enabled' in config, false)
})

test('legacy installed profile config migrates to the complete version 2 contract', () => {
  const tracked = loadSystemPsychoanalyzerConfig()
  const { userInputOnly: _userInputOnly, ...legacyMemorySelection } = tracked.memorySelection
  const { maxTokens: _maxTokens, ...legacyAnalysis } = tracked.analysis
  const {
    ['context.domains']: _domains,
    ['personality.traits']: _traits,
    ...legacyFields
  } = tracked.updateStrategy.fields
  const legacy = validatePsychoanalyzerConfig({
    version: '1.0.0',
    enabled: true,
    memorySelection: { ...legacyMemorySelection, strategy: 'recent' },
    analysis: legacyAnalysis,
    updateStrategy: { ...tracked.updateStrategy, fields: legacyFields },
    reconciliation: tracked.reconciliation,
    archival: { enabled: true },
  })
  assert.equal(legacy.version, '2.0.0')
  assert.equal(legacy.memorySelection.strategy, 'priority_recent')
  assert.equal(legacy.memorySelection.userInputOnly, true)
  assert.equal(legacy.analysis.maxTokens, 2200)
  assert.equal(legacy.updateStrategy.fields['personality.traits'], false)
  assert.equal(legacy.updateStrategy.fields['context.domains'], true)
  assert.deepEqual(legacy.insights, { enabled: true, maxEntries: 100 })
})

test('legacy weighted random strategy migrates but version 2 rejects it', () => {
  const tracked = loadSystemPsychoanalyzerConfig()
  const legacy = validatePsychoanalyzerConfig({
    ...tracked,
    version: '1.0.0',
    memorySelection: { ...tracked.memorySelection, strategy: 'weighted_random' },
  })
  assert.equal(legacy.memorySelection.strategy, 'priority_recent')

  assert.throws(
    () => validatePsychoanalyzerConfig({
      ...tracked,
      memorySelection: { ...tracked.memorySelection, strategy: 'weighted_random' },
    }),
    /must be priority_recent/,
  )
  assert.throws(
    () => validatePsychoanalyzerConfig({ ...tracked, version: '3.0.0' }),
    /Unsupported psychoanalyzer config version/,
  )
})

test('configuration updates are whitelisted and validated', () => {
  const tracked = loadSystemPsychoanalyzerConfig()
  const updated = mergePsychoanalyzerConfig(tracked, {
    analysis: { confidenceThreshold: 0.8 },
    updateStrategy: { fields: { goals: false } },
  })
  assert.equal(updated.analysis.confidenceThreshold, 0.8)
  assert.equal(updated.updateStrategy.fields.goals, false)
  assert.equal(updated.updateStrategy.fields['values.core'], true)

  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { backend: 'cloud' }),
    /Unsupported psychoanalyzer configuration fields/,
  )
  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { memorySelection: { minMemories: 31 } }),
    /cannot exceed maxMemories/,
  )
  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { analysis: { imaginarySetting: true } }),
    /Unsupported analysis fields/,
  )
  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { enabled: false }),
    /Unsupported psychoanalyzer configuration fields/,
  )
  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { memorySelection: { maxScanFiles: 0 } }),
    /maxScanFiles/,
  )
  assert.throws(
    () => mergePsychoanalyzerConfig(tracked, { analysis: { maxEvidenceCharacters: 999 } }),
    /maxEvidenceCharacters/,
  )
})
