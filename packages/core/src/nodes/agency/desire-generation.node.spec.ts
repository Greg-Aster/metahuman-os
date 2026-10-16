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
    { role: 'psychotherapist' },
    {
      callModel: async request => {
        assert.equal(request.role, 'psychotherapist')
        options = request.options
        prompt = String(request.messages[1]?.content ?? '')
        return {
          content: JSON.stringify({
            'desire-1': {
              targetStrength: 0.6,
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


test('Desire generation presents every eligible record and its complete content to the model', async () => {
  const content = 'context '.repeat(200) + 'The final evidence changes the interpretation.'
  const memories = Array.from({ length: 50 }, (_, i) => ({ id: `memory-${i}`, content: `${i}: ${content}`, type: 'conversation', timestamp: '2026-10-15T00:00:00.000Z' }))
  const tasks = Array.from({ length: 12 }, (_, i) => ({ id: `task-${i}`, title: `Task ${i}`, description: `${i}: ${content}` }))
  let prompt = ''
  let schema: any
  await executeDesireGeneration({
    operation: 'generate', existingDesires: [],
    inputs: {
      userRequests: [{ id: 'request', content }], personaGoals: [],
      urgentTasks: [{ id: 'urgent', title: 'Urgent', description: content, priority: 'P1' }],
      activeTasks: tasks, recentMemories: memories, memoryPatterns: [], pendingCuriosityQuestions: [],
      recentReflections: [{ id: 'reflection', content }], recentDreams: [{ id: 'dream', content }],
      currentTrustLevel: 'suggest', recentlyRejected: [], activeDesires: [],
    },
  }, { username: 'profile-a' } as any, {}, {
    callModel: async request => {
      prompt = String(request.messages[1]?.content ?? '')
      schema = request.options?.jsonSchema
      return { content: '[]', model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
    },
  })
  for (const variant of schema.items.oneOf) {
    for (const id of variant.properties.sourceId.enum) assert.ok(prompt.includes(`id=${id} |`), `Evidence ${id} is schema-eligible but missing from the model context`)
  }
  for (const memory of memories) assert.ok(prompt.includes(`id=${memory.id} | type=conversation | timestamp=${memory.timestamp} | ${memory.content}`))
  for (const task of tasks) assert.ok(prompt.includes(`id=${task.id} | ${task.title}: ${task.description}`))
  assert.ok(prompt.includes(`id=urgent | priority=P1 | Urgent: ${content}`))
  for (const id of ['request', 'reflection', 'dream']) assert.ok(prompt.includes(`id=${id} | ${content}`))
})

test('standing goals contextualize generation and reinforcement without becoming eligible evidence', async () => {
  const goal = { id: 'goal-context', goal: 'Understand the surroundings', status: 'planning', priority: 'mid' }
  const base = {
    standingContext: { personaGoals: [goal] },
    userRequests: [], personaGoals: [], urgentTasks: [], activeTasks: [], recentMemories: [], memoryPatterns: [],
    pendingCuriosityQuestions: [], recentReflections: [], recentDreams: [{ id: 'dream-new', content: 'A new dream narrative' }],
    currentTrustLevel: 'suggest', recentlyRejected: [], activeDesires: [],
  }
  for (const operation of ['generate', 'reinforce']) {
    let prompt = ''
    let schema: any
    await executeDesireGeneration({ operation, inputs: base, existingDesires: [{ id: 'desire-1', title: 'Existing goal', source: 'dream', strength: 0.4 }] }, { username: 'test' } as any, {}, {
      callModel: async request => {
        prompt = String(request.messages[1]?.content)
        schema = request.options?.jsonSchema
        return { content: operation === 'generate' ? '[]' : JSON.stringify({ 'desire-1': { targetStrength: 0.4, reason: 'Unchanged', evidenceIds: [] } }), model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
      },
    })
    assert.ok(prompt.includes('### Standing Persona Goals\nThese goals provide context. Their presence does not establish new evidence or reinforcement.'))
    assert.ok(prompt.includes('id=goal-context | priority=mid | Understand the surroundings (planning)'))
    assert.ok(prompt.includes('dream-new'))
    assert.ok(!JSON.stringify(schema).includes('goal-context'))
    assert.ok(JSON.stringify(schema).includes('dream-new'))
  }
  let prompt = ''
  await executeDesireGeneration({ operation: 'generate', inputs: { ...base, personaGoals: [goal] }, existingDesires: [] }, { username: 'test' } as any, {}, {
    callModel: async request => {
      prompt = String(request.messages[1]?.content)
      assert.ok(JSON.stringify(request.options?.jsonSchema).includes('goal-context'))
      return { content: '[]', model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
    },
  })
  assert.equal(prompt.split('id=goal-context |').length - 1, 1)
  assert.ok(!prompt.includes('### Standing Persona Goals'))
})

test('generation receives recorded lifecycle and uncommitted relevance decisions without calling them active', async () => {
  let prompt = ''
  await executeDesireGeneration({ operation: 'generate', existingDesires: [], inputs: {
    userRequests: [], personaGoals: [], urgentTasks: [], activeTasks: [], recentMemories: [], memoryPatterns: [], pendingCuriosityQuestions: [], recentReflections: [], recentDreams: [], currentTrustLevel: 'suggest', recentlyRejected: [],
    activeDesires: [{ id: 'old-desire', title: 'Previous outcome', source: 'task', status: 'nascent', strength: 0.4, outcomeKey: 'previous_outcome', completionCriteria: 'Recorded result' }],
    relevanceAssessments: [{ id: 'old-desire', targetStrength: 0, reason: 'Original request is already resolved', evidenceIds: ['operational:execution:one:event:receipt'] }],
  } }, { username: 'test' } as any, {}, { callModel: async request => {
    prompt = String(request.messages[1]?.content)
    return { content: '[]', model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
  } })
  assert.ok(prompt.includes('### Recorded Desires'))
  assert.ok(prompt.includes('"status": "nascent"'))
  assert.ok(prompt.includes('### Current Relevance Assessments (not yet committed)'))
  assert.ok(prompt.includes('"targetStrength": 0'))
  assert.doesNotMatch(prompt, /Already Active Desires/)
})

test('multiple operational receipts reference one complete execution context rather than copying its instructions and program', async () => {
  const instruction = 'ORIGIN_REQUEST_MARKER ' + 'original context '.repeat(400)
  const program = 'SELECTED_PROGRAM_MARKER ' + 'selected program '.repeat(400)
  const events = Array.from({ length: 20 }, (_, index) => ({ eventId: `receipt-${index}`, kind: 'physical_result', createdAt: index + 1, payload: { detail: `FULL_RECEIPT_PAYLOAD_${index}` } }))
  const context = { executions: [{ executionId: 'execution-full', task: { objectiveId: 'objective-full' }, admittedInput: { userMessage: instruction }, instructions: [], selections: [{ program }], events }], freshEventReferences: events.map(event => `operational:execution:execution-full:event:${event.eventId}`) }
  for (const operation of ['generate', 'reinforce']) {
    let prompt = ''
    await executeDesireGeneration({ operation, existingDesires: [{ id: 'desire-one', strength: 0.5 }], inputs: {
      operationalContext: context, userRequests: [], personaGoals: [], urgentTasks: [], activeTasks: [], recentMemories: [], memoryPatterns: [], pendingCuriosityQuestions: [], recentReflections: [], recentDreams: [], currentTrustLevel: 'suggest', recentlyRejected: [], activeDesires: [],
    } }, { username: 'test' } as any, {}, { callModel: async request => {
      prompt = String(request.messages[1]?.content)
      return { content: operation === 'generate' ? '[]' : JSON.stringify({ 'desire-one': { targetStrength: 0.5, reason: 'Unchanged', evidenceIds: [] } }), model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
    } })
    assert.equal(prompt.split('ORIGIN_REQUEST_MARKER').length - 1, 1)
    assert.equal(prompt.split('SELECTED_PROGRAM_MARKER').length - 1, 1)
    assert.ok(prompt.includes(instruction))
    assert.ok(prompt.includes(program))
    for (const event of events) {
      assert.equal(prompt.split(`"detail":"${event.payload.detail}"`).length - 1, 1)
      assert.ok(prompt.includes(`operational:execution:execution-full:event:${event.eventId}`))
    }
    assert.ok(prompt.length < JSON.stringify(context).length + 15000, 'receipt references must not multiply the complete execution payload')
  }
})
