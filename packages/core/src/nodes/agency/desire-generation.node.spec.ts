import assert from 'node:assert/strict'
import test from 'node:test'

import { executeDesireGeneration } from './desire-generation.node.js'

test('Desire Generation gives the selected model its complete typed output contract', async () => {
  let options: Record<string, unknown> | undefined
  let messages: Array<{ role: string; content: unknown }> | undefined
  const output = await executeDesireGeneration(
    {
      operation: 'generate',
      existingDesires: [],
      inputs: {
        userRequests: [],
        personaGoals: [{ id: 'goal-1', goal: 'Explore thoughtfully', status: 'active' }],
        urgentTasks: [],
        activeTasks: [],
        recentMemories: [],
        memoryPatterns: [],
        pendingCuriosityQuestions: [],
        recentReflections: [],
        recentDreams: [],
        currentTrustLevel: 'suggest',
        recentlyRejected: [],
        activeDesires: [],
      },
    },
    { username: 'profile-a' } as any,
    {},
    {
      callModel: async request => {
        options = request.options
        messages = request.messages as Array<{ role: string; content: unknown }>
        return {
          content: JSON.stringify([{
            title: 'Explore thoughtfully',
            description: 'Choose a useful exploratory activity',
            reason: 'The active persona goal supports exploration',
            source: 'persona_goal',
            sourceId: 'goal-1',
            risk: 'none',
            suggestedAction: 'Produce a report on a selected landmark',
            outcomeKey: 'document_landmark',
            completionCriteria: 'A saved report describes the landmark with source references',
          }]),
          model: 'test-model',
          modelId: 'test-model',
          role: 'persona',
          provider: 'test',
        }
      },
    },
  )

  assert.equal(options?.format, 'json')
  assert.deepEqual((options?.jsonSchema as any).required, undefined)
  const variants = (options?.jsonSchema as any).items.oneOf
  assert.equal(variants.length, 1)
  assert.deepEqual(variants[0].required, [
    'title',
    'description',
    'reason',
    'source',
    'sourceId',
    'risk',
    'suggestedAction',
    'outcomeKey',
    'completionCriteria',
  ])
  assert.deepEqual(variants[0].properties.source.enum, ['persona_goal'])
  assert.deepEqual(variants[0].properties.sourceId.enum, ['goal-1'])
  assert.equal((output.candidates as any[])[0].sourceId, 'goal-1')
  assert.deepEqual(output.modelCall, {
    operation: 'generate',
    cognitiveMode: null,
    role: 'persona',
    provider: 'test',
    model: 'test-model',
    modelId: 'test-model',
    latencyMs: undefined,
    tokens: undefined,
  })
  const prompt = String(messages?.[1]?.content ?? '')
  assert.match(prompt, /id=goal-1/)
  assert.doesNotMatch(prompt, /\[goal-1\]/)
  assert.match(prompt, /source and sourceId must identify the same supporting input/)
})

test('Desire reinforcement uses runtime-owned desire keys and evidence references', async () => {
  let options: Record<string, unknown> | undefined
  let prompt = ''
  const output = await executeDesireGeneration(
    {
      operation: 'reinforce',
      existingDesires: [{
        id: 'desire-1',
        title: 'Stand more often',
        description: 'Use available movement opportunities',
        reason: 'Movement supports embodiment',
        strength: 0.4,
        source: 'user_request',
      }],
      inputs: {
        userRequests: [{ id: 'request-1', content: 'I want you to stand more often', timestamp: '2026-09-05T00:00:00.000Z' }],
        personaGoals: [],
        urgentTasks: [],
        activeTasks: [],
        recentMemories: [],
        memoryPatterns: [],
        pendingCuriosityQuestions: [],
        recentReflections: [],
        recentDreams: [],
        currentTrustLevel: 'suggest',
        recentlyRejected: [],
        activeDesires: [],
      },
    },
    { username: 'profile-a' } as any,
    {},
    {
      callModel: async request => {
        options = request.options
        prompt = String(request.messages[1]?.content ?? '')
        return {
          content: JSON.stringify({
            'desire-1': {
              reason: 'The explicit request directly supports this desire',
              evidenceIds: ['user_request:request-1'],
            },
          }),
          model: 'test-model',
          modelId: 'test-model',
          role: 'persona',
          provider: 'test',
        }
      },
    },
  )

  const schema = options?.jsonSchema as any
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(Object.keys(schema.properties), ['desire-1'])
  assert.deepEqual(
    schema.$defs.decision.properties.evidenceIds.items.enum,
    ['user_request:request-1'],
  )
  assert.equal(schema.properties['desire-1'].$ref, '#/$defs/decision')
  assert.match(prompt, /"desire-1"/)
  assert.match(prompt, /"reference": "user_request:request-1"/)
  assert.doesNotMatch(prompt, /\[desire-1\]/)
  assert.deepEqual((output.reinforcements as any[])[0].evidence, [{
    source: 'user_request',
    sourceId: 'request-1',
    summary: 'I want you to stand more often',
  }])
  assert.equal((output.modelCall as any).operation, 'reinforce')
  assert.equal((output.modelCall as any).model, 'test-model')
})
