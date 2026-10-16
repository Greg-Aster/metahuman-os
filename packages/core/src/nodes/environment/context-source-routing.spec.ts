import assert from 'node:assert/strict'
import test, { after, mock } from 'node:test'

const live = {
  executions: [{ executionId: 'previous-task', objective: 'Stand up', status: 'waiting' }],
  recognition: { status: 'disabled', people: [] },
  movement: { commanded: { name: 'stand' }, measuredPhysicalMotion: { available: false } },
}
mock.module('../../robot-status-live.js', { namedExports: { readRobotStatusLive: async () => live } })
const { environmentContextBuilderNode } = await import('./context-builder.node.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); mock.restoreAll() })
const observation = {
  adapter: 'fixture', environmentId: 'fixture', sessionId: 'body', timestamp: '2030-01-01T00:00:00Z',
  state: { posture: 'stand' }, capabilities: { actions: ['robotCommand'],
    robotCommands: ['stand', 'rest'], robotCommandDescriptions: { stand: 'Stand on four feet.', rest: 'Take the rest pose.' } },
}
const build = async (taskContext: string[], conversationContext: string[] = [], purpose = 'task') => {
  const result = await environmentContextBuilderNode.execute({
    userInstruction: 'Please rest.', observation, sourceObservation: observation,
    routingAnalysis: { needsAction: true, needsResponse: true, taskContext, conversationContext },
    robotStatus: { situation: { currentGoal: 'Stand up' } },
    execution: { task: { objective: 'Stand up' } },
  }, { username: 'fixture' } as never, { purpose, systemPrompt: '', planningDelegation: false })
  return result.selectedContext
}

test('environment evidence cannot inject an unselected Robot Status or execution projection', async () => {
  const context = await build(['environment'])
  assert.equal(context.currentInstruction, 'Please rest.')
  assert.equal(context.currentEnvironment.state.posture, 'stand')
  assert.equal(context.currentEnvironment.capabilities.robotCommandCatalog.rest, 'Take the rest pose.')
  assert.equal(context.currentEnvironment.live, undefined)
  assert.equal(context.execution, null)
  assert.equal(context.robotStatus, null)
  assert.equal(JSON.stringify(context).includes('previous-task'), false)
  assert.deepEqual(context.currentEnvironment.recognition.people, [])
})

test('explicit Robot Status and execution selections retain their supplied evidence', async () => {
  const context = await build(['environment', 'robotStatus', 'executionContext'])
  assert.deepEqual(context.robotStatus.live, live)
  assert.equal(context.execution.task.objective, 'Stand up')
})

test('conversation and task still select Robot Status independently', async () => {
  const context = await build(['robotStatus'], ['environment'], 'conversation')
  assert.equal(context.robotStatus, null)
  assert.equal(context.currentEnvironment.live, undefined)
  assert.equal(JSON.stringify(context).includes('previous-task'), false)
})

test('goal review exposes the originating request separately from the selected objective', async () => {
  const { robotGoalReviewContextNode } = await import('../robot-operator/context-builder.node.js')
  const execution = { task: { instruction: 'Please rest.', source: 'user', objective: 'Stand up' } }
  const result = await robotGoalReviewContextNode.execute({
    instruction: 'Review the supplied execution.', execution, observation,
  }, {} as never, {})
  assert.equal(result.valid, true)
  const envelope = JSON.parse(result.messages[1].content)
  assert.deepEqual(envelope.originatingInstruction, { content: 'Please rest.', source: 'user' })
  assert.deepEqual(envelope.execution, execution)
  assert.deepEqual(envelope.robotStimulus.capabilities.robotCommandDescriptions,
    observation.capabilities.robotCommandDescriptions)
})

const completeText = (label: string) => `${label}\n${'Recorded context. '.repeat(900)}\n${label} END: the later result changed the situation.`

for (const owner of ['robotAutonomyControllerContextNode', 'robotAutonomyPlannerContextNode', 'robotGoalReviewContextNode'] as const) {
  test(`${owner} delivers complete context entries and source metadata`, async () => {
    const node = (await import('../robot-operator/context-builder.node.js'))[owner]
    const thought = completeText('Private reflection')
    const spoken = completeText('Spoken conversation')
    const instruction = completeText('Supplied instruction')
    const persona = completeText('Supplied persona')
    const source = `source-${'x'.repeat(250)}`
    const timestamp = 1791745046078
    const result = await node.execute({ instruction, observation, personaText: persona,
      conversationHistory: [{ role: 'user', content: spoken, timestamp }],
      innerHistory: [{ role: 'reflection', content: thought, timestamp,
        meta: { dialogueSource: source, correlationId: source, tags: ['inner-curiosity'] } }],
    }, {} as never, {})
    assert.equal(result.messages[0].content, instruction)
    const envelope = JSON.parse(result.messages[1].content)
    assert.equal(envelope.robotOperatorContext.activePersona, persona)
    const entries = envelope.robotOperatorContext.recentNarrativeContext.entries
    assert.equal(entries[0].content, spoken)
    assert.equal(entries[0].timestamp, timestamp)
    assert.equal(entries[1].content, thought)
    assert.equal(entries[1].timestamp, timestamp)
    assert.deepEqual(entries[1].context, { isInnerDialogue: true, originalRole: 'reflection',
      dialogueSource: source, correlationId: source, tags: ['inner-curiosity'] })
  })
}

test('Environment context delivers complete selected text to task and conversation consumers', async () => {
  const instruction = completeText('Current instruction')
  const persona = completeText('Persona')
  const reply = completeText('Reply target')
  const description = completeText('Command meaning')
  const thought = completeText('Inner thought')
  const feedback = completeText('Action result')
  const current = { ...observation, feedback: [{ id: 'receipt', timestamp: observation.timestamp,
    type: 'completed', message: feedback }], capabilities: { ...observation.capabilities,
    robotCommandDescriptions: { stand: description } } }
  for (const purpose of ['task', 'conversation']) {
    const result = await environmentContextBuilderNode.execute({
      userInstruction: instruction, personaText: persona,
      observation: current, sourceObservation: current, observationCurrent: true,
      conversationHistory: [{ role: 'system', content: thought, timestamp: 1791745046078,
        meta: { isInnerDialogue: true, originalRole: 'reflection', dialogueSource: 'inner-curiosity' } }],
      robotStatus: { task: { objective: feedback } },
      routingAnalysis: { needsAction: true, needsResponse: true,
        taskContext: ['environment', 'persona.personality', 'conversationHistory', 'robotStatus'],
        conversationContext: ['environment', 'persona.personality', 'conversationHistory', 'robotStatus'] },
    }, { replyToContent: reply } as never, { purpose, systemPrompt: '', planningDelegation: false })
    const envelope = result.selectedContext
    assert.equal(envelope.currentInstruction, instruction)
    assert.equal(envelope.activePersona, persona)
    assert.equal(envelope.replyToContext, reply)
    assert.equal(envelope.currentEnvironment.capabilities.robotCommandCatalog.stand, description)
    assert.equal(envelope.currentEnvironment.feedback[0].message, feedback)
    assert.equal(envelope.robotStatus.task.objective, feedback)
    assert.equal(envelope.innerDialogue[0].content, thought)
    assert.equal(envelope.innerDialogue[0].timestamp, new Date(1791745046078).toISOString())
  }
})
