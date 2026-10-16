import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'
import type { NodeExecutor } from '../types.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-autonomy-workflow-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network or robot dispatch in autonomy workflow tests') }
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const { executeGraph } = await import('../../graph-executor.js')
const { nodeRegistry, nodeExecutors } = await import('../index.js')
const { selectedEnvironmentRoutes } = await import('../environment/context-routing.js')
const { environmentContextBuilderNode } = await import('../environment/context-builder.node.js')
const { prepareConversationEntries } = await import('../output/conversation-buffer.node.js')
const { environmentConversationResultNode } = await import('../environment/conversation.node.js')
const graph = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/environment-mode.json', import.meta.url), 'utf8'))
const timestamp = '2026-10-08T18:00:00.000Z'
const plannerDecision = { observed: 'The body is idle.', instruction: 'Perform a bow.', reason: 'Selected by the controller.', decidedAt: timestamp }
const robotObserver = { cycleId: 'fixture-cycle', step: 1, triggerSource: 'autonomy', requestedBy: 'robot-autonomy-controller', graph: 'environment' }
const observation = { adapter: 'fixture', environmentId: 'fixture', sessionId: 'fixture-body', timestamp,
  capabilities: { actions: ['robotCommand'], robotCommands: ['bow'], robotCommandDescriptions: { bow: 'Lower the front end and return.' } },
  state: { body: { authenticated: true } }, feedback: [] }
const decision = { objective: 'Perform a bow.', completionCriteria: 'Bow receipt', outcome: 'act', reason: 'Selected motion.', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' }
const program = { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] }
after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

async function simulate(options: { action: boolean; response: boolean; failure?: boolean; interrupted?: boolean; visionPlanner?: boolean; human?: boolean }) {
  const order: string[] = []
  const instruction = options.human ? 'Please bow for me now.' : plannerDecision.instruction
  const source = options.human ? 'user' : 'autonomy'
  let taskContext: any
  let conversationContext: any
  let responseMetadata: any
  const receipt = { actionId: 'simulated-bow', type: options.failure ? 'failed' : 'completed', message: options.failure ? 'Motor reported failure' : 'Bow completed' }
  const overrides: Record<string, NodeExecutor> = {
    environment_bridge_input: async () => ({ observation, sessionId: observation.sessionId, isTriggeringObservation: true }),
    orchestrator_llm: async inputs => {
      order.push('intent')
      assert.equal(inputs.message, instruction)
      assert.equal(inputs.autonomy, !options.human)
      assert.equal(inputs.conversationHistory, undefined)
      const analysis = { needsAction: options.action, needsResponse: options.response,
        taskContext: ['robotStatus', 'environment', 'executionContext'], conversationContext: ['conversationHistory'] }
      return { ...selectedEnvironmentRoutes(analysis), analysis, useVisionPlanner: options.visionPlanner === true }
    },
    model_router: async (inputs, _context, properties) => {
      assert.equal(properties?.role, options.visionPlanner ? 'environmentVision' : 'environmentActionSelector')
      order.push('task')
      const taskProperties = graph.nodes.find((node: any) => node.id === '3').data.properties
      assert.ok(inputs.messages[0].content.includes(options.human ? taskProperties.systemPrompt : taskProperties.autonomySystemPrompt))
      taskContext = JSON.parse(inputs.messages[1].content)
      return { response: JSON.stringify({ taskDecision: options.action ? decision : null, program: options.action ? program : null }) }
    },
    conversation_history: async () => ({ history: [
      { role: 'user', content: 'Earlier human words.', timestamp },
      { role: 'system', content: 'A recorded dream.', timestamp, meta: { isInnerDialogue: true, originalRole: 'dream', dialogueSource: 'dreamer' } },
    ] }),
    robot_status: async () => ({ context: { updatedAt: timestamp, lastAction: null } }),
    robot_status_out: async inputs => {
      if (inputs.instruction) assert.equal(inputs.inputSource, source)
      return { persisted: true }
    },
    execution_context: async () => ({ context: { executionId: 'fixture', task: null, events: [] }, needsGoalReview: false, awaitContext: false }),
    observation_history: async () => ({ observations: [] }),
    environment_active_task: async inputs => {
      order.push('action')
      assert.equal(inputs.program.steps[0].action.command, 'bow')
      return { finished: !options.interrupted,
        result: { done: !options.interrupted, objectiveComplete: !options.failure, evidence: [receipt],
          failure: options.failure ? receipt.message : undefined, stepIndex: 1 },
        resultObservation: { ...observation, feedback: [receipt] } }
    },
    environment_conversation: async inputs => {
      order.push('conversation')
      const conversationProperties = graph.nodes.find((node: any) => node.id === 'conversation-context').data.properties
      assert.equal(inputs.messages[0].content, options.human ? conversationProperties.systemPrompt.trim() : conversationProperties.autonomySystemPrompt.trim())
      conversationContext = JSON.parse(inputs.messages[1].content)
      responseMetadata = inputs.metadata
      return { work: { effectId: 'simulated-conversation' } }
    },
    environment_conversation_delivery: async () => { order.push('delivery'); return { result: { done: true } } },
    environment_expression_feedback: async inputs => ({ control: inputs.control, token: 'simulated-display', feedback: {} }),
    environment_face_expression: async inputs => ({ control: inputs.control, status: 'simulated' }),
    execution_event_wait: async () => ({ invocation: null }),
  }
  const originals = new Map<string, NodeExecutor>()
  for (const [id, execute] of Object.entries(overrides)) {
    originals.set(id, nodeRegistry.get(id)!.execute)
    nodeRegistry.get(id)!.execute = execute
    nodeExecutors.set(id, execute)
  }
  try {
    const state = await executeGraph(graph, { currentTime: timestamp, cognitiveMode: 'environment', username: 'fixture', userMessage: options.human ? instruction : '',
      robotOperatorContext: { robotObserver, plannerDecision, memories: ['A delegated historical memory.'] } })
    assert.equal(state.status, 'completed', state.error?.stack)
    assert.equal(state.nodes.get(options.visionPlanner ? '4' : 'vision-planner')?.status, 'skipped')
    if (options.action) {
      assert.equal(taskContext.currentInstruction, instruction)
      assert.equal(taskContext.inputSource, source)
      if (options.human) {
        assert.equal(taskContext.plannerDecision, undefined)
        assert.equal(taskContext.delegatedMemories, undefined)
      } else {
        assert.deepEqual(taskContext.plannerDecision, plannerDecision)
        assert.deepEqual(taskContext.delegatedMemories, ['A delegated historical memory.'])
      }
      assert.equal(taskContext.currentEnvironment.capabilities.robotCommandCatalog.bow, 'Lower the front end and return.')
    } else assert.equal(taskContext, undefined, 'Conversation-only input must not invoke Task')
    if (options.response && !options.interrupted) {
      assert.equal(conversationContext.inputSource, source)
      assert.deepEqual(conversationContext.plannerDecision, options.human ? undefined : plannerDecision)
      assert.match(JSON.stringify(conversationContext), /A recorded dream/)
      assert.match(JSON.stringify(conversationContext), /dreamer/)
      assert.match(JSON.stringify(conversationContext), /2026-10-08T18:00:00/)
      assert.equal(responseMetadata.correlationId, options.human ? undefined : robotObserver.cycleId)
      if (options.action) {
        assert.ok(order.indexOf('action') < order.indexOf('conversation'))
        assert.deepEqual(conversationContext.taskResult.evidence, [receipt])
        assert.equal(conversationContext.taskResult.failure, options.failure ? receipt.message : undefined)
      }
    } else assert.equal(conversationContext, undefined)
    assert.equal(order.includes('action'), options.action)
    assert.equal(order.includes('conversation'), options.response && !options.interrupted)
    return order
  } finally {
    for (const [id, execute] of originals) { nodeRegistry.get(id)!.execute = execute; nodeExecutors.set(id, execute) }
  }
}

test('shared graph autonomy input routes a planner intention through task, simulated receipt and final conversation', async () => {
  assert.deepEqual(await simulate({ action: true, response: true }), ['intent', 'task', 'action', 'conversation', 'delivery'])
  await simulate({ action: true, response: true, failure: true })
  await simulate({ action: true, response: true, interrupted: true })
  await simulate({ action: false, response: true })
  await simulate({ action: true, response: false })
})

test('shared graph accepts a new human turn without inheriting autonomous authorship or speech provenance', async () => {
  assert.deepEqual(await simulate({ action: true, response: true, human: true }), ['intent', 'task', 'action', 'conversation', 'delivery'])
})

test('activation workflow reads current evidence and dispatches an independent intention without waiting', async () => {
  const controller = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/robot-autonomy-controller-mode.json', import.meta.url), 'utf8'))
  const { environmentImageInputNode } = await import('../environment/image-input.node.js')
  const selectImage = environmentImageInputNode.execute
  const frame = { id: 'controller-camera', timestamp, dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    metadata: { robotId: 'p4', gatewayInstance: 'gateway', epoch: 2, counter: 20 } }
  const intention = 'Visually track the ball while remaining stationary.'
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: 'full' }))
  fs.copyFileSync(new URL('../../../../../etc/agents.json', import.meta.url), path.join(root, 'etc/agents.json'))
  const order: string[] = []
  const requests: any[] = []
  const execution = { executionId: 'assessment-fixture', task: () => null,
    dispatch: (effect: any) => { order.push('delegate'); requests.push(effect.payload); return { effectId: 'simulated-admission' } } } as any
  const parse = nodeRegistry.get('robot_autonomy_controller_parser')!.execute
  const dispatch = nodeRegistry.get('active_operator_dispatch')!.execute
  const overrides: Record<string, NodeExecutor> = {
    robot_autonomy_controller_parser: (inputs, context, properties) => parse(inputs, { ...context, graphExecution: execution }, properties),
    active_operator_dispatch: (inputs, context, properties) => dispatch(inputs, { ...context, graphExecution: execution }, properties),
    environment_bridge_input: async () => ({ observation, sessionId: observation.sessionId, isTriggeringObservation: false }),
    environment_visual_read: async inputs => {
      assert.equal(inputs.sessionId, observation.sessionId)
      order.push('read')
      return { work: { effectId: 'camera-read' } }
    },
    environment_image_input: async inputs => {
      assert.equal(inputs.work?.effectId, 'camera-read', 'Controller must join its dispatched camera read')
      order.push('join')
      return selectImage({ visual: frame, observationCurrent: false }, {})
    },
    robot_autonomy_task_catalog: async () => ({ activationState: { mode: 'full', previous: null, assessedAt: timestamp, operations: [] }, tasks: [{ id: 'robot-autonomy-executor', name: 'Executor',
      description: 'Existing executor.', kind: 'environment-executor', handler: 'environment.observation', taskType: 'generic', priority: 'normal', tags: [] }] }),
    model_router: async inputs => {
      order.push('decide')
      const content = inputs.messages[1].content
      assert.equal(content[1].image_url.url, frame.dataUrl)
      assert.ok(content[0].text.includes(frame.id))
      assert.ok(content[0].text.includes('gateway'))
      return { response: JSON.stringify({ updates: [{ operationId: 'robot-autonomy-executor', activation: 46,
        reason: 'Fixture selection.', instruction: intention }] }) }
    },
    inner_dialogue_buffer: async inputs => { assert.equal(inputs.entries.length, 1); return { entries: inputs.entries } },
    inner_dialogue_saver: async inputs => { assert.equal(inputs.entries[0].meta.source, 'autonomy'); return { saved: true } },
    conversation_history: async () => ({ history: [] }),
    robot_status: async () => ({ context: {} }),
    robot_status_out: async () => ({ persisted: true, status: {} }),
    persona_loader: async () => ({ persona: {} }),
    persona_formatter: async () => ({ formatted: '' }),
    active_desires: async () => ({ desires: [] }),
    observation_history: async () => ({ observations: [] }),
    save_visual_observation: async () => ({ observation: null }),
    robot_autonomy_activity_history: async () => ({ history: [] }),
    execution_context: async () => ({ context: { task: null }, needsGoalReview: false, awaitContext: false }),
    execution_event_wait: async () => ({ invocation: null }),
    conversation_buffer: async () => ({ entries: [] }),
    memory_capture: async () => ({}),
    tts: async () => ({}),
  }
  const originals = new Map<string, NodeExecutor>()
  for (const [id, execute] of Object.entries(overrides)) {
    originals.set(id, nodeRegistry.get(id)!.execute)
    nodeRegistry.get(id)!.execute = execute
    nodeExecutors.set(id, execute)
  }
  try {
    const result = await executeGraph(controller, { username: 'fixture', currentTime: timestamp,
      robotOperatorContext: { robotObserver }, graphExecution: { executionId: 'assessment-fixture', task: () => null,
        dispatch: (effect: any) => { order.push('delegate'); requests.push(effect.payload); return { effectId: 'simulated-admission' } } } as any })
    assert.equal(result.status, 'completed', result.error?.stack)
    assert.deepEqual(order, ['read', 'join', 'decide', 'delegate'])
    assert.equal(requests.length, 1)
    assert.equal(requests[0].executionScope, 'independent')
    assert.equal(requests[0].handler, 'environment.observation')
    assert.equal(requests[0].input.robotOperatorContext.plannerDecision.instruction, intention)
    assert.equal(requests[0].input.robotOperatorContext.currentVisualEvidence, true)
    assert.deepEqual(requests[0].input.observation.visual, frame)
    assert.equal(requests[0].input.observationCurrent, false)
    assert.equal(controller.nodes.some((node: any) => ['workflow_call', 'work_result_wait', 'tts', 'conversation_buffer'].includes(node.data.nodeType)), false)
  } finally {
    for (const [id, execute] of originals) { nodeRegistry.get(id)!.execute = execute; nodeExecutors.set(id, execute) }
  }
})

test('human input keeps its speaker even when a planner decision is also present', async () => {
  const result = await environmentContextBuilderNode.execute({ userInstruction: 'My actual words.', plannerDecision,
    routingAnalysis: { needsResponse: true, needsAction: false, taskContext: [], conversationContext: [] } }, {}, { purpose: 'task' })
  assert.equal(result.selectedContext.currentInstruction, 'My actual words.')
  assert.equal(result.selectedContext.inputSource, 'user')
  assert.equal(result.selectedContext.plannerDecision, undefined)
})

test('autonomy response delivery retains origin without manufacturing a human message', async () => {
  const metadata = { correlationId: 'fixture-cycle', dialogueSource: 'robot-autonomy-controller', tags: ['autonomy-trigger'] }
  const response = await environmentConversationResultNode.execute({}, {
    environmentConversationResponse: 'Recorded response.', environmentConversationMetadata: metadata,
  }, {})
  const entries = prepareConversationEntries(response, { memoryTimestamp: Date.parse(timestamp) })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].role, 'assistant')
  assert.equal(entries[0].meta?.dialogueSource, metadata.dialogueSource)
  assert.equal(entries[0].meta?.correlationId, metadata.correlationId)
})

test('failed operator runtime remains visible and reports its cause', async () => {
  const { writeRobotOperatorRuntimeState, readRobotOperatorRuntimeState, loadRobotOperatorConfig, robotOperatorChildGraph } = await import('../../robot-operator.js')
  const config = loadRobotOperatorConfig()
  const ids = ['robot-autonomy-controller', 'robot-status', 'robot-goal-review', 'boredom-observer', 'boredom-movement', 'boredom-reflection'] as const
  const children = Object.fromEntries(ids.map(id => [id, { id, enabled: true, handler: `workflow.${id}`, graph: robotOperatorChildGraph(config, id) }])) as any
  writeRobotOperatorRuntimeState({ mode: 'full', lifecycle: 'failed', reason: 'Configured graph failed validation', children })
  assert.equal(readRobotOperatorRuntimeState()?.lifecycle, 'failed')
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: 'full' }))
  fs.copyFileSync(new URL('../../../../../etc/agents.json', import.meta.url), path.join(root, 'etc/agents.json'))
  const { ModeController } = await import('../../active-operator/mode-controller.js')
  const status = new ModeController().getStatus()
  assert.equal(status.health, 'degraded')
  assert.equal(status.healthMessage, 'Configured graph failed validation')
})

test('operator dashboard includes the controller and its correlated selected work', async () => {
  const { getQueueManager } = await import('../../queue/unified-queue-manager.js')
  const manager = getQueueManager()
  const controller = { id: 'controller', handler: 'workflow.robot-autonomy-controller', state: 'completed',
    source: 'autonomy', createdAt: timestamp, input: {}, correlationId: 'cycle' }
  const child = { id: 'selected', handler: 'agent.reflector', state: 'failed', source: 'autonomy',
    createdAt: timestamp, input: {}, correlationId: 'cycle', error: { message: 'Selected work failed' } }
  const current = mock.method(manager, 'getAllTasks', () => [])
  const history = mock.method(manager, 'getHistory', () => [controller, child] as any)
  try {
    const { handleGetActiveOperatorStatus } = await import('../../api/handlers/active-operator.js')
    const response = await handleGetActiveOperatorStatus()
    assert.equal(response.status, 200)
    const episodes = (response.data as any).robotOperator.episodes
    assert.equal(episodes.length, 1)
    assert.equal(episodes[0].child, 'robot-autonomy-controller')
    assert.equal(episodes[0].state, 'failed')
    assert.equal(episodes[0].outcome, 'Selected work failed')
  } finally { current.mock.restore(); history.mock.restore() }
})

for (const mode of ['reactive', 'semi', 'full']) {
  for (const outcome of ['complete', 'wait', 'request_user', 'abandon']) {
    test(`Goal Review confirms ${outcome} without generating another activity in ${mode} mode`, async () => {
      fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
      fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: mode }))
      const review = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/robot-goal-review-mode.json', import.meta.url), 'utf8'))
      const calls: string[] = []
      const overrides: Record<string, NodeExecutor> = {
        execution_event_wait: async () => { calls.push('wait'); return { invocation: null } },
        environment_bridge_input: async () => ({ observation, sessionId: observation.sessionId }),
        robot_status: async () => ({ context: {} }),
        conversation_history: async () => ({ history: [] }),
        persona_loader: async () => ({ persona: {} }),
        persona_formatter: async () => ({ formatted: '' }),
        active_desires: async () => ({ desires: [] }),
        observation_history: async () => ({ observations: [] }),
        save_visual_observation: async () => ({ observation: null }),
        robot_autonomy_activity_history: async () => ({ history: [] }),
        execution_context: async () => ({ context: { task: { objective: 'Original objective.' } }, needsGoalReview: false, awaitContext: false }),
        robot_goal_review_context: async () => ({ messages: [], frames: [] }),
        model_router: async () => ({ response: JSON.stringify({ outcome, objective: 'Reviewed objective.', completionCriteria: 'Recorded evidence establishes the outcome.',
          reason: 'Recorded model selection.', observationSummary: 'Recorded result.', completionEvidence: 'Recorded receipt.',
          requiredCompletionBasis: 'visual_observation' }) }),
        robot_status_out: async inputs => { calls.push('status'); return { persisted: true, status: inputs.taskDecision } },
        active_operator_dispatch: async () => { throw new Error('Review must not dispatch a new activity') },
        workflow_call: async () => { throw new Error('Goal Review cannot start another workflow') },
        conversation_buffer: async () => { throw new Error('Goal Review cannot publish conversation') },
        memory_capture: async () => { throw new Error('Goal Review cannot publish response memory') },
        tts: async () => { throw new Error('Goal Review cannot publish speech') },
        environment_expression_feedback: async inputs => ({ control: inputs.control, token: 'simulated-display', feedback: {} }),
        environment_face_expression: async inputs => ({ control: inputs.control, status: 'simulated' }),
      }
      const originals = new Map<string, NodeExecutor>()
      for (const [id, execute] of Object.entries(overrides)) {
        originals.set(id, nodeRegistry.get(id)!.execute)
        nodeRegistry.get(id)!.execute = execute
        nodeExecutors.set(id, execute)
      }
      try {
        const state = await executeGraph(review, { username: 'fixture', operatorMode: mode })
        assert.equal(state.status, 'completed', state.error?.stack)
        assert.equal(state.nodes.get('parser')?.status, 'completed')
        assert.deepEqual(calls, ['status'])
        const outputs = state.nodes.get('parser')!.outputs!
        assert.equal(outputs.assessment.outcome, outcome)
        assert.equal('invocation' in outputs, false)
        assert.equal('awaitContinuation' in outputs, false)
        assert.equal('response' in outputs, false)
      } finally {
        for (const [id, execute] of originals) { nodeRegistry.get(id)!.execute = execute; nodeExecutors.set(id, execute) }
      }
    })
  }
}

test('autonomous visual planning uses the selected vision role with the existing action and conversation owners', async () => {
  await simulate({ action: true, response: true, visionPlanner: true })
})

test('Observer capture replaces old trigger evidence through the actual handoff into both consumer contexts', async () => {
  const observer = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/boredom-observer-mode.json', import.meta.url), 'utf8'))
  const { environmentBridgeInputNode } = await import('../environment/bridge-input.node.js')
  const { environmentImageInputNode } = await import('../environment/image-input.node.js')
  const frame = { id: 'new-capture', timestamp: '2026-10-08T18:01:00.000Z', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
    metadata: { actionId: 'capture-1', robotId: 'p4', epoch: 2, counter: 22 } }
  const freshObservation = { ...observation, timestamp: frame.timestamp, visual: frame,
    feedback: [{ id: 'receipt', type: 'completed', actionId: 'capture-1', timestamp: frame.timestamp }] }
  const nodes = new Map(observer.nodes.map((node: any) => [node.id, node]))
  const results: Record<string, any> = { 'capture-result': { observation: freshObservation },
    'decision-parser': { decision: plannerDecision }, 'robot-operator-input': { robotObserver },
    execution: { context: { task: null } }, 'observation-status': { status: {} } }
  const calls: Record<string, any> = { 'captured-observation': environmentBridgeInputNode.execute,
    'image-input': environmentImageInputNode.execute,
    'environment-dispatch': nodeRegistry.get('robot_operator_environment_dispatch')!.execute }
  const context = { username: 'fixture', currentTime: frame.timestamp, environmentObservation: observation,
    environmentObservationCurrent: false, robotOperatorContext: { robotObserver } }
  for (const id of ['captured-observation', 'image-input', 'environment-dispatch']) {
    const inputs = Object.fromEntries(observer.edges.filter((edge: any) => edge.target === id)
      .map((edge: any) => [edge.targetHandle, results[edge.source]?.[edge.sourceHandle]]))
    results[id] = await calls[id](inputs, context, (nodes.get(id) as any).data.properties)
  }
  const handoff = results['environment-dispatch'].invocation.context
  assert.equal(handoff.environmentObservationCurrent, true)
  assert.equal(handoff.robotOperatorContext.currentVisualEvidence, true)
  assert.deepEqual(handoff.environmentObservation.visual, frame)
  assert.equal(handoff.environmentObservation.timestamp, frame.timestamp)
  const childObservation = await environmentBridgeInputNode.execute({}, handoff, {})
  const childImages = await environmentImageInputNode.execute({ visual: childObservation.visual,
    observationCurrent: childObservation.isTriggeringObservation }, {})
  assert.equal(childImages.current, true)
  for (const purpose of ['task', 'conversation']) {
    const result = await environmentContextBuilderNode.execute({ observation: childObservation.observation,
      sourceObservation: childObservation.observation, observationCurrent: childObservation.isTriggeringObservation,
      plannerDecision: handoff.robotOperatorContext.plannerDecision, robotObserver,
      images: childImages.images, frames: childImages.frames,
      routingAnalysis: { needsAction: true, needsResponse: true, taskContext: ['vision'], conversationContext: ['vision'] },
    }, { currentTime: frame.timestamp }, { purpose, systemPrompt: '' })
    assert.equal(result.selectedContext.inputSource, 'autonomy')
    assert.equal(result.selectedContext.evidenceAvailability.currentVision, true)
    assert.equal(result.selectedContext.currentEnvironment.visualFrames[0].id, frame.id)
    assert.equal(result.selectedContext.currentEnvironment.visualFrames[0].timestamp, frame.timestamp)
    assert.equal(result.messages[1].content[1].image_url.url, frame.dataUrl)
  }
})

test('input join preserves each source and producers replace inherited source-specific fields', async () => {
  const { environmentEventRequestNode, bodyEventDecisionNode } = await import('../environment/body-event.node.js')
  const { robotOperatorEnvironmentDispatchNode } = await import('./environment-dispatch.node.js')
  const event = { kind: 'fixture-body-event', timestamp }
  const oldEvent = { instruction: 'An earlier event intention', reason: 'Earlier evidence', event }
  const inputs = { plannerDecision, robotObserver, memories: ['Preserved planner memory'],
    sourceObservationAt: timestamp, responseMetadata: { source: 'autonomy', correlationId: robotObserver.cycleId } }
  const autonomous = await environmentEventRequestNode.execute(inputs, { bodyEventDecision: oldEvent }, {})
  assert.equal(autonomous.message, plannerDecision.instruction)
  assert.equal(autonomous.plannerDecision, plannerDecision)
  assert.equal(autonomous.autonomy, true)
  assert.equal(autonomous.sourceObservationAt, timestamp)
  const human = await environmentEventRequestNode.execute({ ...inputs, message: 'What did you dream about?' }, { bodyEventDecision: oldEvent }, {})
  assert.equal(human.message, 'What did you dream about?')
  assert.equal(human.plannerDecision, null)
  assert.equal(human.robotObserver, null)
  assert.deepEqual(human.memories, [])
  assert.deepEqual(human.responseMetadata, {})
  assert.equal(human.autonomy, false)
  const eventRequest = await bodyEventDecisionNode.execute({ response: JSON.stringify({ decision: 'delegate',
    instruction: 'Inspect this new event', reason: 'New event evidence' }) },
    { environmentObservation: { ...observation, state: { bodyEvent: event } }, robotOperatorContext: inputs }, {})
  assert.equal(Object.hasOwn(eventRequest.invocation.context, 'robotOperatorContext'), true)
  assert.equal(eventRequest.invocation.context.robotOperatorContext, undefined)
  const dispatch = await robotOperatorEnvironmentDispatchNode.execute({ decision: plannerDecision, observation, robotObserver },
    { username: 'fixture', bodyEventDecision: oldEvent }, { graph: 'environment' })
  assert.equal(dispatch.invocation.graph, 'environment')
  assert.equal(Object.hasOwn(dispatch.invocation.context, 'bodyEventDecision'), true)
  assert.equal(dispatch.invocation.context.bodyEventDecision, undefined)
})
