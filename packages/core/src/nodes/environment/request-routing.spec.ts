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
let routing: Record<string, boolean> = {}
let choice: any = { program: null, taskDecision: null }
let speech = 'Hello.'
mock.module('../../model-router.js', { namedExports: { ...router,
  callLLM: async (options: any) => {
    calls.push(structuredClone({ role: options.role, modelId: options.modelId, messages: options.messages, options: options.options }))
    return { content: options.role === 'persona' ? speech : JSON.stringify(options.role === 'orchestrator' ? routing : choice) }
  },
} })
const { OrchestratorLLMNode } = await import('../../nodes/llm/orchestrator-llm.node.js')
const { executeGraph } = await import('../../graph-executor.js')
const { nodeExecutors } = await import('../../nodes/index.js')
const { ExecutionStore } = await import('../../durable-execution/store.js')
const { executionDefinition } = await import('../../durable-execution/graph-contract.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); mock.restoreAll() })
const fullGraph = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url), 'utf8')) as SvelteFlowGraph
const intentProperties = fullGraph.nodes.find(node => node.id === 'intent-orchestrator')!.data.properties!
const routes = (selected: string[] = []) => Object.fromEntries([
  'needsResponse', 'needsConversationHistory', 'needsExecutionContext', 'needsPersona', 'needsMemory',
  'needsRobotStatus', 'needsEnvironment', 'needsVision', 'needsAction',
].map(field => [field, selected.includes(field)]))

// Production graph and scheduler, actual intent/context/selector/parser/handoff nodes.
// Replace source I/O and physical/presentation effects with observable fixtures.
const excluded = new Set(['input-events', 'continue-user-input', 'remaining-objective', 'review-remaining-objective', 'await-objective-input'])
const graph = { ...fullGraph, nodes: fullGraph.nodes.filter(node => !excluded.has(node.id)),
  scheduler: { ...fullGraph.scheduler, eventInputNodeId: undefined },
  edges: fullGraph.edges.filter(edge => !excluded.has(edge.source) && !excluded.has(edge.target)) }
const activeExecutions = [{ executionId: 'ongoing-1', canSteer: true, objective: 'Find the cat' }]
const observation = { sessionId: 'robot-1', environmentId: 'fixture', timestamp: '2026-10-07T12:00:00Z',
  capabilities: { actions: ['robotCommand'], robotCommands: ['wave'], robotCommandDescriptions: { wave: 'Wave one front leg.' } }, state: {} }

async function run(request: string, selected: string[], response = { response: 'Hello.', program: null, taskDecision: null } as any) {
  calls.length = 0
  routing = routes(selected)
  const { response: conversation, ...taskChoice } = response
  choice = taskChoice
  speech = conversation ?? 'Hello.'
  const expectedCalls = selected.includes('needsResponse') && response.executionDisposition !== 'steer' ? 3 : 2
  const reads: string[] = []
  const store = new ExecutionStore(':memory:')
  const definition = executionDefinition(graph)
  const execution = store.create('routing-fixture', definition)
  const lease = store.claim(execution.executionId, definition)
  const entry = { role: 'user', content: request, timestamp: 123, id: 'current-turn' }
  const replacements: Record<string, (...args: any[]) => Promise<any>> = {
    user_input: async () => ({ message: request, entry }),
    conversation_buffer: async (inputs: any) => ({ entry, entries: [entry], response: inputs.response }),
    memory_capture: async (inputs: any) => ({ passthrough: inputs.passthrough }),
    conversation_history: async () => { reads.push('history'); return { history: [{ role: 'user', content: 'earlier-dialogue' }] } },
    memory_router: async () => { reads.push('memory'); return { memories: [{ content: 'retrieved-memory' }] } },
    robot_status: async () => { reads.push('status'); return { context: { updatedAt: 'fixture-status', body: { sessionId: 'robot-1' } } } },
    execution_context: async () => { reads.push('execution'); return { context: { executionId: 'current', task: null }, activeExecutions } },
    environment_bridge_input: async () => { reads.push('bridge'); return { observation, sessionId: 'robot-1', isTriggeringObservation: false } },
    observation_history: async () => { reads.push('observations'); return { observations: [] } },
    persona_loader: async () => { reads.push('persona'); return { persona: {}, formatted: 'fixture-persona' } },
    robot_status_out: async () => { reads.push('status-out'); return { persisted: true } },
    environment_active_task: async () => { reads.push('physical-dispatch'); return { finished: false } },
    tts: async () => ({}), stream_writer: async () => ({}),
  }
  const originals = new Map(Object.keys(replacements).map(key => [key, nodeExecutors.get(key)!]))
  for (const [key, execute] of Object.entries(replacements)) nodeExecutors.set(key, execute)
  try {
    const result = await executeGraph(graph, { userMessage: request, cognitiveMode: 'environment',
      conversationHistory: [{ role: 'user', content: 'implicit-history-must-not-leak' }],
    }, undefined, undefined, { store, lease })
    assert.equal(result.status, 'completed', result.error?.stack)
    assert.equal(calls.length, expectedCalls)
    const dispatches = store.pendingDispatches().map(item => ({ kind: item.kind, payload: item.payload as Record<string, any> }))
    if (dispatches.length) {
      await executeGraph(graph, { userMessage: request, cognitiveMode: 'environment' }, undefined, undefined, { store, lease, resume: true })
      assert.equal(store.pendingDispatches().length, 1, 'Replaying saved outputs must not duplicate the handoff')
      assert.equal(calls.length, expectedCalls, 'A completed checkpoint must not repeat model calls')
    }
    return { result, reads, dispatches, envelope: JSON.parse(calls[1].messages[1].content) }
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
  assert.deepEqual(reads, ['bridge', 'observations', 'status-out'])
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

test('the existing autonomy contract retains its supplied history and execution evidence', async () => {
  const autonomy = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/boredom-autonomy-mode.json', import.meta.url), 'utf8'))
  const properties = autonomy.nodes.find((node: any) => node.data.nodeType === 'orchestrator_llm').data.properties
  const { needsExecutionContext: _execution, needsPersona: _persona, ...autonomyRoutes } = routes(['needsAction'])
  routing = autonomyRoutes
  calls.length = 0
  await OrchestratorLLMNode.execute({ message: 'Explore the room',
    execution: { executionId: 'autonomy-task' }, conversationHistory: [{ role: 'assistant', content: 'autonomy-history' }],
  }, {}, properties)
  const prompt = JSON.stringify(calls[0].messages)
  assert.match(prompt, /autonomy-task/)
  assert.match(prompt, /autonomy-history/)
  assert.equal('needsExecutionContext' in calls[0].options.jsonSchema.properties, false)
  assert.equal('needsPersona' in calls[0].options.jsonSchema.properties, false)
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
  for (const id of ['conversation-buffer', 'tts-out', 'active-task', 'robot-status-out']) assert.equal(result.nodes.get(id)?.status, 'skipped', id)
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

 test('LLM nodes pass their explicit model selection without changing prompts', async () => {
  calls.length = 0
  await OrchestratorLLMNode.execute({ message: 'Please wave.' }, {}, { ...intentProperties, modelId: 'fixture.small' })
  assert.equal(calls[0].modelId, 'fixture.small')
  const { ModelRouterNode } = await import('../llm/model-router.node.js')
  const messages = [{ role: 'user', content: 'Synthetic request' }]
  await ModelRouterNode.execute({ messages }, {}, { modelId: 'fixture.adapter', role: 'persona' })
  assert.equal(calls[1].modelId, 'fixture.adapter')
  assert.deepEqual(calls[1].messages, messages)
})


test('task and conversation are separate model calls sharing selected evidence without repeated reads', async () => {
  const { result, reads } = await run('Repeat the movement and explain it',
    ['needsResponse', 'needsPersona', 'needsConversationHistory', 'needsMemory'], {
      response: 'The movement is selected.',
      program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
      taskDecision: { outcome: 'act', objective: 'Wave', reason: 'Requested movement', completionCriteria: 'Wave completes',
        continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
    })
  assert.deepEqual(calls.map(call => call.modelId), ['ollama.qwen3.5:0.8b', 'ollama.qwen3.5:0.8b', undefined])
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
  assert.equal('capabilities' in conversation.currentEnvironment, false)
  assert.equal(conversation.selectedTask.program.steps[0].action.command, 'wave')
  assert.deepEqual(conversation.selectedTask.commandDescriptions, { wave: 'Wave one front leg.' })
  assert.equal(conversation.selectedTask.actionAdmission.admitted, true)
  assert.equal(conversation.selectedTask.taskDecision.objectiveComplete, false)
  assert.equal(result.nodes.get('conversation-buffer')?.outputs?.response, 'The movement is selected.')
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
    for (const id of ['conversation-context', 'conversation-model', 'conversation-buffer', 'tts-out', '12']) {
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
