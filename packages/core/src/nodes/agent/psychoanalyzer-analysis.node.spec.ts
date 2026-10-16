import assert from 'node:assert/strict'
import test from 'node:test'

import type { PersonaCore } from '../../identity.js'
import type { PsychoanalyzerConfig } from '../../psychoanalyzer-config.js'
import { executePsychoanalyzerAnalysis } from './psychoanalyzer-analysis.node.js'

function config(): PsychoanalyzerConfig {
  return {
    version: '2.0.0',
    memorySelection: {
      strategy: 'priority_recent',
      daysBack: 30,
      maxScanFiles: 100,
      maxMemories: 10,
      minMemories: 1,
      excludeTypes: [],
      priorityTags: [],
      userInputOnly: true,
    },
    analysis: {
      model: 'psychotherapist',
      temperature: 0.3,
      maxTokens: 2200,
      maxEvidenceCharacters: 1000,
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

const persona: PersonaCore = {
  version: '1.0.0',
  lastUpdated: '2026-01-01T00:00:00.000Z',
  identity: { name: 'Owner', role: 'self', purpose: 'test' },
  personality: {},
  values: { core: [], boundaries: [] },
  goals: { shortTerm: [], midTerm: [], longTerm: [] },
  context: { domains: [], projects: [], currentFocus: [] },
}

const memory = {
  id: 'memory-1',
  timestamp: '2026-08-28T12:00:00.000Z',
  type: 'conversation',
  tags: [],
  content: 'I repeatedly make music.',
}

function inputs(overrides: Record<string, unknown> = {}) {
  return { memories: [memory], persona, config: config(), ...overrides }
}

const context = { username: 'owner', userId: 'owner-id', cognitiveMode: 'agent' } as any

test('Psychoanalyzer analysis calls the configured model once and validates grounded output', async () => {
  let calls = 0
  const result = await executePsychoanalyzerAnalysis(inputs(), context, {}, {
    callModel: (async (request: any) => {
      calls += 1
      assert.equal(request.role, 'psychotherapist')
      assert.equal(request.options?.maxTokens, 2200)
      return {
        content: JSON.stringify({
          summary: 'Durable interest',
          confidence: 0.9,
          changes: [{
            operation: 'add',
            path: 'personality.interests',
            value: 'music',
            evidenceIds: ['memory-1'],
            reason: 'Repeated explicit evidence',
          }],
        }),
      } as any
    }) as any,
  })
  assert.equal(calls, 1)
  assert.equal(result.proposal.changes[0]?.path, 'personality.interests')
})

test('Psychoanalyzer analysis rejects malformed and ungrounded model output', async () => {
  await assert.rejects(
    executePsychoanalyzerAnalysis(inputs(), context, {}, {
      callModel: (async () => ({ content: 'not-json' })) as any,
    }),
    /invalid JSON/,
  )
  await assert.rejects(
    executePsychoanalyzerAnalysis(inputs(), context, {}, {
      callModel: (async () => ({
        content: JSON.stringify({
          summary: 'Unsupported citation',
          confidence: 0.9,
          changes: [{
            operation: 'add',
            path: 'personality.interests',
            value: 'music',
            evidenceIds: ['not-selected'],
            reason: 'No selected evidence',
          }],
        }),
      })) as any,
    }),
    /must reference selected memories/,
  )
})

test('Psychoanalyzer analysis enforces evidence limits before model execution', async () => {
  let called = false
  const limited = config()
  limited.analysis.maxEvidenceCharacters = 1000
  await assert.rejects(
    executePsychoanalyzerAnalysis(inputs({
      config: limited,
      memories: [{ ...memory, content: 'x'.repeat(1001) }],
    }), context, {}, {
      callModel: (async () => {
        called = true
        return { content: '{}' }
      }) as any,
    }),
    /exceeds 1000 characters/,
  )
  assert.equal(called, false)
})

test('Psychoanalyzer analysis honors cancellation before model execution', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  let called = false
  await assert.rejects(
    executePsychoanalyzerAnalysis(inputs(), { ...context, abortSignal: controller.signal }, {}, {
      callModel: (async () => {
        called = true
        return { content: '{}' }
      }) as any,
    }),
    /cancelled by test/,
  )
  assert.equal(called, false)
})


test('Psychoanalyzer role selection preserves prompt and configured inference settings', async () => {
  const requests: any[] = []
  const dependencies = { callModel: (async (request: any) => {
    requests.push(request)
    return { content: JSON.stringify({ summary: 'No change', confidence: 0.8, changes: [] }) }
  }) as any }
  await executePsychoanalyzerAnalysis(inputs(), context, {}, dependencies)
  await executePsychoanalyzerAnalysis(inputs(), context, { role: 'persona' }, dependencies)
  await executePsychoanalyzerAnalysis(inputs({ role: 'curator' }), context, { role: 'persona' }, dependencies)
  assert.deepEqual(requests.map(request => request.role), ['psychotherapist', 'persona', 'curator'])
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.messages, requests[0].messages)
    assert.deepEqual(request.options, requests[0].options)
    assert.equal(request.cognitiveMode, 'agent')
  }
})


test('Psychoanalyzer passes supplied speaker and source attribution without inventing unknown authors', async () => {
  const known = { ...memory, role: 'assistant', source: 'conversation', cognitiveMode: 'environment', content: 'Assistant: quoted original content' }
  const unknown = { ...memory, id: 'unknown' }
  await executePsychoanalyzerAnalysis(inputs({ memories: [known, unknown] }), context, {}, {
    callModel: (async (request: any) => {
      const prompt = request.messages[0].content
      assert.deepEqual(JSON.parse(prompt.split('\n\nSUBJECT IDENTITY:\n')[1].split('\n\nCURRENT LEARNABLE PERSONA:')[0]), persona.identity)
      assert.match(prompt, /Statements about another person do not by themselves establish/)
      const evidence = JSON.parse(prompt.split('\n\nEVIDENCE:\n')[1])
      assert.deepEqual(evidence, [known, unknown])
      return { content: JSON.stringify({ summary: 'No durable change', confidence: 0.9, changes: [] }) }
    }) as any,
  })
})


test('Psychoanalyzer preserves an explicit instruction override while supplying factual identity', async () => {
  await executePsychoanalyzerAnalysis(inputs(), context, { instruction: 'Owner supplied instruction' }, {
    callModel: (async (request: any) => {
      assert.ok(request.messages[0].content.startsWith('Owner supplied instruction\n\nSUBJECT IDENTITY:'))
      assert.doesNotMatch(request.messages[0].content, /Statements about another person/)
      return { content: JSON.stringify({ summary: 'No change', confidence: 0.8, changes: [] }) }
    }) as any,
  })
})
