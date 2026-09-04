import assert from 'node:assert/strict'
import test from 'node:test'

import { getDefaultPersonaCore } from '../identity.js'
import { applyPersonaDraft, mergePersonaDraft, type MergeStrategy } from './merger.js'

test('persona drafts merge only into canonical persona fields', () => {
  const current = getDefaultPersonaCore()
  const { updated, diff } = mergePersonaDraft(current, {
    traits: { openness: 0.9 },
    communicationStyle: {
      tone: ['direct'],
      verbosity: 'concise',
      emphasis: 'concrete evidence',
    },
    interests: ['robotics'],
    background: 'Builds local-first systems.',
    currentFocus: ['MetaHuman OS'],
    confidence: { overall: 100, categories: {} },
  })

  assert.equal(updated.personality.traits?.openness, 0.9)
  assert.equal(updated.personality.communicationStyle?.verbosity, 'concise')
  assert.deepEqual(updated.personality.interests, ['robotics'])
  assert.deepEqual(updated.context.currentFocus, ['MetaHuman OS'])
  assert.equal(updated.background, 'Builds local-first systems.')
  assert.equal('bigFive' in updated.personality, false)
  assert.equal('currentFocus' in updated, false)
  assert.ok(diff.changes.some(change => change.field === 'personality.traits.openness'))
  assert.ok(diff.changes.some(change => change.field === 'context.currentFocus'))
  assert.ok(diff.changes.some(change => change.field === 'background'))
})

test('persona drafts preserve structured background fields', () => {
  const current = getDefaultPersonaCore()
  current.background = { keyExperiences: ['Existing history'], narrative: 'Old narrative' }

  const { updated } = mergePersonaDraft(current, { background: 'New narrative' })

  assert.deepEqual(updated.background, {
    keyExperiences: ['Existing history'],
    narrative: 'New narrative',
  })
})

test('persona merge does not fabricate a missing canonical trait collection', () => {
  const current = getDefaultPersonaCore()
  delete current.personality.traits

  assert.throws(
    () => mergePersonaDraft(current, { traits: { openness: 0.9 } }),
    /personality\.traits is missing/,
  )
})

test('persona merge rejects unsupported strategies and legacy stored drafts', () => {
  assert.throws(
    () => mergePersonaDraft(getDefaultPersonaCore(), { interests: ['robotics'] }, 'unknown' as MergeStrategy),
    /Unsupported persona merge strategy/,
  )
  assert.throws(
    () => applyPersonaDraft({ bigFive: { openness: 75 }, confidence: { overall: 20 } }),
    /invalid top-level shape/,
  )
})
