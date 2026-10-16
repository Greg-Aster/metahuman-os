import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutionEvent } from '../../durable-execution/types.js'
import { executionContextNode, executionEventContext } from './execution-context.node.js'
import { executionEventWaitNode } from './execution-event-wait.node.js'
import { environmentImageInputNode } from '../environment/image-input.node.js'
import { environmentContextBuilderNode } from '../environment/context-builder.node.js'

const frame = {
  id: 'camera-gateway-body-3-51', timestamp: '2026-10-11T02:30:00.000Z',
  mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
  source: 'robot-camera', width: 640, height: 480,
  metadata: { robotId: 'selected-body', gatewayInstance: 'gateway', epoch: 3, counter: 51 },
}

test('input drain does not invent a workflow and preserves newly received human input', async () => {
  const pending: any[] = []
  const graphExecution = { pendingEvents: () => pending, waitForEvent: () => pending.shift() }
  const context = { graphExecution, _graphExecutorIteration: 1 } as any
  const properties = { drain: true, userGraph: 'environment', autonomyGraph: 'robot-autonomy-controller' }
  assert.deepEqual(await executionEventWaitNode.execute({}, context, properties), { invocation: null })
  assert.deepEqual(await executionEventWaitNode.execute({}, { ...context, _graphExecutorIteration: 2 }, properties), { invocation: null })
  const received = { userMessage: 'Actually, leave it there.', timestamp: 1234, speechGeneration: 9 }
  pending.push({ kind: 'user_steering', payload: received })
  const next = await executionEventWaitNode.execute({}, context, properties)
  assert.equal(next.invocation.graph, 'environment')
  assert.equal(next.invocation.context.userMessage, received.userMessage)
  assert.equal(next.invocation.context.timestamp, 1234)
  assert.equal(next.invocation.context.speechGeneration, 9)
  assert.equal(next.invocation.context.environmentTaskEvidence, undefined)
})

test('unfinished program handoffs do not start Goal Review before task results return', async () => {
  const graphExecution = { executionId: 'execution', task: () => ({
    objective: 'Inspect the target', decision: { outcome: 'continue', requiredCompletionBasis: 'visual_observation' },
  }), events: () => [], activeExecutions: () => [] }
  for (const done of [false, true]) {
    const result = await executionContextNode.execute({ taskResult: { done } }, { graphExecution } as any, {})
    assert.equal(result.needsGoalReview, done)
  }
})

test('final context carries assessment and returned evidence', async () => {
  const receipt = { actionId: 'capture', type: 'completed', timestamp: '2026-10-15T12:00:00Z' }
  const assessment = { outcome: 'request_user', reason: 'Two candidate objects are visible.',
    requiredCompletionBasis: 'user_input', observationSummary: 'The intended object is uncertain.', completionEvidence: '' }
  const inputs = { routingAnalysis: { needsResponse: true, taskContext: [], conversationContext: [] },
    goalAssessment: assessment, taskResult: { done: true, evidence: [receipt] },
    execution: { executionId: 'execution', events: [receipt] }, userInstruction: 'Find it.' }
  const result = await environmentContextBuilderNode.execute(inputs, {}, { purpose: 'conversation' })
  assert.deepEqual(JSON.parse(result.message).goalAssessment, assessment)
  assert.deepEqual(JSON.parse(result.message).taskResult.evidence, { $ref: '#/execution/events' })
  assert.deepEqual(JSON.parse(result.message).execution, inputs.execution)
})

test('later display and delivery events do not evict action receipts or user corrections from continuation evidence', async () => {
  const events: ExecutionEvent[] = [
    { eventId: 'stretch-rejected', executionId: 'execution', sequence: 1, createdAt: 1,
      kind: 'physical_result', actionId: 'stretch', payload: { feedback: {
        actionId: 'stretch', type: 'rejected', message: 'Motion mapping failed', timestamp: '2026-10-15T03:51:42Z',
      }, action: { type: 'robotCommand', command: 'stretch' } } },
    { eventId: 'correction', executionId: 'execution', sequence: 2, createdAt: 2,
      kind: 'user_input', payload: { userMessage: 'Only speak; I am holding you.', speaker: 'user' } },
    ...Array.from({ length: 24 }, (_, index): ExecutionEvent => ({
      eventId: `display-${index}`, executionId: 'execution', sequence: index + 3, createdAt: index + 3,
      kind: 'physical_result', actionId: `face-${index}`, payload: {
        action: { type: 'faceExpression', expression: 'thinking' },
        feedback: { actionId: `face-${index}`, type: 'completed' },
      },
    })),
  ]
  const original = structuredClone(events)
  const responseEntry = { role: 'assistant', content: 'The stretch was rejected.', timestamp: 27 }
  const task = { objective: 'React to the event', decision: { outcome: 'continue' } }
  const graphExecution = { executionId: 'execution', task: () => task, events: () => events, activeExecutions: () => [] }
  const result = await executionContextNode.execute({ responseEntry }, { graphExecution } as any, executionContextNode.properties)
  assert.deepEqual(result.context.events, events)
  assert.equal(result.context.latestEventSequence, 26)
  assert.deepEqual(result.context.responseEntry, responseEntry)
  assert.deepEqual(events, original)
})
function receipt(visual: typeof frame | null): ExecutionEvent {
  return { eventId: 'read-result', executionId: 'execution', sequence: 7, createdAt: 1,
    kind: 'work_result', workItemId: 'read-work', payload: {
      effectId: 'read-effect', result: { state: 'completed', result: { visual } },
    } }
}

test('camera work receipts expose frame references in execution text while retaining original image bytes', () => {
  const events = [receipt(frame)]
  const original = structuredClone(events)
  const projected = executionEventContext(events)
  const payload = projected[0].payload as any
  const { dataUrl: _dataUrl, ...reference } = frame
  assert.deepEqual(payload.result.result.visual, reference)
  assert.equal(projected[0].eventId, 'read-result')
  assert.equal(payload.result.state, 'completed')
  assert.deepEqual(events, original)
  assert.equal((events[0].payload as any).result.result.visual.dataUrl, frame.dataUrl)
  assert.equal(JSON.stringify(projected).includes(frame.dataUrl), false)
  assert.equal((executionEventContext([receipt(null)])[0].payload as any).result.result.visual, null)
})

test('nested specialist graph returns preserve frame provenance and all non-image evidence', () => {
  const event = receipt(frame)
  event.payload = { effectId: 'specialist', result: { state: 'completed',
    graphResults: [{ outputs: { observations: [{ visual: frame }], explanation: 'Observed evidence' } }],
    result: { stdout: 'Worker log', stderr: '', reasoning: { source: 'model', confidence: 'uncertain',
      timestamp: '2026-10-11T02:30:01.000Z', text: 'The frame alone does not establish completion.' },
      action: { type: 'robotCommand', command: 'bow' },
      details: Array.from({ length: 30 }, (_, n) => ({ n, detail: 'Keep this evidence'.repeat(100) })) },
  } }
  const original = structuredClone(event)
  const payload = executionEventContext([event])[0].payload as any
  assert.equal(payload.result.graphResults[0].outputs.observations[0].visual.id, frame.id)
  assert.deepEqual(payload.result.graphResults[0].outputs.observations[0].visual.metadata, frame.metadata)
  assert.equal(payload.result.graphResults[0].outputs.observations[0].visual.dataUrl, undefined)
  assert.deepEqual(payload.result.result.details, (event.payload as any).result.result.details)
  assert.deepEqual(payload.result.result.action, { type: 'robotCommand', command: 'bow' })
  assert.deepEqual(payload.result.result.reasoning, (event.payload as any).result.result.reasoning)
  assert.deepEqual(event, original)
})

test('execution context never embeds image bytes in text and selected vision still attaches the original image', async () => {
  const context = { events: executionEventContext([receipt(frame)]) }
  const selected = await environmentImageInputNode.execute({ visual: frame }, {}, {})
  for (const visionSelected of [false, true]) {
    const result = await environmentContextBuilderNode.execute({
      instruction: 'Describe the current situation.', userInstruction: 'Describe the current situation.',
      routingAnalysis: { needsResponse: true, taskContext: [], conversationContext: ['executionContext', ...(visionSelected ? ['vision'] : [])] },
      sourceExecution: context, images: selected.images, frames: selected.frames,
    }, { currentTime: '2026-10-11T02:30:01.000Z' }, { purpose: 'conversation', systemPrompt: 'Existing fixture contract' })
    assert.equal(result.message.includes(frame.dataUrl), false)
    assert.equal(result.message.includes(frame.id), true)
    const content = result.messages[1].content
    if (visionSelected) {
      assert.ok(Array.isArray(content))
      assert.deepEqual(content.filter((item: any) => item.type === 'image_url'), selected.images)
      assert.equal(content.find((item: any) => item.type === 'text').text.includes(frame.dataUrl), false)
    } else assert.equal(typeof content, 'string')
  }
})
