import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-expression-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Physical dispatch and network calls are forbidden in this fixture') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const submission = await import('../queue/work-submission.js')
mock.module(new URL('../queue/work-submission.js', import.meta.url).href, { namedExports: {
  ...submission, submitCoordinatorWork: async (input: any) => manager.enqueue(input),
} })
const { runDurableGraph, withGraphWork } = await import('../durable-execution/runtime.js')
const { getQueueManager } = await import('../queue/unified-queue-manager.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { writeEnvironmentBridgeState, subscribeEnvironmentActions, recordEnvironmentActionResult,
  readEnvironmentBridgeState } = await import('./store.js')
const { handleEnvironmentBridgeStatus } = await import('../api/handlers/environment-bridge.js')
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js')
const manager = getQueueManager()
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

test('Face Expression node delivers one display command and preserves recorded posture', async () => {
  const timestamp = new Date().toISOString()
  const pose = { version: 1, jointMapVersion: 1, kind: 'reference', reference: 'stand',
    sourceActionId: 'earlier-stand', updatedAt: timestamp }
  const library = [{ name: 'bow', label: 'Bow', group: 'Motion faces' }, { name: 'thinking', label: 'Thinking' }]
  writeEnvironmentBridgeState({ enabled: true, updatedAt: timestamp, feedback: [], sessions: {
    body: { sessionId: 'body', environmentId: 'fixture', adapter: 'ainekio-gateway', status: 'connected',
      firstSeenAt: timestamp, lastSeenAt: timestamp,
      latestObservation: { sessionId: 'body', environmentId: 'fixture', adapter: 'ainekio-gateway', timestamp,
        capabilities: { actions: ['faceExpression'], expressionLibrary: library },
        state: { body: { authenticated: true }, commandedPose: pose } } },
  } })
  const unsubscribe = subscribeEnvironmentActions('body', () => {})
  try {
    const graph = validateSvelteFlowGraph({ name: 'Display fixture', version: '1.0', format: 'svelte-flow',
      scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 0 },
      nodes: [{ id: 'face', type: 'environmentNode', position: { x: 0, y: 0 },
        data: { nodeType: 'environment_face_expression', properties: { expression: 'bow', sessionId: 'body' } } }], edges: [] })
    const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', username: 'fixture', source: 'user', input: {} })
    assert.ok(manager.claim(work.id))
    const result = await withGraphWork(work, id => manager.attachExecution(work.id, id),
      () => runDurableGraph({ graph, context: { username: 'fixture' } }), async input => manager.enqueue(input))
    manager.complete(work.id, true)
    assert.notEqual(result.status, 'failed', result.error?.stack)
    const output = result.nodes.get('face')!.outputs!
    assert.equal(output.success, true, output.message)
    const actions = manager.getAllTasks().filter(task => task.type === 'environment_command')
    assert.equal(actions.length, 1)
    const action = actions[0]!
    assert.equal(action.input.type, 'faceExpression')
    assert.equal(action.input.expression, 'bow')
    assert.equal(action.input.displayTimeoutMs, 60000)
    assert.match(String(action.input.displayToken), /^[a-f0-9]{32}$/)
    assert.equal(action.input.command, undefined)
    assert.equal(action.resource, 'environment-display:body')
    assert.ok(manager.claim(action.id))
    recordEnvironmentActionResult({ id: 'face-completed', actionId: String(action.input.id), timestamp,
      type: 'completed', message: 'Simulated face applied' })
    assert.deepEqual(readEnvironmentBridgeState().sessions.body.latestObservation?.state?.commandedPose, pose)
    const store = openExecutionStore('fixture')
    try {
      assert.equal(store.dispatches(result.executionId!).filter(effect => effect.actionId).length, 1)
    } finally { store.close() }
    const response = await handleEnvironmentBridgeStatus({ query: { view: 'expression-options' } } as any)
    assert.deepEqual((response.data as any).expressionLibrary, library)
  } finally { unsubscribe() }
})

function feedbackGraph(fail = false) {
  return validateSvelteFlowGraph({ name: fail ? 'Failed feedback fixture' : 'Feedback handoff fixture', version: '1.0', format: 'svelte-flow',
    scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 0 },
    nodes: [
      { id: 'input', type: 'inputNode', position: { x: 0, y: 0 }, data: { nodeType: 'user_input', properties: {} } },
      { id: 'thinking', type: 'environmentNode', position: { x: 1, y: 0 }, data: { nodeType: 'environment_expression_feedback', properties: { timeoutMs: 12345 } } },
      { id: 'on', type: 'environmentNode', position: { x: 2, y: 0 }, data: { nodeType: 'environment_face_expression', properties: { sessionId: 'body' } } },
      { id: 'off', type: 'environmentNode', position: { x: 3, y: 0 }, data: { nodeType: 'environment_face_expression', properties: { operation: 'release', sessionId: 'body' } } },
    ], edges: [
      { id: 'input-thinking', source: 'input', sourceHandle: 'message', target: 'thinking', targetHandle: 'control' },
      { id: 'thinking-control', source: 'thinking', sourceHandle: 'control', target: 'on', targetHandle: 'control' },
      { id: 'thinking-face', source: 'thinking', sourceHandle: 'feedback', target: 'on', targetHandle: 'feedback' },
      { id: 'on-off', source: 'on', sourceHandle: 'control', target: 'off', targetHandle: 'control' },
      ...(!fail ? [{ id: 'token', source: 'on', sourceHandle: 'token', target: 'off', targetHandle: 'token' }] : []),
    ] })
}

async function runFixture(graph: ReturnType<typeof feedbackGraph>) {
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', username: 'fixture', source: 'user', input: {} })
  assert.ok(manager.claim(work.id))
  try {
    return await withGraphWork(work, id => manager.attachExecution(work.id, id),
      () => runDurableGraph({ graph, context: { username: 'fixture', userMessage: 'Tell me what you see, then bow.', allowMemoryWrites: false } }),
      async input => manager.enqueue(input))
  } finally { manager.complete(work.id, true) }
}

test('Pass-through thinking, conditional release and replay preserve input and dispatch identity', async () => {
  const unsubscribe = subscribeEnvironmentActions('body', () => {})
  try {
    const graph = feedbackGraph()
    const result = await runFixture(graph)
    assert.notEqual(result.status, 'failed', result.error?.stack)
    assert.equal(result.nodes.get('on')!.outputs!.control, 'Tell me what you see, then bow.')
    const commands = manager.getAllTasks().filter(task => task.type === 'environment_command' && task.durable?.executionId === result.executionId)
    assert.equal(commands.length, 2)
    const on = commands.find(task => task.input.displayRelease === false)!
    const off = commands.find(task => task.input.displayRelease === true)!
    assert.equal(on.input.expression, 'thinking')
    assert.equal(on.input.displayTimeoutMs, 12345)
    assert.equal(on.input.displayBackground, true)
    assert.equal(off.input.displayToken, on.input.displayToken)
    assert.equal(off.input.expression, undefined)
    const replay = await runDurableGraph({ graph, executionId: result.executionId, context: { username: 'fixture' } })
    assert.notEqual(replay.status, 'failed', replay.error?.stack)
    assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command' && task.durable?.executionId === result.executionId).length, 2)
  } finally { unsubscribe() }
})

test('Graph failure admits a display-only conditional error through the same Coordinator', async () => {
  const unsubscribe = subscribeEnvironmentActions('body', () => {})
  try {
    const result = await runFixture(feedbackGraph(true))
    assert.equal(result.status, 'failed')
    assert.match(result.error!.message, /requires its token/)
    const on = result.nodes.get('on')!.outputs!
    const report = manager.getAllTasks().find(task => task.handler === 'environment.display-feedback' && task.input.feedback?.token === on.token)
    assert.ok(report)
    assert.equal(report.input.feedback.ifToken, on.token)
    assert.equal(report.input.feedback.expression, 'confused')
    assert.equal(report.input.feedback.timeoutMs, 5000)
    assert.equal(report.input.feedback.background, false)
    assert.equal(report.input.feedback.sessionId, 'body')
  } finally { unsubscribe() }
})

test('joined finite-work failures select the configured error face, including after receipt replay', async () => {
  const { workResultWaitNode } = await import('../nodes/utility/work-result-wait.node.js')
  const { environmentExpressionFeedbackNode } = await import('../nodes/environment/expression.node.js')
  for (const state of ['failed', 'expired', 'completed', 'cancelled']) {
    const event = { eventId: 'terminal', kind: 'work_result', payload: {
      effectId: 'conversation-work', result: { state, result: null,
        error: state === 'failed' ? { code: 'handler_failed', message: 'Backend disconnected' } : null },
    } }
    for (const replay of [false, true]) {
      const context = { graphExecution: { occurrenceId: 'display-occurrence',
        pendingEvents: () => replay ? [] : [event], events: () => [event], waitForEvent: () => event } } as any
      const joined = await workResultWaitNode.execute({ work: { effectId: 'conversation-work' } }, context, {})
      const result = await environmentExpressionFeedbackNode.execute({ token: 'current-turn', workResult: joined.result }, context,
        { ...environmentExpressionFeedbackNode.properties, operation: 'release', errorExpression: 'confused', errorTimeoutMs: 4321 })
      const failed = state === 'failed' || state === 'expired'
      assert.equal(result.feedback.operation, failed ? 'set' : 'release', `${state}, replay=${replay}`)
      assert.equal(result.token, 'current-turn')
      if (failed) {
        assert.equal(result.feedback.expression, 'confused')
        assert.equal(result.feedback.timeoutMs, 4321)
        assert.equal(result.feedback.ifToken, 'current-turn', 'An old failure cannot replace a newer turn face')
        assert.equal(result.feedback.background, false)
      }
    }
  }
})

test('The model contract exposes only advertised expressions and keeps display actions distinct from motion', async () => {
  const { buildEnvironmentSelectorJsonSchema, buildEnvironmentSelectorEnvelope } = await import('../nodes/environment/helpers.js')
  const { environmentActionParserNode } = await import('../nodes/environment/action-parser.node.js')
  const observation = readEnvironmentBridgeState().sessions.body.latestObservation!
  const schema = buildEnvironmentSelectorJsonSchema({ actions: ['faceExpression'], expressions: ['bow', 'thinking'] }) as any
  const activity = schema.anyOf.find((branch: any) => branch.properties.program.type === 'object')
  const action = activity.properties.program.properties.steps.items.anyOf[0].properties.action
  assert.deepEqual(action.required, ['type', 'expression'])
  assert.deepEqual(action.properties.expression.enum, ['bow', 'thinking'])
  assert.equal(action.properties.command, undefined)
  assert.equal(action.additionalProperties, false)
  const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ instruction: 'Show the bow face', observation }))
  assert.deepEqual(envelope.currentEnvironment.capabilities.expressionLibrary, observation.capabilities.expressionLibrary)
  assert.ok(envelope.capabilityRules.includes('faceExpression changes only the display to an expression from expressionLibrary; expression is the library identifier. It does not move the body.'))
  const selection = (expression: string) => JSON.stringify({ response: '', program: { steps: [{ kind: 'action', action: { type: 'faceExpression', expression } }] },
    taskDecision: { objective: 'Show the requested face', completionCriteria: 'Display command completes', outcome: 'act',
      reason: 'Requested expression', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' } })
  const accepted = await environmentActionParserNode.execute({ response: selection('bow'), observation, sessionId: 'body' }, {}, {})
  assert.equal(accepted.valid, true, accepted.error)
  assert.equal(accepted.program.steps[0].action.type, 'faceExpression')
  assert.equal(accepted.program.steps[0].action.expression, 'bow')
  const rejected = await environmentActionParserNode.execute({ response: selection('invented_face'), observation, sessionId: 'body' }, {}, {})
  assert.equal(rejected.valid, false)
  assert.equal(rejected.program, null)
  assert.match(rejected.error, /expression library/)
})
