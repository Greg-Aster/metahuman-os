import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPersonaLearningProposal,
  reconcilePersonaLearningProvenance,
  validatePersonaLearningProposal,
} from './persona-learning.js'
import type { PersonaCore } from './identity.js'
import type { PsychoanalyzerConfig } from './psychoanalyzer-config.js'

function config(): PsychoanalyzerConfig {
  return {
    version: '2.0.0',
    memorySelection: {
      strategy: 'priority_recent',
      daysBack: 30,
      maxScanFiles: 1000,
      maxMemories: 30,
      minMemories: 5,
      excludeTypes: [],
      priorityTags: [],
      userInputOnly: true,
    },
    analysis: {
      model: 'psychotherapist',
      temperature: 0.3,
      maxTokens: 2200,
      maxEvidenceCharacters: 60000,
      confidenceThreshold: 0.7,
    },
    updateStrategy: {
      preserveUserEdits: false,
      fields: {
        'personality.traits': true,
        'personality.communicationStyle': true,
        'personality.interests': true,
        'values.core': true,
        goals: true,
        'context.domains': true,
        'context.currentFocus': true,
        'context.projects': true,
        decisionHeuristics: true,
        'writingStyle.motifs': true,
      },
    },
    reconciliation: {
      removeStaleGoals: true,
      removeStaleInterests: true,
      removeContradictedValues: true,
      removeUnusedHeuristics: true,
    },
    insights: { enabled: true, maxEntries: 100 },
  }
}

function persona(): PersonaCore {
  return {
    version: '1.0.0',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    identity: { name: 'Owner', role: 'self', purpose: 'remain protected' },
    personality: {
      traits: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      },
      interests: ['manual interest'],
    },
    values: { core: [], boundaries: [] },
    goals: { shortTerm: [], midTerm: [], longTerm: [] },
    context: { domains: [], projects: [], currentFocus: [] },
  }
}

test('proposal validation requires selected evidence and an allowed path', () => {
  assert.throws(
    () => validatePersonaLearningProposal({
      summary: 'unsupported change',
      confidence: 0.9,
      changes: [{
        operation: 'update',
        path: 'identity.name',
        value: 'replacement',
        evidenceIds: ['memory-1'],
        reason: 'not permitted',
      }],
    }, new Set(['memory-1'])),
    /path is not allowed/,
  )

  assert.throws(
    () => validatePersonaLearningProposal({
      summary: 'uncited change',
      confidence: 0.9,
      changes: [{
        operation: 'add',
        path: 'personality.interests',
        value: 'music',
        evidenceIds: ['unknown-memory'],
        reason: 'not grounded',
      }],
    }, new Set(['memory-1'])),
    /must reference selected memories/,
  )

  assert.throws(
    () => validatePersonaLearningProposal({
      summary: 'extra model field',
      confidence: 0.9,
      changes: [],
      explanation: 'not part of the contract',
    }, new Set()),
    /unsupported fields/,
  )
})

test('learning applies exact, grounded changes without touching identity', () => {
  const proposal = validatePersonaLearningProposal({
    summary: 'stable creative pattern',
    confidence: 0.91,
    changes: [
      {
        operation: 'add',
        path: 'personality.interests',
        value: 'music',
        evidenceIds: ['memory-1', 'memory-2'],
        reason: 'Repeated explicit discussion',
      },
      {
        operation: 'update',
        path: 'personality.traits',
        value: { trait: 'openness', score: 0.7 },
        evidenceIds: ['memory-2'],
        reason: 'Repeated novelty-seeking behavior',
      },
    ],
  }, new Set(['memory-1', 'memory-2']))

  const result = applyPersonaLearningProposal(persona(), proposal, config(), {
    appliedAt: '2026-02-03T04:05:06.000Z',
  })
  assert.equal(result.applied.length, 2)
  assert.deepEqual(result.applied.map(change => change.index), [0, 1])
  assert.equal(result.persona.identity.name, 'Owner')
  assert.deepEqual((result.persona.personality as any).interests, ['manual interest', 'music'])
  assert.equal(result.persona.personality.traits?.openness, 0.7)
  assert.equal(result.persona.learningProvenance?.length, 2)
  assert.ok(result.persona.learningProvenance?.every(entry => entry.updatedAt === '2026-02-03T04:05:06.000Z'))
})

test('preserveUserEdits protects unowned entries while allowing owned reconciliation', () => {
  const protectedConfig = config()
  protectedConfig.updateStrategy.preserveUserEdits = true
  const addProposal = validatePersonaLearningProposal({
    summary: 'add a learned interest',
    confidence: 0.9,
    changes: [{
      operation: 'add',
      path: 'personality.interests',
      value: 'music',
      evidenceIds: ['memory-1'],
      reason: 'Explicit evidence',
    }],
  }, new Set(['memory-1']))
  const afterAdd = applyPersonaLearningProposal(persona(), addProposal, protectedConfig).persona

  const removeProposal = validatePersonaLearningProposal({
    summary: 'reconcile interests',
    confidence: 0.9,
    changes: [
      {
        operation: 'remove',
        path: 'personality.interests',
        value: 'manual interest',
        evidenceIds: ['memory-2'],
        reason: 'Explicit contradiction',
      },
      {
        operation: 'remove',
        path: 'personality.interests',
        value: 'music',
        evidenceIds: ['memory-2'],
        reason: 'Explicit contradiction',
      },
    ],
  }, new Set(['memory-2']))
  const result = applyPersonaLearningProposal(afterAdd, removeProposal, protectedConfig)

  assert.deepEqual((result.persona.personality as any).interests, ['manual interest'])
  assert.equal(result.applied.length, 1)
  assert.match(result.rejected[0]?.reason, /preserveUserEdits/)
})

test('manual edit protection covers traits and manual edits clear Psychoanalyzer ownership', () => {
  const protectedConfig = config()
  protectedConfig.updateStrategy.preserveUserEdits = true
  const traitProposal = validatePersonaLearningProposal({
    summary: 'trait adjustment',
    confidence: 0.9,
    changes: [{
      operation: 'update',
      path: 'personality.traits',
      value: { trait: 'openness', score: 0.8 },
      evidenceIds: ['memory-1'],
      reason: 'Repeated evidence',
    }],
  }, new Set(['memory-1']))

  const protectedResult = applyPersonaLearningProposal(persona(), traitProposal, protectedConfig)
  assert.equal(protectedResult.applied.length, 0)
  assert.match(protectedResult.rejected[0]?.reason ?? '', /preserveUserEdits/)

  const learningConfig = config()
  const learned = applyPersonaLearningProposal(persona(), traitProposal, learningConfig).persona
  assert.equal(learned.learningProvenance?.[0]?.key, 'openness')
  const manuallyEdited = structuredClone(learned)
  if (manuallyEdited.personality.traits) manuallyEdited.personality.traits.openness = 0.6
  manuallyEdited.learningProvenance = [{
    path: 'personality.traits',
    key: 'openness',
    evidenceIds: ['forged'],
    reason: 'forged',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }]
  const reconciled = reconcilePersonaLearningProvenance(learned, manuallyEdited)
  assert.deepEqual(reconciled.learningProvenance, [])
})

test('confidence threshold prevents persona mutation', () => {
  const proposal = validatePersonaLearningProposal({
    summary: 'weak inference',
    confidence: 0.4,
    changes: [{
      operation: 'add',
      path: 'context.domains',
      value: 'music',
      evidenceIds: ['memory-1'],
      reason: 'Weak evidence',
    }],
  }, new Set(['memory-1']))
  const original = persona()
  const result = applyPersonaLearningProposal(original, proposal, config())
  assert.deepEqual(result.persona, original)
  assert.equal(result.applied.length, 0)
  assert.match(result.rejected[0]?.reason, /confidence threshold/)
})

test('learning initializes null collections and uses a stable timestamp', () => {
  const sparse = persona() as any
  sparse.personality.interests = null
  sparse.context.domains = null
  sparse.context.currentFocus = null
  sparse.context.projects = null
  sparse.decisionHeuristics = null
  sparse.writingStyle = { motifs: null }

  const proposal = validatePersonaLearningProposal({
    summary: 'initialize learned collections',
    confidence: 0.9,
    changes: [
      {
        operation: 'add',
        path: 'context.domains',
        value: 'music',
        evidenceIds: ['memory-1'],
        reason: 'Repeated domain evidence',
      },
      {
        operation: 'add',
        path: 'goals',
        value: 'learn composition',
        evidenceIds: ['memory-1'],
        reason: 'Explicit aspiration',
      },
    ],
  }, new Set(['memory-1']))

  const result = applyPersonaLearningProposal(sparse, proposal, config(), {
    appliedAt: '2026-02-03T04:05:06.000Z',
  })
  assert.deepEqual(result.persona.context.domains, ['music'])
  assert.equal(result.persona.goals.shortTerm[0]?.proposedAt, '2026-02-03T04:05:06.000Z')
  assert.equal(result.applied.length, 2)
})

test('goal reconciliation searches every goal tier', () => {
  const source = persona()
  source.goals.midTerm.push({ goal: 'publish an album', status: 'active' })
  const permissive = config()
  permissive.updateStrategy.preserveUserEdits = false
  const proposal = validatePersonaLearningProposal({
    summary: 'goal was explicitly abandoned',
    confidence: 0.9,
    changes: [{
      operation: 'remove',
      path: 'goals',
      value: 'publish an album',
      evidenceIds: ['memory-1'],
      reason: 'Explicit abandonment',
    }],
  }, new Set(['memory-1']))

  const result = applyPersonaLearningProposal(source, proposal, permissive)
  assert.equal(result.applied.length, 1)
  assert.deepEqual(result.persona.goals.midTerm, [])
})

test('duplicate, missing, and unchanged proposals are explicit rejected outcomes', () => {
  const proposal = validatePersonaLearningProposal({
    summary: 'no-op changes',
    confidence: 0.9,
    changes: [
      {
        operation: 'add',
        path: 'personality.interests',
        value: 'manual interest',
        evidenceIds: ['memory-1'],
        reason: 'Already present',
      },
      {
        operation: 'remove',
        path: 'context.domains',
        value: 'missing domain',
        evidenceIds: ['memory-1'],
        reason: 'Not present',
      },
      {
        operation: 'update',
        path: 'personality.traits',
        value: { trait: 'openness', score: 0.5 },
        evidenceIds: ['memory-1'],
        reason: 'Already current',
      },
    ],
  }, new Set(['memory-1']))

  const result = applyPersonaLearningProposal(persona(), proposal, config())
  assert.equal(result.applied.length, 0)
  assert.deepEqual(result.rejected.map(outcome => outcome.index), [0, 1, 2])
  assert.match(result.rejected[0].reason, /already exists/)
  assert.match(result.rejected[1].reason, /does not exist/)
  assert.match(result.rejected[2].reason, /already has/)
})
