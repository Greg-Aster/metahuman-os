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
const graph = JSON.parse(fs.readFileSync(new URL('../../../../../etc/cognitive-graphs/boredom-autonomy-mode.json', import.meta.url), 'utf8'))
const timestamp = '2026-10-08T18:00:00.000Z'
const plannerDecision = { observed: 'The body is idle.', instruction: 'Perform a bow.', reason: 'Selected by the controller.', decidedAt: timestamp }
const robotObserver = { cycleId: 'fixture-cycle', step: 1, triggerSource: 'autonomy', requestedBy: 'robot-autonomy-controller', graph: 'boredom-autonomy' }
const observation = { adapter: 'fixture', environmentId: 'fixture', sessionId: 'fixture-body', timestamp,
  capabilities: { actions: ['robotCommand'], robotCommands: ['bow'], robotCommandDescriptions: { bow: 'Lower the front end and return.' } },
  state: { body: { authenticated: true } }, feedback: [] }
const decision = { objective: 'Perform a bow.', completionCriteria: 'Bow receipt', outcome: 'act', reason: 'Selected motion.', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' }
const program = { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'bow' } }] }
after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

async function simulate(options: { action: boolean; response: boolean; failure?: boolean; interrupted?: boolean }) {
  const order: string[] = []
  let taskContext: any
  let conversationContext: any
  let responseMetadata: any
  const receipt = { actionId: 'simulated-bow', type: options.failure ? 'failed' : 'completed', message: options.failure ? 'Motor reported failure' : 'Bow completed' }
  const overrides: Record<string, NodeExecutor> = {
    environment_bridge_input: async () => ({ observation, sessionId: observation.sessionId, isTriggeringObservation: true }),
    orchestrator_llm: async inputs => {
      order.push('intent')
      assert.equal(inputs.message, plannerDecision.instruction)
      assert.equal(inputs.conversationHistory, undefined)
      const analysis = { needsAction: options.action, needsResponse: options.response,
        taskContext: ['robotStatus', 'environment', 'executionContext'], conversationContext: ['conversationHistory'] }
      return { ...selectedEnvironmentRoutes(analysis), analysis }
    },
    model_router: async inputs => {
      order.push('task')
      taskContext = JSON.parse(inputs.messages[1].content)
      return { response: JSON.stringify({ taskDecision: options.action ? decision : null, program: options.action ? program : null }) }
    },
    conversation_history: async () => ({ history: [
      { role: 'user', content: 'Earlier human words.', timestamp },
      { role: 'system', content: 'A recorded dream.', timestamp, meta: { isInnerDialogue: true, originalRole: 'dream', dialogueSource: 'dreamer' } },
    ] }),
    robot_status: async () => ({ context: { updatedAt: timestamp, lastAction: null } }),
    robot_status_out: async inputs => {
      if (inputs.instruction) assert.equal(inputs.inputSource, 'autonomy')
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
      conversationContext = JSON.parse(inputs.messages[1].content)
      responseMetadata = inputs.metadata
      return { work: { effectId: 'simulated-conversation' } }
    },
    work_result_wait: async () => { order.push('delivery'); return { result: { done: true } } },
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
    const state = await executeGraph(graph, { currentTime: timestamp, cognitiveMode: 'environment', username: 'fixture',
      robotOperatorContext: { robotObserver, plannerDecision, memories: ['A delegated historical memory.'] } })
    assert.equal(state.status, 'completed', state.error?.stack)
    assert.equal(taskContext.currentInstruction, plannerDecision.instruction)
    assert.equal(taskContext.inputSource, 'autonomy')
    assert.deepEqual(taskContext.plannerDecision, plannerDecision)
    assert.deepEqual(taskContext.delegatedMemories, ['A delegated historical memory.'])
    assert.equal(taskContext.currentEnvironment.capabilities.robotCommandCatalog.bow, 'Lower the front end and return.')
    if (options.response && !options.interrupted) {
      assert.equal(conversationContext.inputSource, 'autonomy')
      assert.deepEqual(conversationContext.plannerDecision, plannerDecision)
      assert.match(JSON.stringify(conversationContext), /A recorded dream/)
      assert.match(JSON.stringify(conversationContext), /dreamer/)
      assert.match(JSON.stringify(conversationContext), /2026-10-08T18:00:00/)
      assert.equal(responseMetadata.correlationId, robotObserver.cycleId)
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

test('actual autonomy graph routes a planner intention through task, simulated receipt and final conversation', async () => {
  assert.deepEqual(await simulate({ action: true, response: true }), ['intent', 'task', 'action', 'conversation', 'delivery'])
  await simulate({ action: true, response: true, failure: true })
  await simulate({ action: true, response: true, interrupted: true })
  await simulate({ action: false, response: true })
  await simulate({ action: true, response: false })
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
