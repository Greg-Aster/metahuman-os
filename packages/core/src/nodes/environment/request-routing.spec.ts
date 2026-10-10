import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'
import type { SvelteFlowGraph } from '../../cognitive-graph-schema.js'

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-request-routing-'))
process.env.METAHUMAN_ROOT = isolatedRoot
globalThis.fetch = async () => { throw new Error('Network access is forbidden in routing tests') }
const router = await import('../../model-router.js')
const calls: any[] = []
let routing: Record<string, any> = {}
let choice: any = { program: null, taskDecision: null }
let speech = 'Hello.'
let delegatedPlan: any
let speechError: Error | undefined
let beforeSpeech: (() => void) | undefined
mock.module('../../model-router.js', { namedExports: { ...router,
  callLLM: async (options: any) => {
    if (options.role === 'persona' && options.options?.format === 'json') {
      calls.push(structuredClone({ role: options.role, modelId: options.modelId, messages: options.messages, options: options.options }))
      return { content: JSON.stringify(delegatedPlan) }
    }
    if (options.role === 'persona') { beforeSpeech?.(); if (speechError) throw speechError }
    calls.push(structuredClone({ role: options.role, modelId: options.modelId, messages: options.messages, options: options.options }))
    return { content: options.role === 'persona' ? speech : JSON.stringify(['orchestrator', 'environmentIntent'].includes(options.role) ? routing : choice) }
  },
} })
const { OrchestratorLLMNode } = await import('../../nodes/llm/orchestrator-llm.node.js')
const { MemoryRouterNode } = await import('../memory/memory-router.node.js')
const { executeGraph } = await import('../../graph-executor.js')
const { nodeExecutors } = await import('../../nodes/index.js')
const { ExecutionStore } = await import('../../durable-execution/store.js')
const { executionDefinition } = await import('../../durable-execution/graph-contract.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); mock.restoreAll() })
const fullGraph = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url), 'utf8')) as SvelteFlowGraph
fs.mkdirSync(path.join(isolatedRoot, 'etc/cognitive-graphs'), { recursive: true })
fs.copyFileSync(new URL('../../../../../etc/cognitive-graphs/environment-conversation-mode.json', import.meta.url),
  path.join(isolatedRoot, 'etc/cognitive-graphs/environment-conversation-mode.json'))
fs.copyFileSync(new URL('../../../../../etc/cognitive-graphs/robot-active-task-mode.json', import.meta.url),
  path.join(isolatedRoot, 'etc/cognitive-graphs/robot-active-task-mode.json'))
const intentProperties = fullGraph.nodes.find(node => node.id === 'intent-orchestrator')!.data.properties!
const routes = (selected: string[] = []) => {
  const entries = Object.entries({ needsConversationHistory: 'conversationHistory', needsExecutionContext: 'executionContext',
    needsPersona: 'persona.personality', needsMemory: 'memory', needsRobotStatus: 'robotStatus', needsEnvironment: 'environment', needsVision: 'vision' })
    .filter(([field]) => selected.includes(field)).map(([, entry]) => entry)
  return { needsResponse: selected.includes('needsResponse'), needsAction: selected.includes('needsAction'),
    taskContext: entries, conversationContext: selected.includes('needsResponse') ? entries : [] }
}


// Production graph and scheduler, actual intent/context/selector/parser/handoff nodes.
// Replace source I/O and physical/presentation effects with observable fixtures.
const excluded = new Set(['input-events', 'continue-user-input', 'remaining-objective', 'review-remaining-objective', 'await-objective-input', 'conversation-result'])
const graph = { ...fullGraph, nodes: fullGraph.nodes.filter(node => !excluded.has(node.id)),
  scheduler: { ...fullGraph.scheduler, eventInputNodeId: undefined },
  edges: fullGraph.edges.filter(edge => !excluded.has(edge.source) && !excluded.has(edge.target)) }
const activeExecutions = [{ executionId: 'ongoing-1', canSteer: true, objective: 'Find the cat' }]
const observation = { sessionId: 'robot-1', environmentId: 'fixture', timestamp: '2026-10-07T12:00:00Z',
  capabilities: { actions: ['robotCommand'], robotCommands: ['wave'], robotCommandDescriptions: { wave: 'Wave one front leg.' } }, state: {} }

test('input received during recall reaches active-task initial state before any program phase runs', async () => {
  const { environmentActiveTaskNode } = await import('./active-task.node.js')
  const userInput = { userMessage: 'A later input', timestamp: 456 }
  let childContext: any
  const result = await environmentActiveTaskNode.execute({
    program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    sessionId: 'robot-1', userInput,
  }, { username: 'routing-fixture', graphExecution: {
    callGraph: async (_graph: unknown, context: any) => {
      childContext = context
      return { nodes: new Map([['wait', { definition: { type: 'environment_active_task_wait' },
        status: 'completed', outputs: { state: context.activeTaskInitialState } }]]) }
    },
    task: () => null,
    frame: () => undefined,
  } } as any, {})
  assert.deepEqual(childContext.activeTaskInitialState.userInput, userInput)
  assert.equal(childContext.activeTaskInitialState.instructionRevision, 1)
  assert.equal(childContext.activeTaskInitialState.stepIndex, 0)
  assert.deepEqual(result.userInput, userInput)
  assert.equal(result.finished, false)
})

async function run(request: string, selected: string[], response = { response: 'Hello.', program: null, taskDecision: null } as any, options: {
  routing?: Record<string, any>; memoryWork?: boolean; memoryFailure?: boolean; delegatedPlan?: any; failSpeech?: boolean; beforeSpeech?: (reads: string[]) => void;
  awaitTask?: boolean; taskResult?: any; observation?: any; returnedObservation?: any; execution?: any;
} = {}) {
  calls.length = 0
  routing = options.routing ?? routes(selected)
  const { response: conversation, ...taskChoice } = response
  delegatedPlan = options.delegatedPlan
  choice = taskChoice
  speech = conversation ?? 'Hello.'
  const parentCalls = taskChoice.delegatePlanning ? 3 : 2
  const expectedCalls = parentCalls + (selected.includes('needsResponse') && response.executionDisposition !== 'steer'
    && options.taskResult?.done !== false ? 1 : 0)
  const reads: string[] = []
  beforeSpeech = () => options.beforeSpeech?.(reads)
  speechError = options.failSpeech ? new Error('Simulated speech generation failure') : undefined
  const store = new ExecutionStore(':memory:')
  const definition = executionDefinition(graph)
  const execution = store.create('routing-fixture', definition)
  const lease = store.claim(execution.executionId, definition)
  const entry = { role: 'user', content: request, timestamp: 123, id: 'current-turn' }
  const replacements: Record<string, (...args: any[]) => Promise<any>> = {
    environment_face_expression: async (inputs: any) => ({ control: inputs.control, success: true, status: 'fixture-display' }),
    user_input: async () => ({ message: request, entry }),
    conversation_buffer: async (inputs: any) => ({ entry, entries: [entry], response: inputs.response }),
    memory_capture: async (inputs: any) => ({ passthrough: inputs.passthrough }),
    conversation_history: async () => { reads.push('history'); return { history: [{ role: 'user', content: 'earlier-dialogue' }] } },
    memory_router: async (_inputs: any, context: any) => {
      reads.push('memory')
      if (!options.memoryWork) return { memories: [{ content: 'retrieved-memory' }] }
      return MemoryRouterNode.execute(_inputs, context, { dispatch: true, threshold: .65, topK: 3 })
    },
    robot_status: async () => { reads.push('status'); return { context: { updatedAt: 'fixture-status', body: { sessionId: 'robot-1' } } } },
    execution_context: async () => { reads.push('execution'); return { context: options.execution ?? { executionId: 'current', task: null }, activeExecutions } },
    environment_bridge_input: async () => { reads.push('bridge'); return { observation: options.observation ?? observation, sessionId: 'robot-1', isTriggeringObservation: false } },
    observation_history: async () => { reads.push('observations'); return { observations: [] } },
    persona_loader: async () => { reads.push('persona'); return { persona: {}, formatted: 'fixture-persona', taskFormatted: 'fixture-persona', conversationFormatted: 'fixture-persona' } },
    robot_status_out: async () => { reads.push('status-out'); return { persisted: true } },
    environment_active_task: async (_inputs: any, context: any) => {
      if (options.memoryWork && routing.taskContext.includes('memory')) {
        assert.equal(_inputs.userInput?.userMessage, 'A later input', 'Input received during recall reaches the existing active-task interpreter')
      }
      if (options.awaitTask) context.graphExecution.waitForEvent('simulated_task_result')
      reads.push('physical-dispatch')
      const result = options.taskResult ?? { done: true, objectiveComplete: true, stepIndex: 1, evidence: ['Gesture completed'] }
      return { finished: result.done, result,
        resultObservation: options.returnedObservation,
        resultContext: options.returnedObservation ? { environmentObservation: options.returnedObservation, environmentObservationCurrent: false } : {} }
    },
    tts: async (_inputs: any, context: any) => { reads.push(`speech:${context.ttsGeneration}:${context.memoryTimestamp}`); return {} }, stream_writer: async () => ({}),
  }
  const originals = new Map(Object.keys(replacements).map(key => [key, nodeExecutors.get(key)!]))
  for (const [key, execute] of Object.entries(replacements)) nodeExecutors.set(key, execute)
  try {
    let result = await executeGraph(graph, { username: 'routing-fixture', userMessage: request, cognitiveMode: 'environment', memoryTimestamp: 123, ttsGeneration: 7,
      conversationHistory: [{ role: 'user', content: 'implicit-history-must-not-leak' }],
    }, undefined, undefined, { store, lease })
    if (options.memoryWork) {
      assert.equal(result.status, 'waiting')
      const taskNeedsRecall = (routing.taskContext as string[]).includes('memory')
      assert.equal(calls.length, taskNeedsRecall ? 1 : parentCalls,
        'Only a consumer needing recall should wait before its model call')
      const work = store.pendingDispatches().find(item => (item.payload as any)?.type === 'semantic_search')!
      assert.ok(work)
      const userEvent = store.appendEvent(execution.executionId, { eventId: 'input-during-recall', kind: 'user_steering',
        payload: { userMessage: 'A later input' } })
      result = await executeGraph(graph, {}, undefined, undefined, { store, lease, resumeEventId: userEvent.eventId })
      assert.equal(result.status, 'waiting')
      const memoryEvent = store.appendEvent(execution.executionId, { eventId: 'returned-memory', kind: 'work_result', payload: {
        effectId: work.effectId, result: options.memoryFailure ? { state: 'failed', error: 'Search failed' } : {
          state: 'completed', result: [{ score: .9, item: { id: 'recall-1', text: 'retrieved-memory', timestamp: '2030-01-01', memoryType: 'conversation' } }],
        },
      } })
      result = await executeGraph(graph, {}, undefined, undefined, { store, lease, resumeEventId: memoryEvent.eventId })
      if (options.memoryFailure) {
        assert.equal(result.status, 'failed')
        assert.match(result.error!.message, /Memory search failed/)
        assert.equal(store.pendingDispatches().some(item => (item.payload as any)?.handler === 'environment.conversation'), false)
        return { result, reads, dispatches: [], envelope: undefined }
      }
      const builderId = taskNeedsRecall ? '3' : 'conversation-context'
      assert.equal(result.nodes.get(builderId)?.outputs?.receivedInput.userMessage, 'A later input')
      assert.equal(store.pendingDispatches().filter(item => (item.payload as any)?.type === 'semantic_search').length, 1)
    }
    if (options.awaitTask) {
      assert.equal(result.status, 'waiting')
      assert.equal(calls.length, parentCalls)
      assert.equal(store.pendingDispatches().some(item => (item.payload as any)?.handler === 'environment.conversation'), false,
        'A selected program must return before final response inference is dispatched')
      const event = store.appendEvent(execution.executionId, { eventId: 'returned-task', kind: 'physical_result',
        actionId: 'simulated-action', payload: {} })
      result = await executeGraph(graph, {}, undefined, undefined, { store, lease, resumeEventId: event.eventId })
    }
    assert.equal(result.status, 'completed', result.error?.stack)
    const { getGraphOutput } = await import('../../graph-executor.js')
    assert.equal(getGraphOutput(result)?.response || '', '', 'Planning JSON must never become the chat response')
    assert.equal(calls.length, parentCalls, 'The parent never waits for conversation inference')
    const effects = store.pendingDispatches()
    const responseWork = effects.find(item => (item.payload as any)?.handler === 'environment.conversation')
    let delivery: any, deliveryError: Error | undefined
    if (responseWork) {
      const { ModelRouterNode } = await import('../llm/model-router.node.js')
      const input = (responseWork.payload as any).input
      assert.equal(input.graphContext.memoryTimestamp, 123)
      assert.equal(input.graphContext.ttsGeneration, 7)
      try {
        const generated = await ModelRouterNode.execute(input.messages, input.graphContext, input.properties)
        const namespace = `work:${responseWork.effectId}:graph:0`
        const childOptions = { store, lease, invocationId: namespace, checkpointNamespace: namespace, externalChild: true }
        delivery = await executeGraph(input.graph, { ...input.graphContext, environmentConversationResponse: generated.response },
          undefined, undefined, childOptions)
        assert.equal(delivery.status, 'completed', delivery.error?.stack)
        const presented = reads.filter(value => value.startsWith('speech:')).length
        await executeGraph(input.graph, input.graphContext, undefined, undefined, { ...childOptions, resume: true })
        assert.equal(reads.filter(value => value.startsWith('speech:')).length, presented, 'Delivery replay cannot repeat speech')
      } catch (error) { if (!options.failSpeech) throw error; deliveryError = error as Error }
    }
    assert.equal(calls.length, options.failSpeech ? parentCalls : expectedCalls)
    const count = store.pendingDispatches().length
    const physicalCount = reads.filter(value => value === 'physical-dispatch').length
    await executeGraph(graph, { userMessage: request, cognitiveMode: 'environment' }, undefined, undefined, { store, lease, resume: true })
    assert.equal(store.pendingDispatches().length, count, 'Parent replay cannot duplicate work')
    assert.equal(reads.filter(value => value === 'physical-dispatch').length, physicalCount, 'Parent replay cannot repeat an action')
    assert.equal(calls.length, options.failSpeech ? parentCalls : expectedCalls, 'Parent replay cannot repeat inference')
    const dispatches = effects.filter(item => item.kind === 'execution_event').map(item => ({ kind: item.kind, payload: item.payload as Record<string, any> }))
    return { result, delivery, deliveryError, reads, dispatches, envelope: JSON.parse(calls[1].messages[1].content) }
  } finally {
    for (const [key, execute] of originals) nodeExecutors.set(key, execute)
    store.close()
  }
}

test('request-only intent payload is unchanged by explicit or implicit history and execution state', async () => {
  routing = routes(['needsAction'])
  calls.length = 0
  await OrchestratorLLMNode.execute({ message: 'Please wave.' }, {}, intentProperties)
  const baseline = calls[0]
  const history = [{ role: 'user', content: 'unrelated-history '.repeat(10_000) }]
  await OrchestratorLLMNode.execute({ message: 'Please wave.', conversationHistory: history,
    execution: { events: history }, activeExecutions, feedbackContext: { specificFeedback: 'unrelated-feedback' } },
  { conversationHistory: history, currentTime: 'different-time' }, intentProperties)
  assert.deepEqual(calls[1], baseline)
  assert.equal(calls[1].messages[1].content, 'Current user message: Please wave.')
  assert.equal(JSON.stringify(calls[1]).includes('unrelated-history'), false)
  assert.equal('executionDisposition' in calls[1].options.jsonSchema.properties, false)
})

test('ordinary greeting skips optional source reads and the editor note', async () => {
  const { result, reads, envelope } = await run('Hello', ['needsResponse'])
  assert.deepEqual(reads.filter(value => !value.startsWith('speech:')), ['bridge', 'observations', 'status-out'])
  for (const id of ['conversation-history', 'execution', 'memory-router', 'robot-status', '11', 'workflow-guide', 'persona-loader']) {
    assert.equal(result.nodes.get(id)?.status, 'skipped', id)
  }
  assert.deepEqual(envelope.recentConversation, [])
  assert.deepEqual(envelope.memories, [])
  assert.equal(envelope.execution, null)
  assert.deepEqual(envelope.currentEnvironment.state, {})
  assert.equal(envelope.currentEnvironment.capabilities.robotCommandCatalog.wave, 'Wave one front leg.')
  assert.equal(envelope.activePersona, null)
  assert.equal(JSON.stringify(calls).includes('ENVIRONMENT MODE — REQUEST-FIRST DATA FLOW'), false)
})

test('autonomy uses request-first intent and preserves the internal source attribution', async () => {
  const autonomy = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/boredom-autonomy-mode.json', import.meta.url), 'utf8'))
  const properties = autonomy.nodes.find((node: any) => node.data.nodeType === 'orchestrator_llm').data.properties
  routing = routes(['needsAction', 'needsExecutionContext', 'needsConversationHistory'])
  calls.length = 0
  const result = await OrchestratorLLMNode.execute({ message: 'Explore the room',
    execution: { executionId: 'autonomy-task' }, conversationHistory: [{ role: 'assistant', content: 'autonomy-history' }],
  }, {}, properties)
  const prompt = JSON.stringify(calls[0].messages)
  assert.match(prompt, /Internal planner intention: Explore the room/)
  assert.equal(prompt.includes('autonomy-history'), false)
  assert.equal(prompt.includes('autonomy-task'), false)
  assert.deepEqual(result.analysis.taskContext, ['conversationHistory', 'executionContext'])
  assert.equal(Object.hasOwn(calls[0].options, 'repeatPenalty'), false)
})

test('an action reads bridge capabilities without history, memories, status or task context', async () => {
  const { reads, envelope } = await run('Please wave', ['needsAction'], {
    response: '', program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested gesture', completionCriteria: 'Wave completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
  })
  assert.equal(reads.filter(item => item === 'physical-dispatch').length, 1)
  for (const source of ['history', 'memory', 'status', 'execution', 'persona']) assert.equal(reads.includes(source), false)
  assert.equal(envelope.activePersona, null)
  assert.equal(envelope.currentEnvironment.capabilities.robotCommandCatalog.wave, 'Wave one front leg.')
  assert.deepEqual(envelope.recentConversation, [])
})

test('persona is loaded and formatted only when independently selected by the model', async () => {
  for (const selected of [['needsPersona'], ['needsResponse', 'needsPersona']]) {
    const { result, reads, envelope } = await run('Current request', selected)
    assert.equal(reads.filter(source => source === 'persona').length, 1)
    assert.equal(envelope.activePersona, 'fixture-persona')
    assert.equal(result.nodes.get('persona-loader')?.status, 'completed')
    assert.equal(result.nodes.has('persona-formatter'), false)
    assert.equal(JSON.stringify(calls[0].messages).includes('fixture-persona'), false)
    for (const source of ['history', 'memory', 'status', 'execution']) assert.equal(reads.includes(source), false)
  }
})

test('selected dialogue, recall and status load once and reach the second call', async () => {
  const { reads, envelope } = await run('What did you dream about yesterday?',
    ['needsResponse', 'needsConversationHistory', 'needsMemory', 'needsRobotStatus'])
  for (const source of ['history', 'memory', 'status']) assert.equal(reads.filter(item => item === source).length, 1)
  assert.equal(reads.filter(source => source === 'bridge').length, 1)
  assert.equal(envelope.recentConversation[0].content, 'earlier-dialogue')
  assert.equal(envelope.memories[0].content, 'retrieved-memory')
  assert.equal(envelope.robotStatus.updatedAt, 'fixture-status')
})

test('steering transfers the unchanged request once without local speech, status update or physical dispatch', async () => {
  const { reads, dispatches, result, envelope } = await run('Do that again', ['needsExecutionContext', 'needsConversationHistory'], {
    response: '', program: null, taskDecision: null, executionDisposition: 'steer', targetExecutionId: 'ongoing-1',
  })
  assert.deepEqual(envelope.activeExecutions, activeExecutions)
  assert.equal(dispatches.length, 1)
  assert.equal(dispatches[0].payload.kind, 'user_steering')
  assert.equal(dispatches[0].payload.executionId, 'ongoing-1')
  assert.equal(dispatches[0].payload.context.userMessage, 'Do that again')
  assert.equal(dispatches[0].payload.context.userMessageEntry.id, 'current-turn')
  for (const id of ['conversation-model', 'active-task', 'robot-status-out']) assert.equal(result.nodes.get(id)?.status, 'skipped', id)
  assert.equal(reads.includes('physical-dispatch'), false)
})

test('cancellation uses the existing execution event owner and introduces no robot command', async () => {
  const { reads, dispatches } = await run('Stop what you are doing', ['needsExecutionContext'], {
    response: '', program: null, taskDecision: null, executionDisposition: 'cancel', targetExecutionId: 'ongoing-1',
  })
  assert.equal(dispatches.length, 1)
  assert.equal(dispatches[0].payload.kind, 'user_cancelled')
  assert.equal(dispatches[0].payload.context.userMessage, 'Stop what you are doing')
  assert.equal(reads.includes('physical-dispatch'), false)
})

test('context-selected follow-up can choose an action after an early no-action guess', async () => {
  const { reads, envelope } = await run('Do that again', ['needsConversationHistory', 'needsResponse'], {
    response: '', program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    taskDecision: { outcome: 'act', objective: 'Wave again', reason: 'Repeat the requested action', completionCriteria: 'Wave completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
  })
  assert.equal(envelope.selectedRoutes.needsAction, false, 'Retain the early model decision as data')
  assert.equal(envelope.recentConversation[0].content, 'earlier-dialogue')
  assert.equal(reads.filter(item => item === 'physical-dispatch').length, 1)
  const schema = calls[1].options.jsonSchema
  assert.ok(schema.anyOf.some((branch: any) => branch.properties.program.type === 'object'))
})

test('LLM nodes use saved roles and leave supplied messages unchanged', async () => {
  calls.length = 0
  await OrchestratorLLMNode.execute({ message: 'Please wave.' }, {}, { ...intentProperties, role: 'orchestrator' })
  assert.equal(Object.hasOwn(calls[0].options, 'repeatPenalty'), false, 'Environment intent must inherit model sampling settings')
  assert.equal(calls[0].role, 'orchestrator')
  assert.equal(calls[0].modelId, undefined)
  const { ModelRouterNode } = await import('../llm/model-router.node.js')
  const messages = [{ role: 'user', content: 'Synthetic request' }]
  await ModelRouterNode.execute({ messages }, {}, { role: 'persona' })
  assert.equal(calls[1].role, 'persona')
  assert.equal(calls[1].modelId, undefined)
  assert.deepEqual(calls[1].messages, messages)
})


test('task and conversation are separate model calls sharing selected evidence without repeated reads', async () => {
  const { delivery, reads } = await run('Repeat the movement and explain it',
    ['needsResponse', 'needsPersona', 'needsConversationHistory', 'needsMemory'], {
      response: 'The movement is selected.',
      program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
      taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested movement', completionCriteria: 'Wave completes',
        continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
    })
  assert(calls.every(call => call.modelId === undefined))
  assert.deepEqual(calls.map(call => call.role), ['orchestrator', 'environmentActionSelector', 'persona'])
  assert.equal(calls[1].options.format, 'json')
  for (const branch of calls[1].options.jsonSchema.anyOf) {
    assert.equal('response' in branch.properties, false)
    assert.equal(branch.required.includes('response'), false)
  }
  assert.equal(calls[2].options.format, undefined)
  assert.equal(calls[2].options.jsonSchema, undefined)
  const task = JSON.parse(calls[1].messages[1].content)
  const conversation = JSON.parse(calls[2].messages[1].content)
  for (const field of ['currentInstruction', 'activePersona', 'recentConversation', 'memories']) {
    assert.deepEqual(conversation[field], task[field], field)
  }
  assert.equal('capabilityRules' in conversation, false)
  assert.deepEqual(conversation.currentEnvironment.capabilities, task.currentEnvironment.capabilities)
  assert.equal(conversation.selectedTask.program.steps[0].action.command, 'wave')
  assert.deepEqual(conversation.selectedTask.commandDescriptions, { wave: 'Wave one front leg.' })
  assert.equal(conversation.selectedTask.actionAdmission.admitted, true)
  assert.equal(conversation.selectedTask.taskDecision.objectiveComplete, false)
  assert.equal(delivery.nodes.get('conversation-buffer')?.outputs?.response, 'The movement is selected.')
  for (const source of ['persona', 'history', 'memory']) assert.equal(reads.filter(item => item === source).length, 1)
})

test('no-response and steering routes skip conversation inference and presentation', async () => {
  for (const [selected, choice] of [
    [[], { program: null, taskDecision: null }],
    [['needsResponse', 'needsExecutionContext'], { program: null, taskDecision: null,
      executionDisposition: 'steer', targetExecutionId: 'ongoing-1' }],
  ] as Array<[string[], any]>) {
    const { result } = await run('Current request', selected, choice)
    assert.equal(calls.length, 2)
    for (const id of ['conversation-context', 'conversation-model']) {
      assert.equal(result.nodes.get(id)?.status, 'skipped', id)
    }
  }
})

test('saved interpretation feeds only the task model; conversation still performs its own inference', async () => {
  const { environmentContextBuilderNode } = await import('./context-builder.node.js')
  const { ModelRouterNode } = await import('../llm/model-router.node.js')
  const proposal = JSON.stringify({ taskDecision: null, program: null })
  const context = { environmentInterpretation: { response: proposal } }
  const taskContext = await environmentContextBuilderNode.execute({ instruction: 'Current request', routingAnalysis: routes(['needsResponse']) },
    context, fullGraph.nodes.find(node => node.id === '3')!.data.properties!)
  calls.length = 0
  const task = await ModelRouterNode.execute({ messages: taskContext.messages, precomputedResponse: taskContext.precomputedResponse }, context,
    fullGraph.nodes.find(node => node.id === '4')!.data.properties!)
  assert.equal(task.response, proposal)
  assert.equal(calls.length, 0)
  const conversationContext = await environmentContextBuilderNode.execute({ selectedContext: taskContext.selectedContext,
    selectedTask: { program: null, taskDecision: null, actionAdmission: null } }, context,
    fullGraph.nodes.find(node => node.id === 'conversation-context')!.data.properties!)
  assert.equal(conversationContext.precomputedResponse, undefined)
  speech = 'Independent conversation output'
  const conversation = await ModelRouterNode.execute({ messages: conversationContext.messages }, context,
    fullGraph.nodes.find(node => node.id === 'conversation-model')!.data.properties!)
  assert.equal(calls.length, 1)
  assert.equal(conversation.response, speech)
  const { interpretationGraph } = await import('../../environment-interface/interpretation.js')
  const interpretation = interpretationGraph(fullGraph)
  assert.equal(interpretation.nodes.filter(node => node.data.nodeType === 'model_router').length, 1)
  assert.equal(interpretation.nodes.some(node => node.id === 'conversation-model'), false)
})

test('task-only validation preserves action contracts while allowing no selected activity', async () => {
  const { environmentActionParserNode } = await import('./action-parser.node.js')
  const properties = { includeResponse: false }
  const empty = await environmentActionParserNode.execute({ response: JSON.stringify({ program: null, taskDecision: null }) }, {}, properties)
  assert.equal(empty.program, null)
  assert.equal(empty.taskDecision, null)
  assert.equal(empty.hasResponse, false)
  await assert.rejects(environmentActionParserNode.execute({ response: JSON.stringify({ program: null, taskDecision: null, response: 'Leaked speech' }) }, {}, properties), /response is not an Environment model-output field/)
  await assert.rejects(environmentActionParserNode.execute({ response: JSON.stringify({ program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] }, taskDecision: null }) }, {}, properties), /requires its objective decision/)
})


test('existing saved combined graphs retain their output contract while Environment selects task-only', async () => {
  const { environmentContextBuilderNode } = await import('./context-builder.node.js')
  const combined = await environmentContextBuilderNode.execute({ instruction: 'Saved request', routingAnalysis: routes(['needsResponse']) }, {}, {})
  for (const branch of combined.jsonSchema.anyOf) assert.equal(branch.required.includes('response'), true)
  const task = await environmentContextBuilderNode.execute({ instruction: 'Current request', routingAnalysis: routes(['needsResponse']) }, {},
    fullGraph.nodes.find(node => node.id === '3')!.data.properties!)
  for (const branch of task.jsonSchema.anyOf) assert.equal(branch.required.includes('response'), false)
})


test('a capability question retains the catalog even when no program is selected', async () => {
  await run('What movements can you perform?', ['needsResponse', 'needsEnvironment'])
  const envelope = JSON.parse(calls[2].messages[1].content)
  assert.equal(envelope.selectedTask.program, null)
  assert.deepEqual(envelope.currentEnvironment.capabilities.robotCommandCatalog, { wave: 'Wave one front leg.' })
})

test('selected motion starts before delayed speech and survives a failed conversation call', async () => {
  const selection = { response: 'I can wave.', program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested gesture', completionCriteria: 'Wave completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' } }
  for (const failSpeech of [false, true]) {
    const result = await run('Wave for me', ['needsAction', 'needsResponse'], selection, {
      failSpeech, beforeSpeech: reads => assert.equal(reads.filter(value => value === 'physical-dispatch').length, 1,
        'Slow inference starts only after the parent has been free to dispatch the selected program'),
    })
    assert.equal(result.reads.filter(value => value === 'physical-dispatch').length, 1)
    assert.equal(result.result.status, 'completed')
    if (failSpeech) assert.match(result.deliveryError!.message, /Simulated speech generation failure/)
    else assert.equal(result.reads.filter(value => value === 'speech:7:123').length, 1)
  }
})

test('returned camera and action receipts reach the final response after the complete selected program', async () => {
  const request = 'Tell me what you see, tell me a fact about cats, and do a bow.'
  const frame = { id: 'returned-picture', timestamp: '2026-10-07T12:01:00Z', source: 'robot-camera',
    dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=', mimeType: 'image/jpeg', metadata: { actionId: 'capture-1' } }
  const body = { ...observation, capabilities: { actions: ['captureImage', 'robotCommand'],
    robotCommands: ['bow'], robotCommandDescriptions: { bow: 'Lower the front of the body, then recover.' } } }
  const returned = { ...body, timestamp: '2026-10-07T12:01:03Z', visual: frame,
    feedback: [{ type: 'completed', actionId: 'bow-1', message: 'Bow completed', timestamp: '2026-10-07T12:01:03Z' }] }
  const execution = { executionId: 'current', events: [{ kind: 'physical_result', actionId: 'bow-1',
    recordedAt: '2026-10-07T12:01:03Z', payload: { feedback: returned.feedback[0] } }] }
  const result = await run(request, ['needsResponse', 'needsAction', 'needsVision'], {
    response: 'The camera shows the room. Cats have retractable claws. The bow completed.',
    program: { steps: [{ kind: 'action', action: { type: 'captureImage' } },
      { kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] },
    taskDecision: { outcome: 'act', objective: request, reason: 'Requested tasks', completionCriteria: 'Capture, respond and bow',
      continuationPolicy: 'none', requiredCompletionBasis: 'visual_observation' },
  }, { awaitTask: true, observation: body, returnedObservation: returned, execution,
    taskResult: { done: true, objectiveComplete: false, stepIndex: 2, capturedFrameIds: [frame.id],
      evidence: ['Capture completed', 'Bow completed'] } })
  const content = calls.at(-1).messages[1].content
  const envelope = JSON.parse(content[0].text.split('\n').slice(1).join('\n'))
  assert.equal(envelope.currentInstruction, request)
  assert.equal(envelope.currentEnvironment.timestamp, returned.timestamp)
  assert.equal(envelope.currentEnvironment.visualFrames[0].actionId, 'capture-1')
  assert.equal(envelope.currentEnvironment.visualFrames[0].timestamp, frame.timestamp)
  assert.deepEqual(content[1], { type: 'image_url', image_url: { url: frame.dataUrl } })
  assert.deepEqual(envelope.execution, execution)
  assert.deepEqual(envelope.taskResult.evidence, ['Capture completed', 'Bow completed'])
  assert.equal(envelope.taskResult.objectiveComplete, false, 'Response generation cannot fabricate objective completion')
  assert.equal(result.reads.filter(item => item.startsWith('speech:')).length, 1)
})

test('physical failure reaches conversation as a failure and interrupted work produces no premature final response', async () => {
  const selection = { program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested', completionCriteria: 'Wave completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' } }
  const failure = { actionId: 'wave-1', type: 'failed', message: 'Simulated actuator failure', timestamp: '2026-10-07T12:01:00Z' }
  await run('Wave', ['needsResponse', 'needsAction'], selection, {
    awaitTask: true, taskResult: { done: true, objectiveComplete: false, stepIndex: 0, evidence: [], failure } })
  const envelope = JSON.parse(calls.at(-1).messages[1].content)
  assert.deepEqual(envelope.taskResult.failure, failure)
  assert.equal(envelope.taskResult.objectiveComplete, false)
  const interrupted = await run('Wave', ['needsResponse', 'needsAction'], selection, {
    taskResult: { done: false, stepIndex: 0, evidence: [] } })
  assert.equal(interrupted.result.nodes.get('conversation-model')?.status, 'skipped')
  assert.equal(interrupted.reads.some(item => item.startsWith('speech:')), false)
})

test('an unavailable selected command reaches the final response without waiting for an unadmitted program', async () => {
  const result = await run('Bow', ['needsResponse', 'needsAction'], {
    response: 'That command was not admitted.',
    program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] },
    taskDecision: { outcome: 'act', objective: 'Bow', reason: 'Requested', completionCriteria: 'Bow completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
  })
  const envelope = JSON.parse(calls.at(-1).messages[1].content)
  assert.equal(envelope.selectedTask.actionAdmission.admitted, false)
  assert.equal(envelope.selectedTask.actionAdmission.reason, 'robot_command_unavailable')
  assert.equal(result.result.nodes.get('active-task')?.status, 'skipped')
  assert.equal(result.reads.filter(item => item.startsWith('speech:')).length, 1)
})


test('the small model can delegate the unchanged context and the larger result uses the same executor', async () => {
  const program = { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] }
  const plan = { program, taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested gesture',
    completionCriteria: 'Wave completes', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' } }
  const result = await run('Wave for me', ['needsAction'], { delegatePlanning: true }, { delegatedPlan: plan })
  assert.deepEqual(calls.map(value => value.role), ['orchestrator', 'environmentActionSelector', 'persona'])
  assert(calls.every(value => value.modelId === undefined))
  assert.deepEqual(calls[2].messages[1], calls[1].messages[1])
  assert.match(calls[1].messages[0].content, /delegatePlanning/)
  assert.equal(calls[2].messages[0].content.includes('delegatePlanning'), false)
  assert.ok(calls[1].options.jsonSchema.anyOf.some((branch: any) => branch.properties.delegatePlanning))
  assert.equal(calls[2].options.jsonSchema.anyOf.some((branch: any) => branch.properties.delegatePlanning), false)
  assert.equal(result.result.nodes.get('6')!.outputs!.program.steps[0].action.command, 'wave')
  assert.equal(result.result.nodes.get('6')!.outputs!.program.steps[0].action.sessionId, 'robot-1')
  assert.equal(result.reads.filter(value => value === 'physical-dispatch').length, 1)
  assert.equal(result.result.nodes.get('6')!.outputs!.rawResponse, JSON.stringify(plan))
})

test('delegation also preserves the larger model no-action choice and reports invalid or recursive results', async () => {
  const result = await run('Consider the request', [], { delegatePlanning: true }, { delegatedPlan: { program: null, taskDecision: null } })
  assert.equal(result.reads.includes('physical-dispatch'), false)
  const { environmentTaskPlannerNode } = await import('./task-planner.node.js')
  const properties = fullGraph.nodes.find(node => node.id === '6')!.data.properties!
  for (const output of [{ delegatePlanning: true }, { program: { steps: [] }, taskDecision: null }]) {
    delegatedPlan = output
    await assert.rejects(environmentTaskPlannerNode.execute({ response: '{"delegatePlanning":true}', planningMessages: [{ role: 'user', content: 'Original' }], planningSchema: {} }, {}, properties), /Delegated planning failed/)
  }
})

test('conversation-only context never enters task or delegated planning messages', async () => {
  const { envelope, reads } = await run('Current request', ['needsResponse'], undefined, { routing: {
    needsResponse: true, needsAction: false, taskContext: [],
    conversationContext: ['persona.personality', 'conversationHistory', 'memory', 'robotStatus'],
  } })
  assert.equal(envelope.activePersona, null)
  assert.deepEqual(envelope.memories, [])
  assert.deepEqual(envelope.recentConversation, [])
  assert.equal(envelope.robotStatus, null)
  const conversation = JSON.parse(calls[2].messages[1].content)
  assert.equal(conversation.activePersona, 'fixture-persona')
  assert.equal(conversation.memories[0].content, 'retrieved-memory')
  assert.equal(conversation.recentConversation[0].content, 'earlier-dialogue')
  assert.equal(conversation.robotStatus.updatedAt, 'fixture-status')
  for (const name of ['persona', 'memory', 'history', 'status']) assert.equal(reads.filter(read => read === name).length, 1)
})

test('task-only context is absent from the conversation prompt', async () => {
  const { envelope } = await run('Current request', ['needsResponse'], undefined, { routing: {
    needsResponse: true, needsAction: false, taskContext: ['persona.values', 'memory', 'robotStatus'], conversationContext: [],
  } })
  assert.equal(envelope.activePersona, 'fixture-persona')
  assert.equal(envelope.memories[0].content, 'retrieved-memory')
  const conversation = JSON.parse(calls[2].messages[1].content)
  assert.equal(conversation.activePersona, null)
  assert.deepEqual(conversation.memories, [])
  assert.equal(conversation.robotStatus, null)
})

test('conversation-selected execution context includes unfinished execution records', async () => {
  const { envelope } = await run('Current request', ['needsResponse'], undefined, { routing: {
    needsResponse: true, needsAction: false, taskContext: [], conversationContext: ['executionContext'],
  } })
  assert.equal(envelope.activeExecutions, undefined)
  const conversation = JSON.parse(calls[2].messages[1].content)
  assert.deepEqual(conversation.activeExecutions, activeExecutions)
})

test('conversation-only recall overlaps task work and preserves input across durable waits', async () => {
  const { envelope } = await run('Current request', ['needsResponse'], undefined, { memoryWork: true, routing: {
    needsResponse: true, needsAction: false, taskContext: [], conversationContext: ['memory'],
  } })
  assert.deepEqual(envelope.memories, [])
  const conversation = JSON.parse(calls[2].messages[1].content)
  assert.equal(conversation.memories[0].content, 'retrieved-memory')
})

test('shared recall is joined before task inference and reused by conversation', async () => {
  const { envelope } = await run('Current request', ['needsResponse'], undefined, { memoryWork: true, routing: {
    needsResponse: true, needsAction: false, taskContext: ['memory'], conversationContext: ['memory'],
  } })
  const conversation = JSON.parse(calls[2].messages[1].content)
  assert.deepEqual(conversation.memories, envelope.memories)
  assert.equal(envelope.memories[0].content, 'retrieved-memory')
})

test('failed recall remains a failed workflow instead of silently supplying empty memory', async () => {
  await run('Current request', ['needsResponse'], undefined, { memoryWork: true, memoryFailure: true, routing: {
    needsResponse: true, needsAction: false, taskContext: [], conversationContext: ['memory'],
  } })
})

test('finite ongoing-task interpretation reuses synchronous recall inside its existing Coordinator job', async () => {
  const { interpretationGraph } = await import('../../environment-interface/interpretation.js')
  const graph = interpretationGraph(fullGraph)
  assert.equal(fullGraph.nodes.find(node => node.id === 'memory-router')?.data.properties?.dispatch, true)
  assert.equal(graph.nodes.find(node => node.id === 'memory-router')?.data.properties?.dispatch, false)
  assert.equal(graph.nodes.some(node => node.id === 'conversation-context'), false)
  assert.equal(graph.nodes.some(node => ['environment_expression_feedback', 'environment_face_expression'].includes(node.data.nodeType)), false)
  assert.ok(graph.edges.some(edge => edge.source === 'user-input' && edge.sourceHandle === 'message'
    && edge.target === 'intent-orchestrator' && edge.targetHandle === 'message'))
})

test('later input during execution or conversation takes precedence over input received during recall', () => {
  // The graph executor applies active data edges in their saved order.
  assert.deepEqual(fullGraph.edges.filter(edge => edge.target === 'input-events' && edge.targetHandle === 'receivedInput')
    .map(edge => edge.source), ['3', 'active-task', 'conversation-context', 'conversation-result'])
})


test('input received during task recall reaches execution as well as final continuation', async () => {
  await run('Current request', ['needsAction'], {
    response: '', program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
    taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested gesture', completionCriteria: 'Wave completes',
      continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
  }, { memoryWork: true, routing: { needsResponse: false, needsAction: true, taskContext: ['memory'], conversationContext: [] } })
})
