import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PERSONA_INSIGHTS_VERSION,
  validatePersonaInsights,
} from './persona-insights.js'

test('persona insights validates the canonical Psychoanalyzer record contract', () => {
  const value = validatePersonaInsights({
    version: PERSONA_INSIGHTS_VERSION,
    lastUpdated: '2026-09-04T12:00:00.000Z',
    entries: [{
      timestamp: '2026-09-04T12:00:00.000Z',
      type: 'addition',
      category: 'personality',
      section: 'personality.interests',
      items: ['music'],
      memoriesAnalyzed: 10,
      confidence: 0.9,
      reasoning: 'Repeated explicit evidence',
      sessionId: 'psych-run',
    }],
  })
  assert.equal(value.entries[0]?.sessionId, 'psych-run')
})

test('persona insights explicitly migrates the retired profile seed shape', () => {
  const migrated = validatePersonaInsights({
    version: '1.0.0',
    lastUpdated: '2025-01-01T00:00:00.000Z',
    insights: [{
      id: 'old-insight',
      type: 'interest',
      content: 'music',
      source: 'legacy analysis',
      confidence: 0.8,
      createdAt: '2025-01-01T00:00:00.000Z',
    }],
  })
  assert.equal(migrated.version, PERSONA_INSIGHTS_VERSION)
  assert.equal(migrated.entries[0]?.sessionId, 'legacy:old-insight')
  assert.deepEqual(migrated.entries[0]?.items, ['music'])
})

test('persona insights rejects malformed persisted entries', () => {
  assert.throws(
    () => validatePersonaInsights({
      version: PERSONA_INSIGHTS_VERSION,
      lastUpdated: null,
      entries: [{ type: 'addition' }],
    }),
    /items must be an array/,
  )
})
