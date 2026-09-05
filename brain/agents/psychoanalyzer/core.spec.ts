import assert from 'node:assert/strict'
import test from 'node:test'

import { applyPersonaLearningProposal, type PersonaCore } from '@metahuman/core'

import {
  executePsychoanalysis,
  parsePsychoanalyzerArgs,
  type PsychoanalyzerExecutionDependencies,
  type PsychoanalyzerExecutionState,
  type PsychoanalyzerMemory,
  type PsychoanalyzerTarget,
  type PsychoanalyzerConfig,
} from './core.js'

test('psychoanalyzer accepts only an explicit username option', () => {
  assert.deepEqual(parsePsychoanalyzerArgs([]), {})
  assert.deepEqual(parsePsychoanalyzerArgs(['--username', 'profile-a']), { username: 'profile-a' })
  assert.throws(() => parsePsychoanalyzerArgs(['--username']), /requires a value/)
  assert.throws(() => parsePsychoanalyzerArgs(['--single-user']), /Unknown psychoanalyzer option/)
})

function config(insightsEnabled = true): PsychoanalyzerConfig {
  return {
    version: '2.0.0',
    memorySelection: {
      strategy: 'priority_recent',
      daysBack: 30,
      maxScanFiles: 1000,
      maxMemories: 30,
      minMemories: 1,
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
      preserveUserEdits: true,
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
    insights: { enabled: insightsEnabled, maxEntries: 100 },
  }
}

function persona(): PersonaCore {
  return {
    version: '1.0.0',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    identity: { name: 'Owner', role: 'self', purpose: 'test' },
    personality: {
      traits: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      },
      interests: [],
    },
    values: { core: [], boundaries: [] },
    goals: { shortTerm: [], midTerm: [], longTerm: [] },
    context: { domains: [], projects: [], currentFocus: [] },
  }
}

const target: PsychoanalyzerTarget = {
  userId: 'real-user-id',
  username: 'profile-a',
  role: 'standard',
}

const memories: PsychoanalyzerMemory[] = [{
  id: 'memory-1',
  timestamp: '2026-08-28T12:00:00.000Z',
  content: 'I repeatedly make music.',
  type: 'conversation',
  tags: [],
}]

function createHarness(options: {
  enabled?: boolean
  insightsEnabled?: boolean
  archiveFailures?: number
  insightsFailures?: number
  stateFailures?: number
} = {}) {
  const runtime = {
    persona: persona(),
    state: { version: '1.0.0', receipts: [] } as PsychoanalyzerExecutionState,
    contexts: [] as PsychoanalyzerTarget[],
    savedStates: [] as PsychoanalyzerExecutionState[],
    analyzeCalls: 0,
    archiveCalls: 0,
    personaSaveCalls: 0,
    insightCalls: 0,
    lockReleases: 0,
    archiveFailures: options.archiveFailures ?? 0,
    insightsFailures: options.insightsFailures ?? 0,
    stateFailures: options.stateFailures ?? 0,
  }
  const psychoConfig = config(options.insightsEnabled ?? true)
  const dependencies: PsychoanalyzerExecutionDependencies = {
    now: () => new Date('2026-08-29T09:10:11.000Z'),
    withContext: async (resolvedTarget, callback) => {
      runtime.contexts.push(resolvedTarget)
      return callback()
    },
    acquireRunLock: () => ({ release: () => { runtime.lockReleases++ } }),
    isEnabled: () => options.enabled ?? true,
    loadConfig: async () => psychoConfig,
    selectMemories: async () => memories,
    loadPersona: () => structuredClone(runtime.persona),
    loadExecutionState: async () => structuredClone(runtime.state),
    saveExecutionState: async (_username, state) => {
      if (runtime.stateFailures-- > 0) throw new Error('state write failed')
      runtime.state = structuredClone(state)
      runtime.savedStates.push(structuredClone(state))
    },
    analyze: async () => {
      runtime.analyzeCalls++
      return {
        summary: 'Durable music interest',
        confidence: 0.9,
        changes: [{
          operation: 'add',
          path: 'personality.interests',
          value: 'music',
          evidenceIds: ['memory-1'],
          reason: 'Repeated explicit evidence',
        }],
      }
    },
    apply: (source, proposal, currentConfig, appliedAt) => applyPersonaLearningProposal(
      source,
      proposal,
      currentConfig,
      { appliedAt },
    ),
    archivePersona: (_source, archivedAt) => {
      runtime.archiveCalls++
      if (runtime.archiveFailures-- > 0) throw new Error('archive failed')
      return `core-${archivedAt.toISOString().replace(/[:.]/g, '-')}.json`
    },
    savePersona: (updated, updatedAt) => {
      runtime.personaSaveCalls++
      updated.lastUpdated = updatedAt.toISOString()
      runtime.persona = structuredClone(updated)
    },
    persistInsights: async (_username, receipt) => {
      if (!receipt.config.insights.enabled) return
      runtime.insightCalls++
      if (runtime.insightsFailures-- > 0) throw new Error('insights failed')
    },
  }
  return { runtime, dependencies }
}

test('Agent Catalog is the sole enable switch for new Psychoanalyzer work', async () => {
  const { runtime, dependencies } = createHarness({ enabled: false })
  const result = await executePsychoanalysis(target, {}, dependencies)
  assert.equal(result.skipped, true)
  assert.equal(result.skipReason, 'Disabled in Agent Catalog')
  assert.equal(runtime.analyzeCalls, 0)
  assert.equal(runtime.savedStates.length, 0)
})

test('canonical execution uses the resolved identity and records explicit outcomes', async () => {
  const { runtime, dependencies } = createHarness()
  const result = await executePsychoanalysis(target, {}, dependencies)

  assert.deepEqual(runtime.contexts, [target])
  assert.equal(runtime.analyzeCalls, 1)
  assert.equal(runtime.archiveCalls, 1)
  assert.equal(runtime.personaSaveCalls, 1)
  assert.equal(runtime.insightCalls, 1)
  assert.equal(runtime.lockReleases, 1)
  assert.deepEqual((runtime.persona.personality as any).interests, ['music'])
  assert.equal(runtime.savedStates[0]?.receipts[0]?.status, 'prepared')
  assert.equal(runtime.state.receipts[0]?.status, 'completed')
  assert.deepEqual(result, {
    memoriesAnalyzed: 1,
    confidence: 0.9,
    changesApplied: 1,
    changesRejected: 0,
  })
})

test('repeated invocation skips the completed input without another model call', async () => {
  const { runtime, dependencies } = createHarness()
  await executePsychoanalysis(target, {}, dependencies)
  const repeated = await executePsychoanalysis(target, {}, dependencies)

  assert.equal(runtime.analyzeCalls, 1)
  assert.equal(runtime.personaSaveCalls, 1)
  assert.equal(repeated.skipped, true)
  assert.match(repeated.skipReason ?? '', /No new evidence/)
})

test('a failed insights write leaves a prepared receipt and resumes after persona persistence', async () => {
  const { runtime, dependencies } = createHarness({ insightsFailures: 1 })
  await assert.rejects(
    executePsychoanalysis(target, {}, dependencies),
    /insights failed/,
  )
  assert.equal(runtime.state.receipts[0]?.status, 'prepared')
  assert.deepEqual((runtime.persona.personality as any).interests, ['music'])

  const resumed = await executePsychoanalysis(target, {}, dependencies)
  assert.equal(runtime.analyzeCalls, 1)
  assert.equal(runtime.archiveCalls, 1)
  assert.equal(runtime.personaSaveCalls, 1)
  assert.equal(runtime.insightCalls, 2)
  assert.equal(runtime.state.receipts[0]?.status, 'completed')
  assert.equal(resumed.resumed, true)
})

test('an archive failure prevents persona mutation and retries the same prepared run', async () => {
  const { runtime, dependencies } = createHarness({ archiveFailures: 1 })
  await assert.rejects(
    executePsychoanalysis(target, {}, dependencies),
    /archive failed/,
  )
  assert.equal(runtime.personaSaveCalls, 0)
  assert.equal(runtime.state.receipts[0]?.status, 'prepared')

  const resumed = await executePsychoanalysis(target, {}, dependencies)
  assert.equal(runtime.analyzeCalls, 1)
  assert.equal(runtime.archiveCalls, 2)
  assert.equal(runtime.personaSaveCalls, 1)
  assert.equal(resumed.resumed, true)
})

test('a prepared receipt is durable even when optional insights are disabled', async () => {
  const { runtime, dependencies } = createHarness({ insightsEnabled: false })
  const result = await executePsychoanalysis(target, {}, dependencies)
  assert.equal(result.changesApplied, 1)
  assert.equal(runtime.insightCalls, 0)
  assert.equal(runtime.state.receipts[0]?.status, 'completed')
})

test('a receipt write failure occurs before archive or persona mutation', async () => {
  const { runtime, dependencies } = createHarness({ stateFailures: 1 })
  await assert.rejects(
    executePsychoanalysis(target, {}, dependencies),
    /state write failed/,
  )
  assert.equal(runtime.archiveCalls, 0)
  assert.equal(runtime.personaSaveCalls, 0)
  assert.deepEqual((runtime.persona.personality as any).interests, [])
})

test('selection failure and cancellation fail before persona mutation', async () => {
  const selection = createHarness()
  selection.dependencies.selectMemories = async () => {
    throw new Error('Cannot scan episodic memory malformed.json: invalid JSON')
  }
  await assert.rejects(
    executePsychoanalysis(target, {}, selection.dependencies),
    /Cannot scan episodic memory/,
  )
  assert.equal(selection.runtime.analyzeCalls, 0)
  assert.equal(selection.runtime.personaSaveCalls, 0)

  const cancellation = createHarness()
  const controller = new AbortController()
  cancellation.dependencies.analyze = async () => {
    cancellation.runtime.analyzeCalls++
    controller.abort(new Error('cancelled by test'))
    return {
      summary: 'unused',
      confidence: 0.9,
      changes: [],
    }
  }
  await assert.rejects(
    executePsychoanalysis(target, { signal: controller.signal }, cancellation.dependencies),
    /cancelled by test/,
  )
  assert.equal(cancellation.runtime.savedStates.length, 0)
  assert.equal(cancellation.runtime.personaSaveCalls, 0)
})
