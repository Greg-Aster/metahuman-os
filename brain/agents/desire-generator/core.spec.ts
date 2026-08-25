import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  parseDesireCandidates,
  parseDesireGeneratorArgs,
  parseReinforcementResponse,
  validateCandidateSources,
} from './core.js'

const ROOT = path.resolve(import.meta.dirname, '../../..')

test('generator model contracts fail closed while accepting an intentional empty result', () => {
  assert.deepEqual(parseDesireCandidates('[]'), [])
  const candidates = parseDesireCandidates(JSON.stringify([{
    title: 'Review notes',
    description: 'Review the current notes',
    reason: 'A goal requires it',
    source: 'persona_goal',
    initialStrength: 0.7,
    risk: 'none',
    suggestedAction: 'Read the notes',
  }]))
  assert.equal(candidates[0].source, 'persona_goal')
  assert.throws(() => parseDesireCandidates('not json'), /did not contain/)
  assert.throws(
    () => parseDesireCandidates('[{"title":"Incomplete"}]'),
    /missing required typed fields/,
  )
})

test('reinforcement decisions must name an existing desire exactly once', () => {
  assert.deepEqual(
    [...parseReinforcementResponse(
      '[{"id":"desire-1","reason":"Recent work supports it"}]',
      new Set(['desire-1']),
    )],
    [['desire-1', 'Recent work supports it']],
  )
  assert.throws(
    () => parseReinforcementResponse('[{"id":"unknown","reason":"Guess"}]', new Set(['desire-1'])),
    /invalid/,
  )
  assert.throws(
    () => parseReinforcementResponse('[{"id":"desire-1","reason":"A"},{"id":"desire-1","reason":"B"}]', new Set(['desire-1'])),
    /Duplicate/,
  )
})

test('generator accepts only an explicit profile selector', () => {
  assert.deepEqual(parseDesireGeneratorArgs(['--username', 'profile-a']), { username: 'profile-a' })
  assert.throws(() => parseDesireGeneratorArgs(['--single-user']), /accepts only/)
})

test('generator rejects model candidates whose claimed source was not present', () => {
  const candidate = parseDesireCandidates(JSON.stringify([{
    title: 'Review notes', description: 'Review notes', reason: 'Important',
    source: 'persona_goal', initialStrength: 0.5, risk: 'none', suggestedAction: 'Read',
  }]))
  const inputs = {
    personaGoals: [], urgentTasks: [], activeTasks: [], recentMemories: [], memoryPatterns: [],
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
})
