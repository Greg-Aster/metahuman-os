import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  parseDesireCandidates,
  parseReinforcementResponse,
  validateCandidateSources,
} from '@metahuman/core'
import { formatAgencyReview, parseDesireGeneratorArgs, selectRecentUserRequests } from './core.js'

const ROOT = path.resolve(import.meta.dirname, '../../..')

test('generator model contracts fail closed while accepting an intentional empty result', () => {
  assert.deepEqual(parseDesireCandidates('[]'), [])
  const candidates = parseDesireCandidates(JSON.stringify([{
    title: 'Review notes',
    description: 'Review the current notes',
    reason: 'A goal requires it',
    source: 'persona_goal',
    sourceId: 'goal-1',
    risk: 'none',
    suggestedAction: 'Read the notes',
  }]))
  assert.equal(candidates[0].source, 'persona_goal')
  assert.throws(() => parseDesireCandidates('not json'), /not valid JSON/)
  assert.throws(
    () => parseDesireCandidates('[{"title":"Incomplete"}]'),
    /missing required typed fields/,
  )
})

test('reinforcement decisions must use exact desire and evidence identifiers', () => {
  assert.deepEqual(
    parseReinforcementResponse(
      '{"desire-1":{"reason":"Recent work supports it","evidenceIds":["task:task-1"]}}',
      new Set(['desire-1']),
      new Set(['task:task-1']),
    ),
    [{ id: 'desire-1', reason: 'Recent work supports it', evidenceIds: ['task:task-1'] }],
  )
  assert.throws(
    () => parseReinforcementResponse(
      '{"unknown":{"reason":"Guess","evidenceIds":["task:task-1"]}}',
      new Set(['desire-1']),
      new Set(['task:task-1']),
    ),
    /invalid/,
  )
  assert.deepEqual(
    parseReinforcementResponse(
      '{"desire-1":{"reason":"A","evidenceIds":["task:task-1","task:task-1"]}}',
      new Set(['desire-1']),
      new Set(['task:task-1']),
    ),
    [{ id: 'desire-1', reason: 'A', evidenceIds: ['task:task-1'] }],
  )
})

test('generator accepts only an explicit profile selector', () => {
  assert.deepEqual(parseDesireGeneratorArgs(['--username', 'profile-a']), { username: 'profile-a' })
  assert.throws(() => parseDesireGeneratorArgs(['--single-user']), /accepts only/)
})

test('generator rejects model candidates whose claimed source was not present', () => {
  const candidate = parseDesireCandidates(JSON.stringify([{
    title: 'Review notes', description: 'Review notes', reason: 'Important',
    source: 'persona_goal', risk: 'none', suggestedAction: 'Read',
    sourceId: 'goal-1',
  }]))
  const inputs = {
    userRequests: [], personaGoals: [], urgentTasks: [], activeTasks: [], recentMemories: [], memoryPatterns: [],
    pendingCuriosityQuestions: [], recentReflections: [], recentDreams: [],
    currentTrustLevel: 'suggest', recentlyRejected: [], activeDesires: [],
  } as any
  assert.throws(() => validateCandidateSources(candidate, inputs), /no corresponding input/)
  inputs.personaGoals.push({ id: 'goal-1', goal: 'Review notes', status: 'active' })
  assert.equal(validateCandidateSources(candidate, inputs).length, 1)
})

test('generator has one episodic inventory owner and no fabricated profile path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'brain/agents/desire-generator/core.ts'), 'utf8')
  assert.match(source, /listEpisodicFiles\(\)/)
  assert.equal(source.match(/async function loadEpisodicDocuments/g)?.length, 1)
  assert.doesNotMatch(source, /storageClient\.resolvePath/)
  assert.doesNotMatch(source, /username: 'default'/)
  assert.doesNotMatch(source, /singleUser/)
  assert.match(source, /submitDesireAgent\(\{/)
})

test('Desire Agent validates the complete model decision before committing storage changes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'brain/agents/desire-generator/core.ts'), 'utf8')
  const start = source.indexOf('export async function generateDesiresForUser')
  const end = source.indexOf('// CLI Entry Point', start)
  const cycle = source.slice(start, end)
  const generationDecision = cycle.indexOf('await identifyDesires(inputs, signal)')
  const commit = cycle.indexOf('await applyNurtureDecisions(')
  assert.ok(generationDecision >= 0)
  assert.ok(commit > generationDecision)
  assert.match(cycle, /DECISION PHASE: all model output is obtained and validated before mutation/)
  assert.match(cycle, /COMMIT PHASE: apply only the complete, validated cycle decision/)
})

test('Desire Agent reads bounded stable user-request evidence only when it runs', () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `${index}: ${'x'.repeat(1_200)}`,
    timestamp: Date.UTC(2026, 0, index + 1),
    meta: index === 24 ? { idempotencyKey: 'conversation-request-24' } : undefined,
  }))
  const selected = selectRecentUserRequests(messages, 5)
  assert.equal(selected.length, 5)
  assert.equal(selected.at(-1)?.id, 'conversation-request-24')
  assert.equal(selected.every(request => request.content.length <= 1_000), true)
  assert.deepEqual(selectRecentUserRequests(messages, 5), selected)
})

test('Agency Review names actual model calls, changed desires, strengths, reasons, and evidence', () => {
  const content = formatAgencyReview({
    reviewedAt: '2026-09-06T00:03:12.000Z',
    freshEvidenceCount: 2,
    evidenceBySource: { 'user requests': 1, 'curiosity questions': 1 },
    modelCalls: [{
      operation: 'reinforce',
      cognitiveMode: 'agent',
      role: 'persona',
      provider: 'ollama',
      model: 'qwen3.5:9b',
      modelId: 'ollama.qwen3.5:9b',
      latencyMs: 5_212,
      tokens: { prompt: 4_098, completion: 141, total: 4_239 },
    }],
    reinforced: [{
      desireId: 'desire-1',
      title: 'Understand the owner',
      previousStrength: 0.188779,
      newStrength: 0.268779,
      change: 0.08,
      reason: 'A recent explicit request directly supports it.',
      evidence: [{ source: 'user_request', sourceId: 'request-1', summary: 'Please learn this preference.' }],
    }],
    decayed: [{
      desireId: 'desire-2',
      title: 'Old idea',
      previousStrength: 0.2,
      newStrength: 0.1985,
      change: -0.0015,
      reason: 'No fresh reinforcing evidence.',
    }],
    archived: [],
    activated: [],
    created: [],
    goalsProposed: [],
    candidatesRejectedAsDuplicates: 0,
    candidatesBlockedByCapacity: 0,
    generationSkippedReason: null,
  })

  assert.match(content, /ollama\/qwen3\.5:9b \(agent routing, persona role, 5\.21s, 4239 tokens\)/)
  assert.match(content, /Understand the owner \[desire-1\]: 0\.1888 → 0\.2688 \(\+0\.0800\)/)
  assert.match(content, /Evidence \(user_request:request-1\): Please learn this preference/)
  assert.match(content, /Old idea \[desire-2\]: 0\.2000 → 0\.1985 \(-0\.0015\)/)
  assert.doesNotMatch(content, /grew stronger|faded slightly/)
})
