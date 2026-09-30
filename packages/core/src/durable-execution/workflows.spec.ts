import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { EnvironmentCommandWork, EnvironmentObservation } from '../environment-interface/types.js'
import { visualObservationSource } from '../visual-observation.js'

// Real saved graphs, node implementations, router, SQLite and Coordinator.
// Only the provider/voice transport is replaced; all runtime files are isolated.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const restartRequest = process.env.METAHUMAN_WORKFLOW_TEST_RESUME
  ? JSON.parse(fs.readFileSync(process.env.METAHUMAN_WORKFLOW_TEST_RESUME, 'utf8'))
  : null
const root: string = restartRequest?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-workflow-integration-'))
assert.equal(path.dirname(root), os.tmpdir())
assert.ok(path.basename(root).startsWith('metahuman-workflow-integration-'))
const marker = path.join(root, '.isolated-workflow-fixture')
if (restartRequest) assert.ok(fs.existsSync(marker), 'A restart may only open this test fixture')
else fs.writeFileSync(marker, '')
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the workflow fixture') }
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const replies: unknown[] = []
const calls: { provider: string; messages: any[]; options: any }[] = []
let configuredProvider = 'ollama'
let configuredModel = 'fixture-model'
const provider = await import('../providers/bridge.js')
mock.module(new URL('../providers/bridge.ts', import.meta.url).href, { namedExports: {
  ...provider,
  callProvider: async (provider: string, messages: any[], options: any) => {
    calls.push({ provider, messages: structuredClone(messages), options: structuredClone(options) })
    assert.equal(provider, configuredProvider, 'Every model role must use the configured provider')
    assert.equal(options.model, configuredModel, 'Every model role must use the configured model')
    assert.ok(replies.length, 'Every model call must have an explicit fixture reply')
    let reply = replies.shift()
    if (typeof reply === 'function') reply = await reply()
    if (reply instanceof Error) throw reply
    return { provider, model: options.model, content: typeof reply === 'string' ? reply : JSON.stringify(reply),
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } }
  },
} })
const voice = await import('../tts/robot-speech.js')
mock.module(new URL('../tts/robot-speech.ts', import.meta.url).href, { namedExports: {
  ...voice, getSpeechOutputSettings: () => ({ speechDisabled: true, outputTarget: 'local' }),
} })

const { getQueueManager } = await import('../queue/unified-queue-manager.js')
const manager = getQueueManager()
const { ExecutionEngine } = await import('../queue/execution-engine.js')
const engine = new ExecutionEngine({}, manager)
const { runDurableGraph, withGraphWork } = await import('./runtime.js')
const { runGraph } = await import('../graph-runtime.js')
const { deliverDurableWorkReceipt } = await import('./work-results.js')
const { openExecutionStore } = await import('./storage.js')
const { withUserContext } = await import('../context.js')
const { getProfilePaths } = await import('../path-builder.js')
const { recordEnvironmentObservation, subscribeEnvironmentActions, dispatchEnvironmentActions,
  recordEnvironmentActionResult, publishEnvironmentObservation, setEnvironmentBridgeEnabled } = await import('../environment-interface/store.js')
const { loadRobotStatus } = await import('../robot-status.js')
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js')
const { invalidateModelCache } = await import('../model-resolver.js')
const username = 'workflow-fixture'
const profile = getProfilePaths(username)
const { createDefaultPersonaFacetConfig } = await import('../persona-facets.js')
if (!restartRequest) {
  fs.mkdirSync(profile.etc, { recursive: true })
  fs.mkdirSync(profile.persona, { recursive: true })
  fs.writeFileSync(path.join(profile.persona, 'facets.json'), JSON.stringify(createDefaultPersonaFacetConfig()))
  fs.writeFileSync(path.join(profile.persona, 'core.json'), JSON.stringify({
    identity: { name: 'Fixture Robot', role: 'Companion' }, personality: { traits: ['curious'] },
    values: [], goals: [], preferences: {}, communication: {},
  }))
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.cpSync(path.join(repo, 'etc/cognitive-graphs'), path.join(root, 'etc/cognitive-graphs'), { recursive: true })
  fs.copyFileSync(path.join(repo, 'etc/agents.json'), path.join(root, 'etc/agents.json'))
  fs.copyFileSync(path.join(repo, 'etc/services.json'), path.join(root, 'etc/services.json'))
  fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: 'full' }))
  // Catalog discovery reads maintained executable paths; no worker is spawned.
  fs.mkdirSync(path.join(root, 'brain'), { recursive: true })
  fs.symlinkSync(path.join(repo, 'brain/agents'), path.join(root, 'brain/agents'), 'dir')
}
function configureProvider(provider = 'ollama', model = 'fixture-model') {
  configuredProvider = provider
  configuredModel = model
  const roles = { orchestrator: 'fixture', persona: 'fixture', environmentActionSelector: 'fixture' }
  fs.writeFileSync(path.join(profile.etc, 'models.json'), JSON.stringify({
    version: '1', description: 'Isolated provider selection', defaults: roles,
    cognitiveModeMappings: { environment: roles, agent: roles },
    roleHierarchy: { orchestrator: ['fixture'], persona: ['fixture'], environmentActionSelector: ['fixture'] },
    models: { fixture: { provider, model, adapters: [], roles: Object.keys(roles),
      capabilities: ['text', 'image'], description: 'Controlled transport', options: {} } },
  }))
  invalidateModelCache()
}
if (!restartRequest) configureProvider()
else invalidateModelCache()
after(() => fs.writeFileSync(path.join(root, 'model-call-evidence.json'), JSON.stringify(calls)))
const graph = (name: string) => validateSvelteFlowGraph(JSON.parse(fs.readFileSync(path.join(root, 'etc/cognitive-graphs', `${name}-mode.json`), 'utf8')))
const user = { username, userId: username, role: 'owner' as const }
async function run(params: Parameters<typeof runDurableGraph>[0]) {
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'user',
    username, maxAttempts: 1, input: { requestId: randomUUID() } })
  assert.ok(manager.claim(work.id))
  const result = await withGraphWork(work, id => manager.attachExecution(work.id, id),
    () => runDurableGraph(params), async input => manager.enqueue(input))
  manager.complete(work.id, result.status !== 'failed', { executionId: result.executionId, status: result.status })
  return result
}
async function signalExecution(executionId: string) {
  const store = openExecutionStore(username)
  let eventId: string
  try { eventId = `autonomy:${executionId}:${store.get(executionId).checkpointVersion}` } finally { store.close() }
  const work = manager.enqueue({ type: 'generic', handler: 'graph.signal', resource: 'io',
    source: 'autonomy', priority: 'background', username, cognitiveMode: 'environment',
    input: { executionId, eventId, agentId: 'robot-autonomy-controller' }, idempotencyKey: eventId, maxAttempts: 1 })
  assert.ok(manager.claim(work.id))
  // Exercise the registered finite-work handler without starting the engine's service loop.
  await (engine as unknown as { execute(task: typeof work): Promise<void> }).execute(work)
  assert.equal(manager.getTask(work.id)?.state, 'completed', manager.getTask(work.id)?.error?.message)
}
const routes = { needsResponse: true, needsConversationHistory: true, needsMemory: false,
  needsRobotStatus: true, needsEnvironment: true, needsVision: true, needsAction: true,
  executionDisposition: 'new', targetExecutionId: '' }
const objective = 'Locate the fixture target and report its location.'
const observation = {
  environmentId: 'fixture-room', adapter: 'ainekio-gateway', sessionId: 'fixture-body', timestamp: new Date().toISOString(),
  capabilities: { actions: ['captureImage', 'robotCommand', 'robotMotionPlan', 'sendText'], robotCommands: ['walk', 'stop'],
    robotCommandDescriptions: { walk: 'Walk forward', stop: 'Stop body movement' }, visual: true, movement: true },
  state: { body: { authenticated: true, cameraReady: true, motionAvailable: true } },
  visual: { id: 'fixture-before', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=', timestamp: new Date().toISOString() },
  metadata: {}, feedback: [],
} satisfies EnvironmentObservation
const context = (current: EnvironmentObservation = observation) => ({ username, userId: username, sessionId: current.sessionId, requestId: randomUUID(),
  userMessage: objective, cognitiveMode: 'environment' as const, environment: 'server', operatorMode: 'full',
  recordPersonaMemory: false, environmentObservation: current, environmentObservationCurrent: true })

function freshObservation(label: string): EnvironmentObservation {
  return { ...structuredClone(observation), sessionId: `fixture-${label}-${randomUUID()}`,
    timestamp: new Date().toISOString(), visual: { ...observation.visual, id: `${label}-before` } }
}

function controllerContext(current: EnvironmentObservation) {
  return { ...context(current), userMessage: '', robotOperatorContext: {
    robotObserver: { cycleId: randomUUID(), step: 1, triggerSource: 'autonomy',
      graph: 'robot-autonomy-controller', requestedBy: 'robot-autonomy-controller' },
    stimulusAgent: 'robot-autonomy-controller', sessionId: current.sessionId,
    sourceObservationAt: current.timestamp, currentVisualEvidence: true,
  } }
}

function controllerChoice(taskId: string) {
  return { response: '', taskId, reason: 'A new observation will help locate the fixture target.',
    observationSummary: 'The current floor area does not contain the fixture target.',
    instruction: objective }
}

function seedDaydreamMemories() {
  fs.mkdirSync(profile.episodic, { recursive: true })
  for (let index = 0; index < 3; index++) fs.writeFileSync(path.join(profile.episodic, `fixture-daydream-${index}.json`), JSON.stringify({
    id: `fixture-memory-${index}`, timestamp: new Date().toISOString(), type: 'observation',
    content: `The fixture companion observed a colored object numbered ${index} beside the window.`,
    tags: [], entities: [], metadata: {},
  }))
}

function presetChoice() {
  return { response: '', actions: [{ type: 'robotCommand', command: 'walk' }], movementRequest: null,
    taskDecision: { outcome: 'act', objective, completionCriteria: 'Identify the target in visual evidence and report its location.',
      reason: 'Inspect a different area.',
      requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded' } }
}

function completionReview() {
  return { response: '', taskDecision: { overallObjectiveState: 'achieved',
    reason: 'The fixture target is visible in the supplied result image.', requiredCompletionBasis: 'visual_observation',
    observationSummary: 'The fixture target is on the floor.', completionEvidence: 'The target in the after-action image.' } }
}

function incompleteActionReview() {
  return { response: '', taskDecision: { overallObjectiveState: 'not_achieved',
    reason: 'The movement finished, but the target is not identified yet.', requiredCompletionBasis: 'visual_observation',
    observationSummary: 'The visible floor area does not contain the target.', completionEvidence: '' } }
}

function goalReview(outcome: 'continue' | 'wait' | 'request_user') {
  return { response: '', outcome, reason: 'The current evidence does not yet establish the target location.',
    requiredCompletionBasis: 'visual_observation', observationSummary: 'The visible floor area does not contain the target.',
    taskId: outcome === 'continue' ? 'robot-autonomy-executor' : 'none', completionEvidence: '', instruction: outcome === 'continue' ? 'Inspect the adjacent area to locate the same fixture target.' : '' }
}

const adapterActions = new Map<string, EnvironmentCommandWork[]>()
function connectAdapter(sessionId: string) {
  assert.equal(adapterActions.has(sessionId), false, 'Each fixture body has one accepting adapter')
  const received: EnvironmentCommandWork[] = []
  adapterActions.set(sessionId, received)
  // Like the SSE adapter, claim at admission notification rather than after the
  // entire parent graph unwinds. Command deadlines still apply at this boundary.
  const dispatch = () => received.push(...dispatchEnvironmentActions(sessionId, 10))
  const unsubscribe = subscribeEnvironmentActions(sessionId, dispatch)
  dispatch()
  return () => {
    unsubscribe()
    adapterActions.delete(sessionId)
    assert.equal(received.length, 0, 'Every dispatched fixture command must be inspected')
  }
}

function takeAdapterActions(sessionId: string, limit = 10) {
  const received = adapterActions.get(sessionId)
  assert.ok(received, 'The fixture adapter must be connected before taking commands')
  return received.splice(0, limit)
}

function completeAction(current: EnvironmentObservation, expectedType: string, frameId: string) {
  const actions = takeAdapterActions(current.sessionId!, 10)
  assert.equal(actions.length, 1, 'Exactly one chosen physical effect should be dispatched')
  const action = actions[0]
  assert.equal(action.type, expectedType)
  const result = { id: randomUUID(), actionId: action.id, type: 'completed' as const,
    timestamp: new Date().toISOString(), message: 'Fixture effect completed' }
  recordEnvironmentActionResult({ ...result, id: randomUUID(), type: 'accepted' })
  recordEnvironmentActionResult(result)
  const after: EnvironmentObservation = { ...current, timestamp: new Date().toISOString(),
    metadata: { actionId: action.id }, feedback: [result],
    visual: { ...current.visual!, id: frameId, timestamp: new Date().toISOString(), metadata: { actionId: action.id } } }
  publishEnvironmentObservation(after, { username })
  return { action, after }
}

function assertParticipatingGraphs(executionId: string, names: string[]) {
  const store = openExecutionStore(username)
  try {
    const definitions = store.db.prepare('SELECT definition FROM execution_graphs WHERE execution_id = ?')
      .all(executionId) as { definition: string }[]
    const actual = new Set([store.get(executionId).definition.graphId,
      ...definitions.map(row => store.codec.decode(row.definition).graphId)])
    for (const name of names) assert.ok(actual.has(graph(name).name), `The actual ${name} graph must belong to the parent execution`)
    assert.equal(store.get(executionId)?.status, 'completed')
    assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
  } finally { store.close() }
}

// A separate process opens only the durable checkpoint and supplied new evidence;
// no graph object, node callback, model output or conversation cache crosses over.
if (restartRequest) {
  await withUserContext(user, async () => {
    replies.push(...restartRequest.replies)
    const result = await run({ graph: graph(restartRequest.graphName),
      context: { username, userId: username, environment: 'server', requestId: randomUUID() },
      executionId: restartRequest.executionId })
    fs.writeFileSync(restartRequest.output, JSON.stringify({ status: result.status,
      error: result.error?.message, executionId: result.executionId, calls,
      physicalJobs: manager.getAllTasks().filter(task => task.type === 'environment_command').length,
      remainingReplies: replies.length }))
  })
  process.exit(0)
}

test('saved Environment workflow keeps conversation separate and resumes physical results in the same execution', async () => {
  await withUserContext(user, async () => {
    recordEnvironmentObservation(observation)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(observation.sessionId)
    try {
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
        { response: 'I am here with you.', actions: [], movementRequest: null, taskDecision: null })
      const conversational = await run({ graph: graph('environment'), context: { ...context(), userMessage: 'How are you?' } })
      assert.equal(conversational.status, 'completed', conversational.error?.stack)
      assert.equal(conversational.nodes.get('action-results')?.status, 'skipped')
      assert.equal(conversational.nodes.get('save-observation')?.status, 'skipped')
      assert.equal(conversational.nodes.get('observation-history')?.status, 'skipped')
      assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command').length, 0)
      assert.equal(calls.length, 2)
      assert.equal(calls[0].provider, 'ollama')
      assert.equal(calls[0].options.model, 'fixture-model')
      assert.equal(conversational.nodes.get('robot-status-out')?.outputs?.task, null)

      replies.push(routes, { response: 'I will look in the adjacent area.',
        visualObservation: { summary: 'The floor is visible.', frameIds: ['fixture-before'], uncertainties: [] },
        actions: [{ type: 'robotCommand', command: 'walk' }], movementRequest: null,
        taskDecision: { outcome: 'act', objective, reason: 'Inspect a different area.',
          completionCriteria: 'Identify the target in visual evidence and report its location.',
          requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded', visualEvidenceMode: 'comparison' } })
      const started = await run({ graph: graph('environment'), context: context() })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      assert.deepEqual(calls.at(-1)!.options.jsonSchema.anyOf[0].properties.taskDecision.anyOf.map((branch: any) => branch.type),
        ['null', 'object'], 'The selector can define an objective without permission from the routing model')
      let store = openExecutionStore(username)
      assert.equal(store.task(executionId)?.objective, objective)
      assert.match(store.task(executionId)!.objectiveId, /^[a-f0-9-]{36}$/)
      store.close()
      const [action] = takeAdapterActions(observation.sessionId, 1)
      assert.ok(action)
      assert.notEqual(action.id, action.workItemId)
      const result = { id: randomUUID(), actionId: action.id, type: 'completed' as const,
        timestamp: new Date().toISOString(), message: 'Fixture movement finished' }
      recordEnvironmentActionResult({ ...result, id: randomUUID(), type: 'accepted' })
      recordEnvironmentActionResult(result)
      const after = { ...observation, timestamp: new Date().toISOString(), metadata: { actionId: action.id }, feedback: [result],
        visual: { ...observation.visual, id: 'fixture-after', metadata: { actionId: action.id } } }
      publishEnvironmentObservation(after, { username })
      const beforeResumeCalls = calls.length
      replies.push({ response: '', visualObservation: {
        summary: 'A small target is visible near the furniture.', frameIds: ['fixture-before', 'fixture-after'],
        changes: 'The new view reveals an object absent from the earlier view.', uncertainties: ['The object identity is uncertain.'],
      }, taskDecision: { overallObjectiveState: 'not_achieved',
        reason: 'The move completed; the search still needs review.', requiredCompletionBasis: 'visual_observation',
        observationSummary: 'A new part of the floor is visible.', completionEvidence: '' } },
        { response: 'The target is on the floor.', outcome: 'complete',
          reason: 'The supplied after-action image contains the fixture target.', requiredCompletionBasis: 'visual_observation',
          observationSummary: 'The target is visible.', completionEvidence: 'The target in fixture-after.', taskId: 'none', instruction: '' })
      const resumed = await run({ graph: graph('environment'), context: context(), executionId })
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
      assert.equal(calls.length, beforeResumeCalls + 2, 'Only action-result and goal-review inference should run after resumption')
      const resultImages = calls[beforeResumeCalls].messages.flatMap(message => Array.isArray(message.content)
        ? message.content.filter((part: any) => part.type === 'image_url') : [])
      assert.equal(resultImages.length, 2, 'Comparison review receives both original images in one existing model call')
      store = openExecutionStore(username)
      assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
      assert.equal(store.task(executionId)?.objective, objective)
      assert.equal(store.frame(executionId, 'fixture-before')?.id, 'fixture-before')
      assert.equal(store.frame(executionId, 'fixture-after')?.id, 'fixture-after')
      const visualHistory = store.observationHistory(executionId, { ...visualObservationSource(observation), limit: 5 })
      assert.equal(visualHistory.length, 2)
      assert.deepEqual(visualHistory[1].frameIds, ['fixture-before', 'fixture-after'])
      assert.deepEqual(visualHistory[1].frames.map(frame => frame.timestamp), [observation.visual.timestamp, after.visual.timestamp])
      assert.equal(loadRobotStatus(username)?.latestVisualObservation?.observationId, visualHistory[1].observationId)
      assert.equal(loadRobotStatus(username)?.task?.executionId, executionId)
      assert.equal(loadRobotStatus(username)?.task?.decision.objectiveComplete, true)
      assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command').length, 0)
      store.close()
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('an equivalent editor save resumes the saved Environment result without replaying its action', async () => {
  await withUserContext(user, async () => {
    const { loadGraphForMode, clearGraphCache } = await import('../graph-streaming.js')
    const { executionDefinition, resolveExecutionGraph } = await import('./graph-contract.js')
    const { getNode, materializeNodeProperties } = await import('../nodes/index.js')
    const loaded = await loadGraphForMode('environment', username)
    const original = fs.readFileSync(loaded.source, 'utf8')
    const edited = structuredClone(loaded.graph)
    edited.description = 'Rearranged in the visual editor'
    edited.last_modified = new Date().toISOString()
    for (const node of edited.nodes) {
      const definition = getNode(node.data.nodeType)!
      node.position = { x: node.position.x + 300, y: node.position.y + 200 }
      node.type = 'expandedNode'
      node.width = 360
      node.height = 200
      node.data.label = `Display: ${node.data.label}`
      node.data.comment = 'An editor annotation, not an instruction'
      node.data.properties = materializeNodeProperties(definition, node.data.properties)
      node.data.muted = node.data.muted ?? false
      node.data.activation = { mode: definition.execution.activation,
        requiredInputs: definition.execution.requiredInputs, ...node.data.activation }
    }
    for (const edge of edited.edges) {
      Object.assign(edge, { type: 'flowEdge', animated: true })
      edge.data = { kind: 'data', loop: false, ...edge.data, comment: 'Display annotation' }
    }
    Object.assign(edited, { viewport: { x: 100, y: 200, zoom: 0.75 } })
    const definition = executionDefinition(loaded.graph)
    assert.deepEqual(executionDefinition(edited), definition,
      'Layout and materialized defaults must have the same executable identity')
    const current = freshObservation('editor-save')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: loaded.graph, context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', 'editor-save-after')
      const store = openExecutionStore(username)
      try {
        const objectiveId = store.task(executionId)!.objectiveId
        fs.writeFileSync(loaded.source, JSON.stringify(edited))
        assert.deepEqual(resolveExecutionGraph(store, executionId).definition, definition)
        // Executable changes still cannot reuse this checkpoint.
        for (const change of ['property', 'activation', 'edge', 'scheduler', 'output', 'muted']) {
          const changed = structuredClone(edited)
          if (change === 'property') changed.nodes.find(node => node.id === '4')!.data.properties.maxTokens++
          if (change === 'activation') changed.nodes[0].data.activation!.when = [{ nodeId: '4', output: 'response', truthy: true }]
          if (change === 'edge') changed.edges.find(edge => edge.data?.kind !== 'control')!.data!.kind = 'control'
          if (change === 'scheduler') changed.scheduler.maxLoopIterations++
          if (change === 'output') changed.nodes[0].data.schema = { isOutputNode: true }
          if (change === 'muted') changed.nodes[0].data.muted = true
          assert.throws(() => store.assertDefinition(executionId, executionDefinition(changed)), /does not match/, change)
        }
        const beforeResumeCalls = calls.length
        replies.push(completionReview())
        const resumed = await run({ graph: edited, context: context(current), executionId })
        assert.equal(resumed.status, 'completed', resumed.error?.stack)
        assert.equal(calls.length, beforeResumeCalls + 1, 'Only the action-result review runs after resumption')
        assert.equal(store.task(executionId)?.objectiveId, objectiveId)
        assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
        assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0, 'The earlier action is not replayed')
        assert.equal(replies.length, 0)
      } finally { store.close() }
    } finally { fs.writeFileSync(loaded.source, original); clearGraphCache(); unsubscribe() }
  })
})

test('a speech-only objective remains authoritative until a later user turn concludes it', async () => {
  await withUserContext(user, async () => {
    const current: EnvironmentObservation = { ...freshObservation('interaction-objective'), visual: undefined }
    recordEnvironmentObservation(current)
    const request = 'Keep an ongoing conversation with me.'
    const criteria = 'The participant concludes the conversation.'
    const chatRoutes = { ...routes, needsEnvironment: false, needsVision: false, needsAction: false }
    const beforeCalls = calls.length
    const beforeActions = manager.getAllTasks().filter(task => task.type === 'environment_command').length
    replies.push(chatRoutes, {
      taskDecision: { objective: request, completionCriteria: criteria, outcome: 'continue',
        reason: 'The interaction has begun, not ended.', continuationPolicy: 'none', requiredCompletionBasis: 'user_input' },
      response: 'What would you like to talk about?', actions: [], movementRequest: null,
    }, { ...goalReview('wait'), reason: 'The participant has not concluded the interaction.',
      requiredCompletionBasis: 'user_input', observationSummary: 'The interaction is ongoing.' })
    const started = await run({ graph: graph('environment'), context: { ...context(current), userMessage: request } })
    assert.equal(started.status, 'waiting', started.error?.stack)
    const executionId = started.executionId!
    assert.equal(calls.length, beforeCalls + 3, 'The existing selector and reviewer own this objective; no extra decision call')
    assert.equal(started.nodes.get('action-results')?.status, 'skipped')
    assert.equal(started.nodes.get('11')?.status, 'skipped', 'A conversational objective does not select vision')
    let store = openExecutionStore(username)
    let objectiveId: string
    try {
      const task = store.task(executionId)!
      objectiveId = task.objectiveId
      assert.equal(task.completionCriteria, criteria)
      assert.equal(task.decision.objectiveComplete, false)
      assert.equal(loadRobotStatus(username)?.situation.currentGoal, request)
    } finally { store.close() }
    const conclusion = 'That concludes our conversation, thank you.'
    replies.push({ ...chatRoutes, executionDisposition: 'steer', targetExecutionId: executionId })
    const admitted = await run({ graph: graph('environment'), context: { ...context(current), userMessage: conclusion } })
    assert.equal(admitted.status, 'completed', admitted.error?.stack)
    replies.push(chatRoutes, { taskDecision: { objective: request, completionCriteria: criteria,
      outcome: 'complete', reason: 'The participant concluded the interaction.', continuationPolicy: 'none',
      requiredCompletionBasis: 'user_input', completionEvidence: conclusion },
      response: 'Thank you for the conversation.', actions: [], movementRequest: null })
    const finished = await run({ graph: graph('environment'), context: context(current), executionId })
    assert.equal(finished.status, 'completed', finished.error?.stack)
    store = openExecutionStore(username)
    try {
      assert.equal(store.task(executionId)?.objectiveId, objectiveId)
      assert.equal(store.task(executionId)?.completionCriteria, criteria)
      assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
      assert.equal(loadRobotStatus(username)?.situation.currentGoal, '')
    } finally { store.close() }
    assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command').length, beforeActions)
    assert.equal(replies.length, 0)
  })
})

test('saved Controller calls the real Executor and resumes its preset action under the same parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('controller-preset')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const beforeCalls = calls.length
      replies.push(controllerChoice('robot-autonomy-executor'), routes, presetChoice())
      const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      assert.equal(calls.length, beforeCalls + 3, 'Controller, route selection and preset selection each run once')
      const executionId = started.executionId!
      const { action, after } = completeAction(current, 'robotCommand', 'controller-preset-after')
      assert.equal(action.command, 'walk')
      assert.equal(action.executionId, executionId)
      replies.push(completionReview())
      const resumed = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(after), executionId })
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
      assert.equal(calls.length, beforeCalls + 4, 'Resuming the parent must not rerun Controller, route selection or the completed action')
      assertParticipatingGraphs(executionId, ['robot-autonomy-controller', 'boredom-autonomy', 'robot-action-result'])
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Controller selects Observer, waits for its image, then calls Executor without losing the parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('controller-observer')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const beforeCalls = calls.length
      replies.push(controllerChoice('boredom-observer'))
      const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      assert.equal(calls.length, beforeCalls + 1, 'Observer interpretation waits for the requested image')
      const executionId = started.executionId!
      const captured = completeAction(current, 'captureImage', 'controller-observer-captured')
      assert.equal(captured.action.executionId, executionId)
      replies.push({ observed: 'The new camera frame shows open floor.', instruction: objective,
        reason: 'Inspect another area to locate the target.' }, routes, presetChoice())
      const moving = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(captured.after), executionId })
      assert.equal(moving.status, 'waiting', moving.error?.stack)
      assert.equal(calls.length, beforeCalls + 4, 'Only Observer interpretation and its real Executor child should run')
      const moved = completeAction(captured.after, 'robotCommand', 'controller-observer-after')
      assert.equal(moved.action.command, 'walk')
      assert.equal(moved.action.executionId, executionId)
      assert.notEqual(moved.action.id, captured.action.id)
      replies.push(completionReview())
      const finished = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(moved.after), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(calls.length, beforeCalls + 5)
      assertParticipatingGraphs(executionId, ['robot-autonomy-controller', 'boredom-observer', 'boredom-autonomy', 'robot-action-result'])
      const store = openExecutionStore(username)
      try {
        assert.equal(store.frame(executionId, 'controller-observer-captured')?.id, 'controller-observer-captured')
        assert.equal(store.frame(executionId, 'controller-observer-after')?.id, 'controller-observer-after')
      } finally { store.close() }
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Environment invokes freestyle only when selected and persists the generated motion across the result wait', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('freestyle')
    current.state = { ...current.state, commandedPose: { version: 1, jointMapVersion: 1, kind: 'reference',
      reference: 'stand', sourceActionId: 'fixture-standing-receipt', updatedAt: new Date().toISOString() } }
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const beforeCalls = calls.length
      const standing = { R1: '135', R2: '45', L1: '45', L2: '135', R4: '0', R3: '180', L3: '0', L4: '180' }
      const generated = { summary: 'Lift and lower a front limb.',
        frames: [{ durationMs: '600', ...standing, R3: '160' }, { durationMs: '600', ...standing }], endPose: 'stand' }
      replies.push(routes, { response: '', actions: [], movementRequest: { description: 'Lift and lower a front limb.' },
        taskDecision: { outcome: 'act', objective: 'Lift and lower a front limb.',
          completionCriteria: 'The requested limb lift and return have completed.',
          reason: 'Generate the requested limb movement.', requiredCompletionBasis: 'action_result',
          continuationPolicy: 'bounded', motionClass: 'body_local' } }, generated)
      const started = await run({ graph: graph('environment'), context: { ...context(current), userMessage: 'Lift and lower a front limb.' } })
      assert.equal(started.status, 'waiting', started.error?.stack)
      assert.equal(started.nodes.get('movement-generator')?.status, 'completed')
      assert.equal(calls.length, beforeCalls + 3, 'The dedicated generator adds one model call only on the freestyle branch')
      assert.equal(calls.at(-1)?.options.maxTokens, graph('environment').nodes.find(node => node.id === 'movement-generator')?.data.properties?.maxTokens)
      const executionId = started.executionId!
      const { action, after } = completeAction(current, 'robotMotionPlan', 'freestyle-after')
      assert.equal(action.executionId, executionId)
      assert.equal(action.endPose, 'stand')
      assert.equal(action.frames?.length, 2)
      assert.equal(action.frames?.[0].targets.find(target => target.joint === 'R3')?.degrees, 160)
      replies.push({ response: '', taskDecision: { overallObjectiveState: 'achieved',
        reason: 'The generated motion completed.', requiredCompletionBasis: 'action_result',
        observationSummary: 'The body reported completion.', completionEvidence: action.id } })
      const finished = await run({ graph: graph('environment'), context: context(after), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(calls.length, beforeCalls + 4, 'The generated action and its model output are not replayed on resume')
      assertParticipatingGraphs(executionId, ['environment', 'robot-action-result'])
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved workflow exposes a current model-router provider error without dispatch or fabricated success', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('provider-error')
    recordEnvironmentObservation(current)
    const failure = new Error('Controlled action-selector transport failure')
    const beforeCalls = calls.length
    replies.push(routes, failure)
    const result = await run({ graph: graph('environment'), context: context(current) })
    assert.equal(result.status, 'failed')
    assert.match(result.error?.message ?? '', /Controlled action-selector transport failure/)
    assert.equal(result.nodes.get('4')?.status, 'failed')
    const store = openExecutionStore(username)
    try { assert.equal(store.get(result.executionId!).status, 'failed', 'An exhausted work item must not leave its execution waiting for a retry') }
    finally { store.close() }
    assert.equal(calls.length, beforeCalls + 2)
    assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
    assert.equal(replies.length, 0)
  })
})

test('a retryable saved workflow resumes the failed model node through the Coordinator attempt contract', async () => {
  await withUserContext(user, async () => {
    const workflow = graph('environment')
    const beforeCalls = calls.length
    const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'user', username,
      maxAttempts: 2, input: { requestId: randomUUID() } })
    const invoke = () => withGraphWork(work, id => manager.attachExecution(work.id, id),
      () => runDurableGraph({ graph: workflow, context: { ...context(), userMessage: 'How are you?' } }),
      async input => manager.enqueue(input))
    assert.ok(manager.claim(work.id))
    replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
      new Error('Temporary controlled transport failure'))
    const first = await invoke()
    assert.equal(first.status, 'failed')
    assert.equal(first.nodes.get('intent-orchestrator')?.status, 'completed')
    assert.equal(first.nodes.get('4')?.status, 'failed')
    let store = openExecutionStore(username)
    try {
      assert.equal(store.get(first.executionId!).status, 'waiting')
      assert.equal(store.get(first.executionId!).waitingReason, 'attempt_failed')
    } finally { store.close() }
    assert.equal(manager.requeue(work, { code: 'fixture_transport', message: 'Temporary controlled transport failure', retryable: true }), true)
    assert.equal(work.attempt, 1)
    assert.ok(manager.claim(work.id))
    replies.push({ response: 'I am here with you.', actions: [], movementRequest: null, taskDecision: null })
    const retried = await invoke()
    manager.complete(work.id, retried.status === 'completed', { executionId: retried.executionId })
    assert.equal(retried.status, 'completed', retried.error?.stack)
    assert.equal(retried.executionId, first.executionId)
    assert.equal(calls.length, beforeCalls + 3, 'A successful intent decision must not rerun when only its model consumer failed')
    store = openExecutionStore(username)
    try { assert.equal(store.get(first.executionId!).status, 'completed') } finally { store.close() }
    assert.equal(replies.length, 0)
  })
})

test('saved Environment retains an after-action observation that arrives before terminal feedback', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('image-before-result')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const beforeCalls = calls.length
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const [action] = takeAdapterActions(current.sessionId!, 1)
      assert.ok(action)
      recordEnvironmentActionResult({ id: randomUUID(), actionId: action.id, type: 'accepted',
        timestamp: new Date().toISOString(), message: 'Fixture adapter accepted the movement' })
      const after: EnvironmentObservation = { ...current, timestamp: new Date().toISOString(), feedback: [],
        metadata: { actionId: action.id }, visual: { ...current.visual!, id: 'image-before-result-after',
          timestamp: new Date().toISOString(), metadata: { actionId: action.id } } }
      publishEnvironmentObservation(after, { username })
      const imageOnly = await run({ graph: graph('environment'), context: context(after), executionId })
      assert.equal(imageOnly.status, 'waiting', imageOnly.error?.stack)
      assert.equal(calls.length, beforeCalls + 2, 'An image alone does not imply that the physical action completed')
      recordEnvironmentActionResult({ id: randomUUID(), actionId: action.id, type: 'completed',
        timestamp: new Date().toISOString(), message: 'Fixture movement finished after image publication' })
      replies.push(completionReview())
      const finished = await run({ graph: graph('environment'), context: context(after), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(calls.length, beforeCalls + 3)
      const store = openExecutionStore(username)
      try {
        const events = store.events(executionId)
        const observed = events.find(event => event.kind === 'observation_received' && event.actionId === action.id)
        const result = events.find(event => event.kind === 'physical_result' && event.actionId === action.id)
        assert.ok(observed && result && observed.sequence < result.sequence)
        assert.equal(store.frame(executionId, 'image-before-result-after')?.id, 'image-before-result-after')
        assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
      } finally { store.close() }
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Environment reviews standalone actions without inventing an objective or requiring an image for rejection', async () => {
  await withUserContext(user, async () => {
    for (const outcome of ['rejected', 'completed'] as const) {
      const current = freshObservation(`standalone-${outcome}`)
      recordEnvironmentObservation(current)
      setEnvironmentBridgeEnabled(true)
      const unsubscribe = connectAdapter(current.sessionId!)
      try {
        const beforeCalls = calls.length
        const instruction = 'Change the viewpoint and describe the newly visible area.'
        replies.push(routes, { ...presetChoice(), taskDecision: null })
        const started = await run({ graph: graph('environment'), context: { ...context(current), userMessage: instruction } })
        assert.equal(started.status, 'waiting', started.error?.stack)
        const executionId = started.executionId!
        const [action] = takeAdapterActions(current.sessionId!, 1)
        assert.ok(action)
        const frameId = randomUUID()
        const returnedVisual = { ...current.visual!, id: frameId, metadata: { actionId: action.id },
          dataUrl: 'data:image/jpeg;base64,/9j/2gAB/9k=' }
        assert.notEqual(returnedVisual.dataUrl, current.visual!.dataUrl)
        const feedback = { id: randomUUID(), actionId: action.id, type: outcome,
          timestamp: new Date().toISOString(), message: `The fixture adapter reported ${outcome}` }
        if (outcome === 'completed') recordEnvironmentActionResult({ ...feedback, id: randomUUID(), type: 'accepted' })
        recordEnvironmentActionResult(feedback)
        if (outcome === 'completed') publishEnvironmentObservation({ ...current,
          timestamp: new Date().toISOString(), metadata: { actionId: action.id }, feedback: [feedback],
          visual: returnedVisual }, { username })
        replies.push({ response: 'The action report has arrived.', taskDecision: null })
        const finished = await run({ graph: graph('environment'), context: context(current), executionId })
        assert.equal(finished.status, 'completed', finished.error?.stack)
        assert.equal(calls.length, beforeCalls + 3, 'Only one action-result review is needed for a standalone action')
        const reviewCall = calls.at(-1)!
        assert.deepEqual(reviewCall.options.jsonSchema.properties.taskDecision, { type: 'null' })
        const reviewInput = reviewCall.messages.at(-1).content
        const reviewText = typeof reviewInput === 'string' ? reviewInput : reviewInput.find((part: any) => part.type === 'text').text
        const envelope = JSON.parse(reviewText.slice(reviewText.indexOf('{')))
        assert.equal(envelope.robotStimulus.verifiedCurrentAction.actionId, action.id)
        assert.equal(envelope.robotStimulus.verifiedCurrentAction.originatingInstruction, instruction,
          'The whole request, including its observation purpose, survives dispatch and resume without requiring a goal')
        assert.equal(envelope.execution.task, null)
        if (outcome === 'completed') {
          assert.equal(envelope.robotStimulus.visualEvidence.frames[0].id, frameId)
          assert.ok(reviewInput.some((part: any) => part.type === 'image_url' && part.image_url.url === returnedVisual.dataUrl))
          assert.equal(reviewInput.some((part: any) => part.type === 'image_url' && part.image_url.url === current.visual!.dataUrl), false)
        }
        assert.equal(envelope.robotStimulus.feedback[0].type, outcome)
        const store = openExecutionStore(username)
        try {
          assert.equal(store.task(executionId), null, 'A standalone action must not create a goal')
          assert.equal(store.events(executionId).some(event => event.kind === 'observation_received'), outcome === 'completed')
        } finally { store.close() }
        assert.equal(loadRobotStatus(username)?.lastAction?.status, outcome)
        assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
        assert.equal(replies.length, 0)
      } finally { unsubscribe() }
    }
  })
})

test('the same saved workflow follows a different profile-configured provider through the current model router', async () => {
  await withUserContext(user, async () => {
    const beforeCalls = calls.length
    configureProvider('openai', 'fixture-alternate-model')
    try {
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
        { response: 'I am here with you.', actions: [], movementRequest: null, taskDecision: null })
      const result = await run({ graph: graph('environment'), context: { ...context(), userMessage: 'How are you?' } })
      assert.equal(result.status, 'completed', result.error?.stack)
      assert.equal(calls.length, beforeCalls + 2)
      assert.ok(calls.slice(beforeCalls).every(call => call.provider === 'openai' && call.options.model === 'fixture-alternate-model'))
      assert.equal(result.nodes.get('movement-generator')?.status, 'skipped')
      assert.equal(replies.length, 0)
    } finally { configureProvider() }
  })
})

test('a new process resumes the saved Controller child wait without reconstructing its objective or rerunning its decision', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('process-restart')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(controllerChoice('robot-autonomy-executor'), routes, presetChoice())
      const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const { action } = completeAction(current, 'robotCommand', 'process-restart-after')
      assert.equal(action.executionId, executionId)
      const requestPath = path.join(root, 'process-restart-request.json')
      const outputPath = path.join(root, 'process-restart-result.json')
      fs.writeFileSync(requestPath, JSON.stringify({ root, graphName: 'robot-autonomy-controller',
        executionId, replies: [completionReview()], output: outputPath }))
      const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(import.meta.url)], {
        cwd: repo, env: { ...process.env, METAHUMAN_WORKFLOW_TEST_RESUME: requestPath },
        encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      })
      fs.writeFileSync(path.join(root, 'process-restart.log'), `${child.stdout ?? ''}\n${child.stderr ?? ''}`)
      assert.equal(child.status, 0, `${child.error?.message ?? ''}\n${child.stderr}`)
      const resumed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
      assert.equal(resumed.status, 'completed', resumed.error)
      assert.equal(resumed.executionId, executionId)
      assert.equal(resumed.calls.length, 1, 'Only the action-result reviewer calls the configured model after process restart')
      assert.equal(resumed.calls[0].provider, 'ollama')
      assert.equal(resumed.calls[0].options.model, 'fixture-model')
      assert.equal(resumed.physicalJobs, 0, 'The completed movement must not be admitted again')
      assert.equal(resumed.remainingReplies, 0)
      assertParticipatingGraphs(executionId, ['robot-autonomy-controller', 'boredom-autonomy', 'robot-action-result'])
      const store = openExecutionStore(username)
      try { assert.equal(store.task(executionId)?.objective, objective) } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('a Controller-selected finite Daydreamer graph executes and returns through the same durable parent', async () => {
  await withUserContext(user, async () => {
    seedDaydreamMemories()
    const current = freshObservation('finite-daydream')
    const beforeCalls = calls.length
    replies.push({ ...controllerChoice('daydreamer'),
      instruction: 'Reflect imaginatively on the recent observations.',
      reason: 'The recent experiences offer material for a private daydream.' })
    const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
    assert.equal(started.status, 'waiting', started.error?.stack)
    const executionId = started.executionId!
    const waitingStore = openExecutionStore(username)
    try { assert.equal(waitingStore.get(executionId).waitingReason, 'agent_result') } finally { waitingStore.close() }
    const jobs = manager.getAllTasks().filter(task => task.durable?.executionId === executionId && task.handler === 'agent.daydreamer')
    assert.equal(jobs.length, 1)
    const work = jobs[0]
    assert.equal(work.correlationId, executionId)
    assert.equal(JSON.parse(work.input.graphContext.taskBrief).instruction, 'Reflect imaginatively on the recent observations.')
    assert.ok(manager.claim(work.id))
    const daydream = 'I imagine those colors becoming little windows, each opening onto a different quiet possibility.'
    replies.push(daydream)
    const child = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runGraph({
      graph: graph('daydreamer'), context: { username, userId: username, cognitiveMode: 'agent',
        allowMemoryWrites: true, idempotencyKey: `daydreamer:${username}:${work.id}`, memoryTimestamp: work.createdAt },
    }), async input => manager.enqueue(input))
    assert.equal(child.status, 'completed', child.error?.stack)
    assert.equal(child.executionId, executionId)
    assert.equal(child.nodes.get('2')?.outputs?.daydream, daydream)
    assert.equal(child.nodes.get('4')?.outputs?.saved, true)
    assert.equal(child.nodes.get('task-brief')?.outputs?.text, work.input.graphContext.taskBrief)
    assert.match(JSON.stringify(calls.at(-1)?.messages), /Reflect imaginatively on the recent observations/)
    assert.equal(calls.length, beforeCalls + 2, 'Controller and specialist each use their actual configured model role')
    assert.equal(calls.at(-1)?.options.maxTokens, graph('daydreamer').nodes.find(node => node.id === '2')!.data.properties!.maxTokens)
    const store = openExecutionStore(username)
    try {
      assert.equal(store.get(executionId).status, 'waiting', 'The specialist cannot finish its waiting parent')
      const definitions = store.db.prepare('SELECT definition FROM execution_graphs WHERE execution_id = ?').all(executionId) as { definition: string }[]
      assert.ok(definitions.some(row => store.codec.decode(row.definition).graphId === graph('daydreamer').name))
    } finally { store.close() }
    manager.complete(work.id, true, { daydreamsGenerated: 1, memoriesCurated: 3 })
    await deliverDurableWorkReceipt(manager.getTask(work.id)!, async input => manager.enqueue(input))
    await deliverDurableWorkReceipt(manager.getTask(work.id)!, async input => manager.enqueue(input))
    const resumed = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current), executionId })
    assert.equal(resumed.status, 'completed', resumed.error?.stack)
    assert.equal(resumed.nodes.get('agent-result')?.outputs?.result.result.state, 'completed')
    assert.equal(resumed.nodes.get('agent-result')?.outputs?.result.result.result.daydreamsGenerated, 1)
    assert.equal(resumed.nodes.get('agent-result')?.outputs?.result.result.graphResults[0].output.daydream, daydream)
    assert.equal(calls.length, beforeCalls + 2, 'Receipt resumption must not repeat Controller or Daydreamer decisions')
    const finished = openExecutionStore(username)
    try {
      assert.equal(finished.list().filter(record => record.executionId === executionId).length, 1)
      assert.equal(finished.events(executionId).filter(event => event.kind === 'work_result').length, 1)
      assert.equal(finished.task(executionId), null, 'A private activity must not invent a robot objective')
    } finally { finished.close() }
    assert.equal(replies.length, 0)
  })
})

test('saved Goal Review can choose a specialist and evaluate its returned evidence without another Controller call', async () => {
  for (const [failSpecialist, steerSpecialist] of [[false, false], [true, false], [false, true]]) {
  await withUserContext(user, async () => {
    seedDaydreamMemories()
    const current = freshObservation('review-specialist')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const completed = completeAction(current, 'robotCommand', 'review-specialist-after')
      const beforeReview = calls.length
      replies.push(incompleteActionReview(), { ...goalReview('continue'), taskId: 'daydreamer',
        instruction: 'Imagine a fresh perspective on this search.', response: 'I am considering a fresh perspective.' })
      const waiting = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(waiting.status, 'waiting', waiting.error?.stack)
      assert.equal(calls.length, beforeReview + 2, 'One result interpretation and one contextual choice; no added Controller call')
      const jobs = manager.getAllTasks().filter(task => task.durable?.executionId === executionId && task.handler === 'agent.daydreamer')
      assert.equal(jobs.length, 1)
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0, 'A specialist choice does not dispatch a physical action')
      const specialist = jobs[0]
      const correction = 'Tell me what the reflective activity produced before proceeding.'
      if (steerSpecialist) {
        replies.push({ ...routes, executionDisposition: 'steer', targetExecutionId: executionId })
        const admitted = await run({ graph: graph('environment'), context: { ...context(current), userMessage: correction } })
        assert.equal(admitted.status, 'completed', admitted.error?.stack)
      }
      assert.ok(manager.claim(specialist.id))
      const thought = 'I imagine the floor patterns as a map, suggesting another perspective without claiming to have seen the target.'
      const failure = { code: 'provider_failed', message: 'Controlled specialist model failure', retryable: false }
      replies.push(failSpecialist ? new Error(failure.message) : thought)
      const child = await withGraphWork(specialist, id => manager.attachExecution(specialist.id, id), () => runGraph({
        graph: graph('daydreamer'), context: { username, userId: username, cognitiveMode: 'agent',
          allowMemoryWrites: true, idempotencyKey: `daydreamer:${username}:${specialist.id}`, memoryTimestamp: specialist.createdAt },
      }), async input => manager.enqueue(input))
      assert.equal(child.status, failSpecialist ? 'failed' : 'completed', child.error?.stack)
      assert.equal(child.executionId, executionId)
      assert.match(JSON.stringify(calls.at(-1)?.messages), /Imagine a fresh perspective on this search/)
      manager.complete(specialist.id, !failSpecialist,
        failSpecialist ? failure : { stdout: 'Verbose process logs are not the specialist answer.', stderr: '' })
      await deliverDurableWorkReceipt(manager.getTask(specialist.id)!, async input => manager.enqueue(input))
      await deliverDurableWorkReceipt(manager.getTask(specialist.id)!, async input => manager.enqueue(input))
      const beforeReceipt = calls.length
      if (steerSpecialist) replies.push({ ...routes, needsAction: false, needsVision: false },
        { response: thought, actions: [], movementRequest: null, taskDecision: null })
      replies.push(goalReview('wait'))
      const resumed = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(resumed.status, 'waiting', resumed.error?.stack)
      assert.equal(calls.length, beforeReceipt + (steerSpecialist ? 3 : 1),
        'Only received user input adds intent and action-selection calls before remaining-goal review')
      if (steerSpecialist) assert.ok(JSON.stringify(calls[beforeReceipt + 1].messages).includes(correction))
      const reviewMessages = JSON.stringify(calls.at(-1)?.messages)
      assert.ok(reviewMessages.includes(failSpecialist ? failure.message : thought))
      assert.ok(reviewMessages.includes(objective))
      assert.ok(reviewMessages.includes('reflector'), 'Review retains the full catalog rather than an Executor-only continuation')
      assert.ok(!reviewMessages.includes('Verbose process logs'))
      const store = openExecutionStore(username)
      try {
        const returns = store.events(executionId).filter(event => event.kind === 'work_result' && event.workItemId === specialist.id)
        assert.equal(returns.length, 1, 'Repeated receipt delivery must not duplicate the specialist return')
        const graphReturn = (returns[0].payload as any).result.graphResults[0]
        assert.equal(graphReturn.status, failSpecialist ? 'failed' : 'completed')
        if (failSpecialist) assert.equal(graphReturn.output, null, 'An intermediate context node is not a failed specialist answer')
        assert.equal(store.task(executionId)?.decision.objectiveComplete, false, 'An imagined perspective is not objective-completion evidence')
        const { projectAutonomyActivityOutcomes } = await import('../nodes/robot-operator/autonomy-activity-history.node.js')
        const projected = projectAutonomyActivityOutcomes([{ taskId: 'initial-admission', capabilityId: 'robot-autonomy-executor',
          handler: 'workflow.robot-autonomy-controller', state: 'completed', createdAt: current.timestamp!, executionIds: [executionId],
          result: { effect: { actionQueue: { status: 'coordinated_for_adapter' } } } }], store)
        const projectedExecutions = projected[0].result?.executions
        assert.ok(Array.isArray(projectedExecutions))
        assert.equal(projectedExecutions[0].objective.actionStatus, 'completed')
        assert.equal(projectedExecutions[0].status, 'waiting')
        assert.equal('effect' in projected[0].result!, false, 'Initial admission facts do not impersonate the later outcome')
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result' && event.actionId === completed.action.id).length, 1)
        store.cancel(executionId, { eventId: randomUUID(), kind: 'user_cancelled', payload: { reason: 'Fixture cleanup' } })
      } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
  }
})

test('a taskless Controller receives the saved Bridge frame with its actual recorded time', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('saved-vision')
    current.visual!.metadata = { actionId: 'earlier-action' }
    recordEnvironmentObservation(current)
    const trigger = { ...controllerContext(current), environmentObservation: undefined, environmentObservationCurrent: false }
    const before = calls.length
    replies.push({ ...controllerChoice('none'), instruction: '', response: 'I am taking in the view.' })
    const result = await run({ graph: graph('robot-autonomy-controller'), context: trigger })
    assert.equal(result.status, 'completed', result.error?.stack)
    assert.equal(calls.length, before + 1)
    assert.equal(result.nodes.get('image-input')?.outputs?.current, false)
    assert.equal(result.nodes.get('image-input')?.outputs?.frames[0].metadata.actionId, 'earlier-action')
    assert.ok(calls.at(-1)?.messages.some(message => Array.isArray(message.content) && message.content.some((part: any) => part.type === 'image_url')))
    assert.ok(JSON.stringify(calls.at(-1)?.messages).includes('Re-examines') || JSON.stringify(calls.at(-1)?.messages).includes('reflector'))
    assert.equal(manager.getAllTasks().filter(task => task.durable?.executionId === result.executionId && task.type === 'environment_command').length, 0)
    assert.equal(replies.length, 0)
  })
})

test('saved Goal Review continues through the real Executor and reviews its next result in the same parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-continue')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const initial = completeAction(current, 'robotCommand', 'goal-continue-first-after')
      const beforeReview = calls.length
      replies.push(incompleteActionReview(), goalReview('continue'), routes, { ...presetChoice(), taskDecision: null })
      const continuing = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, beforeReview + 4, 'Action Result, Goal Review, intent and selection each execute once')
      assert.ok(JSON.stringify(calls[beforeReview + 1].messages).includes(initial.after.visual!.id),
        'Goal Review receives the correlated result frame, not only the original input view')
      const next = completeAction(initial.after, 'robotCommand', 'goal-continue-second-after')
      assert.notEqual(next.action.id, initial.action.id)
      assert.equal(next.action.executionId, executionId)
      const dispatchedStore = openExecutionStore(username)
      try {
        const task = dispatchedStore.task(executionId)!
        assert.equal(task.actionId, next.action.id, 'A new action is recorded even without an objective change')
        assert.equal(task.feedback, null, 'The prior action receipt must not describe the new action')
        assert.equal(task.completionCriteria, presetChoice().taskDecision.completionCriteria)
      } finally { dispatchedStore.close() }
      replies.push(completionReview())
      const finished = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assertParticipatingGraphs(executionId, ['environment', 'robot-action-result', 'robot-goal-review', 'boredom-autonomy'])
      const store = openExecutionStore(username)
      try {
        assert.equal(store.task(executionId)?.objective, objective)
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result').length, 2)
      } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('deep saved continuations retain distinct bounded memory identities and resume after restart without replay', async () => {
  await withUserContext(user, async () => {
    const { loadBufferForUser } = await import('../conversation-buffer.js')
    const { scanEpisodicMemoryRecords } = await import('../memory.js')
    const current = freshObservation('deep-continuation')
    const initialContext = { ...controllerContext(current), recordPersonaMemory: true }
    const utterance = 'Fixture deep continuation: I will inspect the next area.'
    const choice = { ...presetChoice(), response: utterance }
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    const originalFetch = globalThis.fetch
    fs.mkdirSync(path.join(root, 'logs/run/queue'), { recursive: true })
    fs.writeFileSync(path.join(root, 'logs/run/queue/service-token'), 'isolated-fixture-token')
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'http://127.0.0.1:4321/api/internal/work-coordinator/enqueue')
      assert.equal(init?.method, 'POST')
      return Response.json({ task: manager.enqueue(JSON.parse(String(init?.body))) })
    }
    try {
      replies.push(controllerChoice('robot-autonomy-executor'), routes, choice)
      const started = await run({ graph: graph('robot-autonomy-controller'), context: initialContext })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      let after = current
      const actionIds = new Set<string>()
      for (let index = 0; index < 6; index++) {
        const completed = completeAction(after, 'robotCommand', `deep-continuation-${index}-after`)
        after = completed.after
        assert.equal(completed.action.executionId, executionId)
        assert.equal(actionIds.has(completed.action.id), false)
        actionIds.add(completed.action.id)
        // Repeated transport delivery is not another physical result or another decision.
        recordEnvironmentActionResult(after.feedback![0])
        if (index === 5) break
        replies.push(incompleteActionReview(), goalReview('continue'), routes, { ...choice, taskDecision: null })
        const continuing = await run({ graph: graph('robot-autonomy-controller'), context: initialContext, executionId })
        assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      }
      const entries = () => loadBufferForUser(username, 'conversation').messages.filter(entry => entry.content === utterance)
      const memories = () => [...scanEpisodicMemoryRecords(username)].filter(item => item.status === 'record'
        && item.record.event.type === 'conversation' && item.record.event.content === utterance)
      const admittedEntries = entries()
      const admittedMemories = memories()
      assert.equal(admittedEntries.length, 6, 'Identical words in distinct decisions remain distinct messages')
      assert.equal(admittedMemories.length, 6)
      const keys = admittedEntries.map(entry => entry.meta!.idempotencyKey as string)
      assert.equal(new Set(keys).size, 6)
      assert.ok(keys.every(key => key.length <= 512), 'Every depth fits the existing memory identity contract')
      const requestPath = path.join(root, 'deep-continuation-restart-request.json')
      const outputPath = path.join(root, 'deep-continuation-restart-result.json')
      fs.writeFileSync(requestPath, JSON.stringify({ root, graphName: 'robot-autonomy-controller',
        executionId, replies: [completionReview()], output: outputPath }))
      const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(import.meta.url)], {
        cwd: repo, env: { ...process.env, METAHUMAN_WORKFLOW_TEST_RESUME: requestPath },
        encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      })
      fs.writeFileSync(path.join(root, 'deep-continuation-restart.log'), `${child.stdout ?? ''}\n${child.stderr ?? ''}`)
      assert.equal(child.status, 0, `${child.error?.message ?? ''}\n${child.stderr}`)
      const resumed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
      assert.equal(resumed.status, 'completed', resumed.error)
      assert.equal(resumed.calls.length, 1, 'Only the next action-result review runs in the new process')
      assert.equal(resumed.physicalJobs, 0, 'Restart does not repeat any admitted motion')
      assert.equal(resumed.remainingReplies, 0)
      assertParticipatingGraphs(executionId, ['robot-autonomy-controller', 'boredom-autonomy', 'robot-action-result', 'robot-goal-review'])
      const beforeReplay = calls.length
      const replay = await run({ graph: graph('robot-autonomy-controller'), context: initialContext, executionId })
      assert.equal(replay.status, 'completed', replay.error?.stack)
      assert.equal(calls.length, beforeReplay)
      assert.deepEqual(entries(), admittedEntries)
      assert.deepEqual(memories(), admittedMemories)
      assert.equal(takeAdapterActions(current.sessionId!).length, 0)
      const store = openExecutionStore(username)
      try {
        assert.equal(store.task(executionId)?.objective, objective)
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result').length, 6)
      } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { globalThis.fetch = originalFetch; unsubscribe() }
  })
})

test('saved Controller and Goal Review return incomplete executor instructions to their original model without dispatching them', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('choice-correction')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const choice = controllerChoice('robot-autonomy-executor')
      const invalidChoice = { ...choice, instruction: '' }
      const before = calls.length
      replies.push(invalidChoice, choice, routes, presetChoice())
      const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const assertCorrection = (original: typeof calls[number], correction: typeof calls[number], rejected: unknown) => {
        assert.deepEqual(correction.messages.slice(0, -2), original.messages)
        assert.deepEqual(correction.options, original.options)
        assert.equal(correction.messages.at(-2).content, JSON.stringify(rejected))
        assert.match(correction.messages.at(-1).content, /requires one high-level instruction/)
      }
      assert.equal(calls.length, before + 4)
      assertCorrection(calls[before], calls[before + 1], invalidChoice)
      const initial = completeAction(current, 'robotCommand', 'choice-correction-first-after')
      const review = goalReview('continue')
      const invalidReview = { ...review, instruction: '' }
      const beforeReview = calls.length
      replies.push(incompleteActionReview(), invalidReview, review, routes, { ...presetChoice(), taskDecision: null })
      const continuing = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current), executionId })
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, beforeReview + 5)
      assertCorrection(calls[beforeReview + 1], calls[beforeReview + 2], invalidReview)
      const next = completeAction(initial.after, 'robotCommand', 'choice-correction-second-after')
      assert.notEqual(next.action.id, initial.action.id)
      assert.equal(next.action.executionId, executionId)
      replies.push(completionReview())
      const completed = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current), executionId })
      assert.equal(completed.status, 'completed', completed.error?.stack)
      assertParticipatingGraphs(executionId, ['robot-autonomy-controller', 'boredom-autonomy', 'robot-action-result', 'robot-goal-review'])
      assert.equal(takeAdapterActions(current.sessionId!).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('user and Controller workflows correct rejected selector output on the same objective and dispatch only the corrected choice', async () => {
  for (const entry of ['environment', 'robot-autonomy-controller']) await withUserContext(user, async () => {
    const current = freshObservation(`selector-correction-${entry}`)
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      if (entry === 'robot-autonomy-controller') replies.push(controllerChoice('robot-autonomy-executor'))
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph(entry), context: entry === 'environment' ? context(current) : controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const initialStore = openExecutionStore(username)
      let objectiveId: string
      try { objectiveId = initialStore.task(executionId)!.objectiveId } finally { initialStore.close() }
      const initial = completeAction(current, 'robotCommand', `correction-${entry}-first-after`)
      const invalid = { ...presetChoice(), response: 'I intend to inspect another area.', actions: [] }
      const corrected = { ...presetChoice(), taskDecision: { ...presetChoice().taskDecision, outcome: 'continue' } }
      const beforeReview = calls.length
      replies.push(incompleteActionReview(), goalReview('continue'), routes, invalid, corrected)
      const continuing = await run({ graph: graph(entry), context: context(current), executionId })
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, beforeReview + 5, 'Only the invalid selector decision adds an inference call')
      const correction = calls.at(-1)!
      assert.deepEqual(correction.messages.slice(0, -2), calls.at(-2)!.messages,
        'The original instruction, criteria, image parts and routing context remain unchanged')
      assert.deepEqual(correction.options, calls.at(-2)!.options, 'Model role, settings and output contract are unchanged')
      assert.equal(correction.messages.at(-2).content, JSON.stringify(invalid))
      assert.match(correction.messages.at(-1).content, /outcome=act requires an action or movementRequest/)
      const next = completeAction(initial.after, 'robotCommand', `correction-${entry}-second-after`)
      assert.notEqual(next.action.id, initial.action.id)
      assert.equal(next.action.executionId, executionId)
      const pending = openExecutionStore(username)
      try {
        assert.equal(pending.task(executionId)?.objectiveId, objectiveId)
        assert.equal(pending.task(executionId)?.objective, objective)
        assert.equal(pending.task(executionId)?.completionCriteria, presetChoice().taskDecision.completionCriteria)
        assert.equal(pending.task(executionId)?.decision.outcome, 'continue')
        assert.equal(pending.task(executionId)?.decision.objectiveComplete, false)
      } finally { pending.close() }
      replies.push(completionReview())
      const finished = await run({ graph: graph(entry), context: context(current), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assertParticipatingGraphs(executionId, [entry, 'robot-action-result', 'robot-goal-review', 'boredom-autonomy'])
      const store = openExecutionStore(username)
      try {
        assert.equal(store.task(executionId)?.objectiveId, objectiveId)
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result').length, 2)
      } finally { store.close() }
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('a no-action objective enters the existing review wait and keeps its criteria through later action and evidence', async () => {
  await withUserContext(user, async () => {
    for (const entry of ['environment', 'boredom-autonomy']) {
      const current = freshObservation(`objective-without-action-${entry}`)
      recordEnvironmentObservation(current)
      setEnvironmentBridgeEnabled(true)
      const unsubscribe = connectAdapter(current.sessionId!)
      try {
        const initialContext = entry === 'environment' ? context(current) : {
          ...controllerContext(current), robotOperatorContext: {
            ...controllerContext(current).robotOperatorContext,
            plannerDecision: { observed: 'The target is not identified yet.', instruction: objective, reason: 'Locate and report it.' },
          },
        }
        const before = calls.length
        replies.push({ ...routes, needsAction: false }, {
          response: 'I am considering where to inspect next.', actions: [], movementRequest: null,
          taskDecision: { ...presetChoice().taskDecision, outcome: 'continue', continuationPolicy: 'none' },
        }, goalReview('wait'))
        const started = await run({ graph: graph(entry), context: initialContext })
        assert.equal(started.status, 'waiting', started.error?.stack)
        assert.equal(calls.length, before + 3, 'An incomplete objective reaches one review, without forcing an action')
        assert.equal(takeAdapterActions(current.sessionId!).length, 0)
        const executionId = started.executionId!
        const store = openExecutionStore(username)
        let objectiveId: string
        try {
          assert.equal(store.get(executionId).waitingReason, 'user_or_autonomy')
          objectiveId = store.task(executionId)!.objectiveId
          assert.equal(store.task(executionId)?.completionCriteria, presetChoice().taskDecision.completionCriteria)
        } finally { store.close() }

        replies.push(controllerChoice('robot-autonomy-executor'), routes, { ...presetChoice(), taskDecision: null })
        await signalExecution(executionId)
        const moving = await run({ graph: graph(entry), context: initialContext, executionId })
        assert.equal(moving.status, 'waiting', moving.error?.stack)
        const completed = completeAction(current, 'robotCommand', `${entry}-objective-after`)
        replies.push(completionReview())
        const finished = await run({ graph: graph(entry), context: initialContext, executionId })
        assert.equal(finished.status, 'completed', finished.error?.stack)
        const saved = openExecutionStore(username)
        try {
          assert.equal(saved.task(executionId)?.objectiveId, objectiveId)
          assert.equal(saved.task(executionId)?.completionCriteria, presetChoice().taskDecision.completionCriteria)
          assert.equal(saved.task(executionId)?.decision.objectiveComplete, true)
          assert.equal(saved.task(executionId)?.actionId, completed.action.id)
        } finally { saved.close() }
        assert.equal(replies.length, 0)
      } finally { unsubscribe() }
    }
  })
})

test('intent and selected context retain supplied dialogue and show waiting standalone work without inventing a goal', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('pending-standalone-context')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, { ...presetChoice(), taskDecision: null })
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const { writeBufferEntry } = await import('../conversation-buffer.js')
      const longMessage = `Preserve this whole instruction: ${'Relevant conversational detail. '.repeat(10)}Finish by reporting the result.`
      await writeBufferEntry(username, 'conversation', { role: 'user', content: longMessage })
      const before = calls.length
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
        { response: 'I have that context.', actions: [], movementRequest: null, taskDecision: null })
      const inspected = await run({ graph: graph('environment'), context: { ...context(current), userMessage: 'What is underway?' } })
      assert.equal(inspected.status, 'completed', inspected.error?.stack)
      assert.ok(JSON.stringify(calls[before].messages).includes(longMessage), 'Intent receives the complete supplied user turn')
      assert.ok(JSON.stringify(calls[before + 1].messages).includes(longMessage), 'Selected dialogue reaches the selector unchanged')
      const active = inspected.nodes.get('execution')?.outputs?.activeExecutions
      assert.ok(active.some((item: any) => item.executionId === started.executionId && item.task === null && item.waitingReason === 'robot_result'))
      const finishedAction = completeAction(current, 'robotCommand', 'standalone-context-after')
      replies.push({ response: '', taskDecision: null })
      const finished = await run({ graph: graph('environment'), context: context(finishedAction.after), executionId: started.executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('input during standalone actions reaches the existing user workflow after result review without inventing an objective', async () => {
  for (const entry of ['environment', 'boredom-autonomy']) await withUserContext(user, async () => {
    const current = freshObservation(`standalone-steering-${entry}`)
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const initialContext = entry === 'environment' ? context(current) : {
        ...controllerContext(current), robotOperatorContext: {
          ...controllerContext(current).robotOperatorContext,
          plannerDecision: { observed: 'An open area.', instruction: 'Inspect the adjacent area.', reason: 'Explore.' },
        },
      }
      replies.push(routes, { ...presetChoice(), taskDecision: null })
      const started = await run({ graph: graph(entry), context: initialContext })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const messages = ['After this movement, inspect another area.', 'Report what is there after the next movement.']
      for (const userMessage of messages) {
        replies.push({ ...routes, executionDisposition: 'steer', targetExecutionId: executionId })
        const admitted = await run({ graph: graph('environment'), context: { ...context(current), userMessage } })
        assert.equal(admitted.status, 'completed', admitted.error?.stack)
        assert.equal(admitted.nodes.get('execution-input-out')?.outputs?.sent, true)
      }
      const initial = completeAction(current, 'robotCommand', `${entry}-steering-after`)
      const before = calls.length
      replies.push({ response: '', taskDecision: null }, routes, { ...presetChoice(), taskDecision: null })
      const continuing = await run({ graph: graph(entry), context: initialContext, executionId })
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, before + 3, 'Review finishes before the user router and selector interpret queued input')
      assert.deepEqual(calls[before].options.jsonSchema.properties.taskDecision, { type: 'null' },
        'Action Result evaluates the finished action; it does not invent the new objective')
      for (const message of messages) assert.ok(JSON.stringify(calls[before + 2].messages).includes(message))
      const userInput = continuing.nodes.get('action-results')?.outputs?.userInput
      assert.equal(userInput.userMessage, messages.at(-1), 'The newest instruction is forwarded verbatim')
      assert.equal(userInput.environmentObservation.visual.id, initial.after.visual!.id)
      assert.equal(userInput.environmentObservationCurrent, true)
      const next = completeAction(initial.after, 'robotCommand', `${entry}-steering-second-after`)
      assert.equal(next.action.executionId, executionId)
      assert.notEqual(next.action.id, initial.action.id)
      replies.push({ response: 'The movement is finished.', taskDecision: null })
      const finished = await run({ graph: graph(entry), context: initialContext, executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      const store = openExecutionStore(username)
      try {
        assert.equal(store.task(executionId), null)
        assert.equal(store.events(executionId).filter(event => event.kind === 'user_steering').length, 2)
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result').length, 2)
        assert.equal(store.get(executionId).lastProcessedSequence, store.get(executionId).lastSequence)
      } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('input arriving after the result checkpoint still reaches the saved decision workflow', async () => {
  for (const entry of ['environment', 'boredom-autonomy', 'robot-autonomy-controller']) await withUserContext(user, async () => {
    const current = freshObservation(`late-input-${entry}`)
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      const initialContext = entry === 'environment' ? context(current) : {
        ...controllerContext(current), robotOperatorContext: {
          ...controllerContext(current).robotOperatorContext,
          plannerDecision: { observed: 'An open area.', instruction: 'Inspect the adjacent area.', reason: 'Explore.' },
        },
      }
      if (entry === 'robot-autonomy-controller') replies.push(controllerChoice('robot-autonomy-executor'))
      replies.push(routes, { ...presetChoice(), taskDecision: null })
      const started = await run({ graph: graph(entry), context: initialContext })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', `${entry}-late-input-after`)
      const correction = 'Inspect the other side next and report what is visible.'
      const before = calls.length
      let announceReview!: () => void
      let releaseReview!: () => void
      const reviewEntered = new Promise<void>(resolve => { announceReview = resolve })
      const reviewReleased = new Promise<void>(resolve => { releaseReview = resolve })
      replies.push(async () => {
        const store = openExecutionStore(username)
        try { assert.equal(store.get(executionId).lastProcessedSequence, 2, 'The result wait already committed its output') }
        finally { store.close() }
        announceReview()
        await reviewReleased
        return { response: '', taskDecision: null }
      })
      const resuming = run({ graph: graph(entry), context: initialContext, executionId })
      await reviewEntered
      const originalFetch = globalThis.fetch
      try {
        // The public graph entrypoint receives an independent request, outside
        // the paused model call's context. Only its Coordinator transport is mocked.
        fs.mkdirSync(path.join(root, 'logs/run/queue'), { recursive: true })
        fs.writeFileSync(path.join(root, 'logs/run/queue/service-token'), 'isolated-fixture-token')
        globalThis.fetch = async (input, init) => {
          assert.equal(String(input), 'http://127.0.0.1:4321/api/internal/work-coordinator/enqueue')
          assert.equal(init?.method, 'POST')
          return Response.json({ task: manager.enqueue(JSON.parse(String(init?.body))) })
        }
        replies.push({ ...routes, executionDisposition: 'steer', targetExecutionId: executionId })
        const { handleExecuteGraph } = await import('../api/handlers/execute-graph.js')
        const admitted = await handleExecuteGraph({ method: 'POST', path: '/api/execute-graph',
          user: { ...user, isAuthenticated: true },
          body: { graph: graph('environment'), userMessage: correction, sessionId: current.sessionId },
        })
        assert.equal(admitted.status, 200, JSON.stringify(admitted))
        replies.push(routes, { ...presetChoice(), taskDecision: null })
      } finally { globalThis.fetch = originalFetch; releaseReview() }
      const continuing = await resuming
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, before + 4, 'Only review, admission intent, resumed intent, and action selection run')
      assert.ok(JSON.stringify(calls.at(-1)!.messages).includes(correction))
      completeAction(current, 'robotCommand', `${entry}-late-input-second-after`)
      replies.push({ response: '', taskDecision: null })
      const finished = await run({ graph: graph(entry), context: initialContext, executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0, 'Neither action is replayed')
      const store = openExecutionStore(username)
      try {
        const events = store.events(executionId)
        assert.equal(events.filter(event => event.kind === 'user_steering').length, 1)
        assert.equal(events.filter(event => event.kind === 'physical_result').length, 2)
        assert.equal(store.get(executionId).lastProcessedSequence, store.get(executionId).lastSequence)
        assert.equal(store.task(executionId), null)
      } finally { store.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('user input retains one buffer and memory identity across a workflow handoff but separate identical turns remain distinct', async () => {
  await withUserContext(user, async () => {
    const { loadBufferForUser } = await import('../conversation-buffer.js')
    const { scanEpisodicMemoryRecords } = await import('../memory.js')
    const current = freshObservation('input-identity')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    const originalFetch = globalThis.fetch
    fs.mkdirSync(path.join(root, 'logs/run/queue'), { recursive: true })
    fs.writeFileSync(path.join(root, 'logs/run/queue/service-token'), 'isolated-fixture-token')
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'http://127.0.0.1:4321/api/internal/work-coordinator/enqueue')
      assert.equal(init?.method, 'POST')
      return Response.json({ task: manager.enqueue(JSON.parse(String(init?.body))) })
    }
    try {
      const initialContext = { ...context(current), recordPersonaMemory: true }
      replies.push(routes, { ...presetChoice(), taskDecision: null })
      const started = await run({ graph: graph('environment'), context: initialContext })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const message = '  Report the result without another movement.\n'
      const inputContext = { ...initialContext, userMessage: message }
      const conversationRoutes = { ...routes, needsVision: false, needsAction: false }
      replies.push({ ...conversationRoutes, executionDisposition: 'steer', targetExecutionId: executionId })
      const admitted = await run({ graph: graph('environment'), context: inputContext })
      assert.equal(admitted.status, 'completed', admitted.error?.stack)
      const entries = () => loadBufferForUser(username, 'conversation').messages
        .filter(entry => entry.role === 'user' && entry.content === message)
      const memories = () => [...scanEpisodicMemoryRecords(username)]
        .filter(item => item.status === 'record' && item.record.event.type === 'conversation' && item.record.event.content === message)
      assert.equal(entries().length, 1)
      assert.equal(memories().length, 1)
      const originalEntry = entries()[0]
      const originalMemory = memories()[0]
      completeAction(current, 'robotCommand', 'input-identity-after')
      replies.push({ response: '', taskDecision: null }, conversationRoutes,
        { response: 'The movement finished.', actions: [], movementRequest: null, taskDecision: null })
      const finished = await run({ graph: graph('environment'), context: initialContext, executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.deepEqual(entries(), [originalEntry], 'Handoff preserves one admitted entry, including its original timestamp and ID')
      assert.deepEqual(memories(), [originalMemory], 'Handoff preserves one exact long-term memory')
      const beforeReplay = calls.length
      await run({ graph: graph('environment'), context: initialContext, executionId })
      assert.equal(calls.length, beforeReplay)
      assert.deepEqual(entries(), [originalEntry])
      assert.deepEqual(memories(), [originalMemory])

      replies.push(conversationRoutes, { response: 'The movement finished.', actions: [], movementRequest: null, taskDecision: null })
      const repeated = await run({ graph: graph('environment'), context: inputContext })
      assert.equal(repeated.status, 'completed', repeated.error?.stack)
      assert.equal(entries().length, 2, 'A new user request with identical text is not suppressed')
      assert.equal(memories().length, 2)
      assert.notEqual(entries()[1].meta?.idempotencyKey, originalEntry.meta?.idempotencyKey)
      const { UserInputNode } = await import('../nodes/input/user-input.node.js')
      const forwarded = { ...inputContext, userMessageEntry: originalEntry }
      assert.deepEqual((await UserInputNode.execute({}, forwarded, {})).entry, originalEntry)
      assert.equal((await UserInputNode.execute({}, { ...forwarded, userMessage: 'A different request.' }, {})).entry, undefined)
      assert.equal((await UserInputNode.execute({ text: message }, forwarded, { prioritizeChatInterface: false })).entry, undefined,
        'A distinct connected input never borrows the previous chat admission, even for identical text')
      assert.equal((await UserInputNode.execute({ speech: { text: message, transcribed: true } }, forwarded,
        { prioritizeChatInterface: false })).entry, undefined)
      assert.equal(replies.length, 0)
    } finally { globalThis.fetch = originalFetch; unsubscribe() }
  })
})

test('saved Environment admits user steering into the exact Goal Review wait and completion remains on that parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-steering')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', 'goal-steering-after')
      replies.push(incompleteActionReview(), goalReview('wait'))
      const waiting = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(waiting.status, 'waiting', waiting.error?.stack)
      const store = openExecutionStore(username)
      let objectiveId: string
      try {
        assert.equal(store.get(executionId).waitingReason, 'user_or_autonomy')
        objectiveId = store.task(executionId)!.objectiveId
      } finally { store.close() }
      const message = 'The fixture target is beside the window. I found it, so the search is complete.'
      const beforeInput = calls.length
      replies.push({ ...routes, executionDisposition: 'steer', targetExecutionId: executionId,
        needsEnvironment: false, needsVision: false, needsAction: false })
      const admission = await run({ graph: graph('environment'), context: { ...context(current), userMessage: message } })
      assert.equal(admission.status, 'completed', admission.error?.stack)
      assert.notEqual(admission.executionId, executionId)
      assert.equal(admission.nodes.get('execution-input-out')?.outputs?.sent, true)
      assert.equal(admission.nodes.get('4')?.status, 'skipped', 'Admission does not reinterpret the instruction or start an unrelated action')
      assert.equal(calls.length, beforeInput + 1)
      const inputStore = openExecutionStore(username)
      try {
        const input = inputStore.events(executionId).filter(event => event.kind === 'user_steering')
        assert.equal(input.length, 1)
        assert.equal((input[0].payload as any).userMessage, message)
      } finally { inputStore.close() }
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
        { response: 'The search is complete.', actions: [], movementRequest: null,
          taskDecision: { outcome: 'complete', objective,
            completionCriteria: 'Identify the target in visual evidence and report its location.',
            continuationPolicy: 'none',
            reason: 'The user reports finding the target.', requiredCompletionBasis: 'user_input',
            observationSummary: 'The user located the target beside the window.', completionEvidence: message } })
      const resumed = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
      const intentText = JSON.stringify(calls.at(-2)?.messages)
      assert.match(intentText, /Current execution:/, 'The resumed intent decision receives its own current objective')
      assert.ok(intentText.includes(objectiveId))
      assert.ok(intentText.includes(presetChoice().taskDecision.completionCriteria))
      const finished = openExecutionStore(username)
      try {
        assert.equal(finished.task(executionId)?.objectiveId, objectiveId)
        assert.equal(finished.task(executionId)?.decision.objectiveComplete, true)
        assert.equal(finished.get(executionId).lastProcessedSequence, finished.get(executionId).lastSequence)
      } finally { finished.close() }
      assert.ok(JSON.stringify(calls.at(-1)?.messages).includes(message), 'Resumed selection receives the unchanged user correction')
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('execution handoff checks current compatibility without hiding the saved objective or rewriting the new input', async () => {
  await withUserContext(user, async () => {
    const { executionDefinition } = await import('./graph-contract.js')
    const { relayExecutionOutbox } = await import('./coordinator-outbox.js')
    const current = freshObservation('handoff-compatibility')
    recordEnvironmentObservation(current)
    const source = path.join(root, 'etc/cognitive-graphs/robot-autonomy-controller-mode.json')
    const sourceText = fs.readFileSync(source, 'utf8')
    const savedGraph = graph('robot-autonomy-controller')
    const currentDefinition = executionDefinition(savedGraph)
    const store = openExecutionStore(username)
    try {
      for (const change of ['runtime', 'schema', 'node', 'graph', 'during-decision']) {
        const definition = structuredClone(currentDefinition)
        if (change === 'runtime') definition.runtimeVersion = 'previous-executable'
        if (change === 'schema') definition.checkpointSchemaVersion++
        if (change === 'node') definition.nodeVersions.execution_context = 'previous-node-contract'
        const saved = store.enter(username, definition, randomUUID(), {
          graph: savedGraph, graphSource: source, context: { ...controllerContext(current), userMessage: objective },
        })
        const task = { objectiveId: randomUUID(), executionId: saved.executionId, objective,
          instruction: objective, completionCriteria: presetChoice().taskDecision.completionCriteria,
          decision: { outcome: 'continue' as const, reason: 'The target is not located.', objectiveComplete: false },
          source: 'autonomy', selectedAction: null, actionId: '', actionStatus: '', feedback: null,
          baselineFrame: null, updatedAt: new Date().toISOString() }
        const lease = store.claim(saved.executionId, definition)
        store.db.transaction(() => store.commitTransition(saved.executionId, 'fixture-checkpoint', {
          transitionId: 'fixture-objective', task,
        }))()
        store.settle(lease, 'waiting', 'operator_authorization')
        store.release(lease)
        const changeSource = () => fs.writeFileSync(source, JSON.stringify({ ...savedGraph,
          scheduler: { ...savedGraph.scheduler, maxLoopIterations: savedGraph.scheduler.maxLoopIterations + 1 } }))
        if (change === 'graph') changeSource()
        const before = store.get(saved.executionId)
        const message = `  A separate request with its exact spacing.\n${change}  `
        const callStart = calls.length
        if (change === 'during-decision') {
          replies.push(() => { changeSource(); return { ...routes, executionDisposition: 'steer', targetExecutionId: saved.executionId } })
        } else {
          replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
            { response: 'A new response.', actions: [], movementRequest: null, taskDecision: null })
        }
        const received = await run({ graph: graph('environment'), context: { ...context(current), userMessage: message } })
        const candidate = received.nodes.get('execution')?.outputs?.activeExecutions.find((item: any) => item.executionId === saved.executionId)
        assert.ok(candidate, 'Incompatible work remains visible, including its objective and original instruction')
        assert.equal(candidate.task.objective, objective)
        assert.equal(candidate.instruction, objective)
        assert.equal(candidate.canSteer, change === 'during-decision', 'Only a compatible saved execution is offered as steerable')
        if (change === 'during-decision') {
          assert.equal(received.status, 'failed', 'A definition changed during the decision cannot accept its handoff')
          assert.match(received.error!.message, /does not match/)
          assert.equal(calls.length, callStart + 1)
        } else {
          assert.match(candidate.resumeError, /does not match/)
          assert.equal(received.status, 'completed', received.error?.stack)
          assert.equal(calls.length, callStart + 2, 'A separate request keeps its existing router and selector calls')
          assert.equal(received.nodes.get('intent-orchestrator')?.outputs?.continueHere, true)
          assert.ok(JSON.stringify(calls[callStart].messages).includes(candidate.resumeError))
        }
        const { loadBufferForUser } = await import('../conversation-buffer.js')
        assert.ok(loadBufferForUser(username, 'conversation').messages.some(entry => entry.role === 'user' && entry.content === message))
        assert.deepEqual(store.get(saved.executionId), before, 'Inspection or rejected delivery does not retire or rekey the old execution')
        assert.deepEqual(store.task(saved.executionId), task)
        assert.equal(store.events(saved.executionId).length, 0, 'No steering or resume job is admitted to incompatible work')
        assert.equal(store.pendingDispatches().filter(effect => effect.executionId === saved.executionId).length, 0)
        assert.equal(replies.length, 0)

        if (change === 'runtime') {
          replies.push({ ...routes, executionDisposition: 'steer', targetExecutionId: saved.executionId })
          const declined = await run({ graph: graph('environment'), context: { ...context(current), userMessage: message } })
          assert.equal(declined.status, 'failed')
          assert.equal(declined.error?.message, candidate.resumeError, 'An invalid selection reports the actual incompatibility')
          assert.equal(store.events(saved.executionId).length, 0)
        }

        // Cancellation remains possible even though this definition cannot resume.
        replies.push({ ...routes, executionDisposition: 'cancel', targetExecutionId: saved.executionId,
          needsAction: false, needsEnvironment: false, needsVision: false },
        { response: 'That execution is cancelled.', actions: [], movementRequest: null, taskDecision: null })
        const cancelled = await run({ graph: graph('environment'), context: { ...context(current), userMessage: 'End that execution.' } })
        assert.equal(cancelled.status, 'completed', cancelled.error?.stack)
        assert.equal(store.get(saved.executionId).status, 'cancelled')
        const handoff = store.db.prepare('SELECT effect_id FROM execution_outbox WHERE execution_id=? AND kind=?')
          .get(cancelled.executionId, 'execution_event') as { effect_id: string }
        await relayExecutionOutbox(store, cancelled.executionId!, async input => manager.enqueue(input))
        assert.equal(store.event(saved.executionId, handoff.effect_id).kind, 'user_cancelled')
        assert.equal(store.events(saved.executionId).length, 1, 'Repeated delivery does not repeat cancellation')
        fs.writeFileSync(source, sourceText)
      }
      assert.equal(replies.length, 0)
    } finally { fs.writeFileSync(source, sourceText); store.close() }
  })
})

test('malformed Observer output fails its actual saved parent instead of silently completing the selected activity', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('observer-invalid')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(controllerChoice('boredom-observer'))
      const started = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const { action } = completeAction(current, 'captureImage', 'observer-invalid-after')
      const beforeCalls = calls.length
      replies.push('This is not a structured planner decision.')
      const resumed = await run({ graph: graph('robot-autonomy-controller'), context: controllerContext(current), executionId })
      assert.equal(resumed.status, 'failed', 'Malformed specialist output is a failure, not completed parent work')
      assert.match(resumed.error?.message ?? '', /Robot Operator.*JSON|planner.*invalid/i)
      assert.equal(calls.length, beforeCalls + 1)
      const store = openExecutionStore(username)
      try {
        assert.equal(store.get(executionId).status, 'failed')
        const effects = store.db.prepare('SELECT effect_id FROM execution_outbox WHERE execution_id=? AND action_id IS NOT NULL')
          .all(executionId) as { effect_id: string }[]
        assert.equal(effects.length, 1, 'No new physical action is staged after malformed observation planning')
        assert.equal(store.dispatch(effects[0].effect_id).actionId, action.id)
        assert.equal(store.events(executionId).filter(event => event.kind === 'physical_result' && event.actionId === action.id).length, 1)
      } finally { store.close() }
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0, 'No motion follows invalid observation planning')
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('a failed correction preserves its actual error without dispatch or fabricated objective completion', async () => {
  for (const entry of ['environment', 'robot-autonomy-controller']) await withUserContext(user, async () => {
    const current = freshObservation('selector-invalid')
    if (entry === 'robot-autonomy-controller') replies.push(controllerChoice('robot-autonomy-executor'))
    replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
      { response: 'The task is complete.', actions: [], movementRequest: null,
        taskDecision: { outcome: 'complete', objective,
          completionCriteria: 'Identify the target in visual evidence and report its location.',
          continuationPolicy: 'none', reason: 'Fixture malformed contract.', requiredCompletionBasis: 'not-a-supported-evidence-type' } },
      new Error('Controlled correction transport failure'))
    const result = await run({ graph: graph(entry), context: entry === 'environment' ? context(current) : controllerContext(current) })
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.message, 'Controlled correction transport failure', 'The old parser rejection must not hide a new failure')
    if (entry === 'environment') assert.equal(result.nodes.get('6')?.status, 'failed')
    assert.match(calls.at(-1)!.messages.at(-1).content, /taskDecision requiredCompletionBasis is not supported/)
    assert.equal(manager.getAllTasks().filter(task => task.durable?.executionId === result.executionId && task.type === 'environment_command').length, 0)
    const store = openExecutionStore(username)
    try {
      assert.equal(store.get(result.executionId!).status, 'failed')
      assert.equal(store.task(result.executionId!), null, 'A rejected completion claim cannot establish an objective')
    } finally { store.close() }
    assert.equal(replies.length, 0)
  })
})

test('saved Environment cancellation ends the identified Goal Review wait without another action', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-cancel')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', 'goal-cancel-after')
      replies.push(incompleteActionReview(), goalReview('request_user'))
      const waiting = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(waiting.status, 'waiting', waiting.error?.stack)
      const message = 'Cancel this search. I do not want to continue it.'
      replies.push({ ...routes, executionDisposition: 'cancel', targetExecutionId: executionId,
        needsEnvironment: false, needsVision: false, needsAction: false },
      { response: 'The search is cancelled.', actions: [], movementRequest: null, taskDecision: null })
      const cancelled = await run({ graph: graph('environment'), context: { ...context(current), userMessage: message } })
      assert.equal(cancelled.status, 'completed', cancelled.error?.stack)
      assert.equal(cancelled.nodes.get('execution-input-out')?.outputs?.sent, true)
      const store = openExecutionStore(username)
      try {
        assert.equal(store.get(executionId).status, 'cancelled')
        const event = store.events(executionId).find(event => event.kind === 'user_cancelled')
        assert.equal((event?.payload as any)?.userMessage, message)
        assert.equal(store.pendingDispatches().filter(effect => effect.executionId === executionId).length, 0)
      } finally { store.close() }
      await assert.rejects(runDurableGraph({ graph: graph('environment'), context: context(current), executionId }), /Execution cancelled/)
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('an autonomy event at a user-origin Goal Review wait can select a non-robot specialist under that parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-autonomy-specialist')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', 'goal-autonomy-specialist-after')
      replies.push(incompleteActionReview(), goalReview('wait'))
      const waiting = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(waiting.status, 'waiting', waiting.error?.stack)
      await signalExecution(executionId)
      replies.push({ ...controllerChoice('daydreamer'), reason: 'The ongoing objective is waiting on new information; a private daydream is relevant meanwhile.' })
      const resumed = await run({ graph: graph('environment'), context: context(current), executionId })
      const jobs = manager.getAllTasks().filter(task => task.durable?.executionId === executionId && task.handler === 'agent.daydreamer')
      assert.equal(jobs.length, 1, 'Continuation input must supply the Controller admission context for its chosen finite agent')
      assert.equal(resumed.status, 'waiting', resumed.error?.stack)
      const after = openExecutionStore(username)
      try {
        assert.equal(after.task(executionId)?.objective, objective)
        assert.equal(after.task(executionId)?.decision.objectiveComplete, false)
        assert.equal(after.get(executionId).waitingReason, 'agent_result')
      } finally { after.close() }
      seedDaydreamMemories()
      const specialist = jobs[0]
      assert.ok(manager.claim(specialist.id))
      replies.push('I imagine the observations becoming a small map made from shifting colors.')
      const child = await withGraphWork(specialist, id => manager.attachExecution(specialist.id, id), () => runGraph({
        graph: graph('daydreamer'), context: { username, userId: username, cognitiveMode: 'agent',
          allowMemoryWrites: true, idempotencyKey: `daydreamer:${username}:${specialist.id}`, memoryTimestamp: specialist.createdAt },
      }), async input => manager.enqueue(input))
      assert.equal(child.status, 'completed', child.error?.stack)
      assert.equal(child.executionId, executionId)
      manager.complete(specialist.id, true, { daydreamsGenerated: 1, memoriesCurated: 3 })
      await deliverDurableWorkReceipt(manager.getTask(specialist.id)!, async input => manager.enqueue(input))
      const beforeReview = calls.length
      replies.push(goalReview('wait'))
      const returned = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(returned.status, 'waiting', 'Finishing a specialist does not complete the waiting objective')
      assert.equal(calls.length, beforeReview + 1, 'Goal Review considers the returned activity once')
      assert.ok(JSON.stringify(calls.at(-1)?.messages).includes('work_result'), 'Review receives the correlated finite-work result')
      assert.ok(JSON.stringify(calls.at(-1)?.messages).includes('daydreamsGenerated'), 'Review receives the specialist output, not just its name')
      assert.ok(JSON.stringify(calls.at(-1)?.messages).includes('a small map made from shifting colors'), 'Review receives the specialist graph return as well as its process receipt')
      assert.ok(JSON.stringify(calls.at(-1)?.messages).includes(objective), 'Review retains the original objective beside the new result')
      const retained = openExecutionStore(username)
      try {
        assert.equal(retained.task(executionId)?.objective, objective)
        assert.equal(retained.task(executionId)?.decision.objectiveComplete, false)
        assert.equal(retained.get(executionId).waitingReason, 'user_or_autonomy')
        assert.equal(retained.events(executionId).filter(event => event.kind === 'work_result').length, 1)
      } finally { retained.close() }
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('a Controller speech-only choice after Goal Review wait does not finish the unfinished objective', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-autonomy-none')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = connectAdapter(current.sessionId!)
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      completeAction(current, 'robotCommand', 'goal-autonomy-none-after')
      replies.push(incompleteActionReview(), goalReview('wait'))
      const waiting = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(waiting.status, 'waiting', waiting.error?.stack)
      const store = openExecutionStore(username)
      let objectiveId: string
      try {
        objectiveId = store.task(executionId)!.objectiveId
      } finally { store.close() }
      await signalExecution(executionId)
      replies.push({ response: 'I am considering the observations while the search remains open.', taskId: 'none',
        reason: 'The present information does not support another useful action right now.',
        observationSummary: 'The target has not been located in the available observations.', instruction: '' }, goalReview('wait'))
      const resumed = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(resumed.status, 'waiting', 'Choosing no downstream activity must not silently terminate an unfinished objective')
      const after = openExecutionStore(username)
      try {
        assert.equal(after.task(executionId)?.objectiveId, objectiveId)
        assert.equal(after.task(executionId)?.decision.objectiveComplete, false)
        assert.equal(after.get(executionId).status, 'waiting')
        assert.equal(after.get(executionId).waitingReason, 'user_or_autonomy')
      } finally { after.close() }
      assert.equal(takeAdapterActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

for (const satisfied of [true, false]) test(`Desire robot steps stop at outcome review when step evidence is ${satisfied ? 'satisfied' : 'unsatisfied'}`, async () => {
  await withUserContext(user, async () => {
    const { saveDesire, loadDesire } = await import('../agency/storage.js')
    const { initializeDesireMetrics } = await import('../agency/types.js')
    setEnvironmentBridgeEnabled(true)
    const current = freshObservation(`desire-finite-${satisfied}`)
    const unsubscribe = connectAdapter(current.sessionId!)
    const id = `desire-${Date.now()}-finite`
    const plan = { id: `${id}-plan`, version: 1, completionCriteria: 'Two inspected areas are documented with returned observations.',
      steps: [1, 2].map(order => ({ order, action: `Inspect area ${order}.`, executionTarget: 'robot' as const,
        expectedOutcome: `Area ${order} is documented in a returned observation.`, risk: 'low' as const, requiresApproval: true })),
      estimatedRisk: 'low' as const, requiredSkills: [], requiredTrustLevel: 'suggest' as const,
      operatorGoal: 'Inspect two areas and stop.', createdAt: new Date().toISOString() }
    const desire = {
      id, title: 'Document two areas', description: 'Produce two observations', reason: 'A finite requested inspection',
      source: 'user_request' as const, strength: 1, baseWeight: 1, threshold: 0.7, decayRate: 0.03,
      lastReviewedAt: new Date().toISOString(), reinforcements: 1, runCount: 1, risk: 'low' as const,
      requiredTrustLevel: 'suggest' as const, status: 'executing' as const, metrics: initializeDesireMetrics(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), plan,
      review: { id: `${id}-review`, verdict: 'approve' as const, planId: plan.id, planVersion: plan.version,
        reasoning: 'The user approved this bounded inspection.', riskAssessment: 'Low risk', alignmentScore: 1,
        reviewedAt: new Date().toISOString(), autoApprove: false },
      execution: { startedAt: new Date().toISOString(), status: 'in_progress' as const,
        planId: plan.id, planVersion: plan.version, stepsCompleted: 0, stepsTotal: 2, stepResults: [] },
    }
    const workflow = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(path.join(root, 'etc/cognitive-graphs/desire-executor.json'), 'utf8')))
    try {
      await saveDesire(desire, username)
      recordEnvironmentObservation(current)
      replies.push(routes, presetChoice())
      const alteredInput = structuredClone(desire)
      alteredInput.plan.steps[0].action = 'Unreviewed motion style inserted into a graph input'
      const first = await run({ graph: workflow, context: { ...context(current), userMessage: '', desire: alteredInput } })
      assert.equal(first.status, 'waiting', first.error?.stack)
      const executionId = first.executionId!
      const firstReceipt = completeAction(current, 'robotCommand', 'desire-area-one')
      replies.push(satisfied ? completionReview() : incompleteActionReview())
      if (satisfied) replies.push(routes, presetChoice())
      const second = await run({ graph: workflow, executionId, context: { ...context(firstReceipt.after), userMessage: '', desire } })
      const afterFirst = await loadDesire(id, username)
      assert.equal(afterFirst?.execution?.stepResults?.length, 1, 'The first receipt is durably retained across the next wait')
      if (satisfied) {
        assert.equal(second.status, 'waiting', second.error?.stack)
        const secondReceipt = completeAction(firstReceipt.after, 'robotCommand', 'desire-area-two')
        replies.push(completionReview())
        const end = await run({ graph: workflow, executionId, context: { ...context(secondReceipt.after), userMessage: '', desire } })
        assert.equal(end.status, 'waiting', end.error?.stack)
      } else {
        assert.equal(second.status, 'waiting', second.error?.stack)
        assert.equal(afterFirst?.execution?.status, 'failed')
      }
      const waiting = openExecutionStore(username)
      try { assert.equal(waiting.get(executionId).waitingReason, 'effect_delivery', 'Only the admitted outcome review remains') }
      finally { waiting.close() }
      const saved = await loadDesire(id, username)
      assert.equal(saved?.status, 'awaiting_review', 'Action completion is distinct from desire satisfaction')
      assert.equal(saved?.execution?.executionId, executionId)
      assert.equal(saved?.execution?.planVersion, 1)
      const executedSteps = satisfied ? plan.steps : [plan.steps[0]]
      assert.deepEqual(saved?.execution?.stepResults?.map(result => result.stepOrder), executedSteps.map(step => step.order))
      const facts = saved?.execution?.stepResults?.map(result => (result.result as any).task)
      assert.deepEqual(facts?.map(task => task.desireId), executedSteps.map(() => id))
      assert.deepEqual(facts?.map(task => task.desireStepOrder), executedSteps.map(step => step.order))
      assert.deepEqual(facts?.map(task => task.completionCriteria), executedSteps.map(step => step.expectedOutcome))
      assert.deepEqual(facts?.map(task => task.objective), executedSteps.map(step => step.action), 'Stored reviewed instructions own execution')
      assert.equal(new Set(facts?.map(task => task.actionId)).size, executedSteps.length)
      assert.equal(takeAdapterActions(current.sessionId!).length, 0, 'No action is admitted after the plan finishes or a step fails')
      assert.equal(replies.length, 0, 'No general Goal Review model call follows an Agency-owned step')
      const reviews = manager.getAllTasks().filter(task => task.input.desireId === id && task.handler === 'agency.desire-outcome-review')
      assert.equal(reviews.length, 1, 'Durable graph finalization admits one review through Desire Agent')
      assert.equal(reviews[0].input.triggeredBy, 'desire-agent')
      assert.ok(manager.claim(reviews[0].id))
      replies.push({ verdict: 'completed', reasoning: 'Both recorded step observations meet the reviewed criteria.',
        successScore: 1, failureCategory: 'none', isFixableBug: false, notifyUser: false,
        lessonsLearned: [], completionCriteriaMet: true })
      const { reviewDesireOutcomeViaGraph } = await import('../agency/executor.js')
      const reviewed = await withGraphWork(reviews[0], execution => manager.attachExecution(reviews[0].id, execution),
        () => reviewDesireOutcomeViaGraph(saved!, username), async input => manager.enqueue(input))
      assert.equal(reviewed.success, true, reviewed.error)
      manager.complete(reviews[0].id, true, reviewed)
      await deliverDurableWorkReceipt(manager.getTask(reviews[0].id)!, async input => manager.enqueue(input))
      const settled = await run({ graph: workflow, executionId, context: { username, userId: username } })
      assert.equal(settled.status, 'completed', settled.error?.stack)
      assert.equal((await loadDesire(id, username))?.status, satisfied ? 'completed' : 'needs_attention',
        'A completion claim cannot overrule an unsatisfied robot receipt')
      assert.equal(replies.length, 0)
      assert.equal(takeAdapterActions(current.sessionId!).length, 0)

    } finally { unsubscribe() }
  })
})

test('reduced inhibition admits a finite plan while uncertain external results are never replayed', async () => {
  await withUserContext(user, async () => {
    const { DEFAULT_AGENCY_CONFIG, canAutoApprove } = await import('../agency/config.js')
    const { initializeDesireMetrics } = await import('../agency/types.js')
    const { saveDesire, loadDesire, saveAgencyConfig } = await import('../agency/storage.js')
    const { registerBackend } = await import('../escalation-backend.js')
    const { DesireExecutorNode } = await import('../nodes/agency/desire-executor.node.js')
    const config = structuredClone(DEFAULT_AGENCY_CONFIG)
    config.mode = 'autonomous'
    config.execution.preferredBackend = 'desire-fixture'
    config.execution.fallbackBackend = 'desire-fixture'
    await saveAgencyConfig(config, username)
    let attempts = 0
    registerBackend({
      id: 'desire-fixture', name: 'Controlled Desire backend', description: 'Never invokes external tools',
      isAvailable: async () => true, isReady: () => true, start: async () => true,
      stop: () => {}, supportsStreaming: false,
      execute: async () => {
        attempts++
        return { success: false, output: 'The request began but its final result is unavailable.', error: 'Response timeout' }
      },
    })
    const now = new Date().toISOString()
    const plan = { id: 'finite-external-plan', version: 1, completionCriteria: 'A report references the two supplied notes.',
      steps: [{ order: 1, action: 'Write the report.', expectedOutcome: 'The report is saved with references.',
        executionTarget: 'operator' as const, risk: 'low' as const, requiresApproval: false }],
      estimatedRisk: 'low' as const, requiredSkills: [], requiredTrustLevel: 'suggest' as const,
      operatorGoal: 'Save one report and stop.', createdAt: now }
    const desire = {
      id: 'desire-finite-external', title: 'Write a referenced report', description: 'A report of supplied notes', reason: 'Requested report',
      source: 'user_request' as const, strength: 0.99, baseWeight: 1, threshold: 0.7, decayRate: 0.03,
      lastReviewedAt: now, reinforcements: 5, runCount: 5, risk: 'low' as const, requiredTrustLevel: 'suggest' as const,
      status: 'executing' as const, metrics: initializeDesireMetrics(), createdAt: now, updatedAt: now, plan,
      review: { id: 'finite-external-review', verdict: 'approve' as const, planId: plan.id, planVersion: 1,
        reasoning: 'A bounded low-risk report passed review.', riskAssessment: 'Low risk', alignmentScore: 1,
        reviewedAt: now, autoApprove: true },
      execution: { startedAt: now, status: 'in_progress' as const, planId: plan.id, planVersion: 1,
        stepsCompleted: 0, stepsTotal: 1, stepResults: [] },
    }
    const approval = await canAutoApprove('low', desire.strength, 'suggest', username, desire)
    assert.equal(approval.autoApprove, true, approval.reason)
    assert.equal(approval.trustDegradation?.reduction, 2)
    assert.equal((await canAutoApprove('low', 0.8, 'suggest', username, desire)).autoApprove, false)
    await saveDesire(desire, username)
    const workflow = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(path.join(root, 'etc/cognitive-graphs/desire-executor.json'), 'utf8')))
    const result = await run({ graph: workflow, context: { username, userId: username, desire } })
    assert.equal(result.status, 'waiting', result.error?.stack)
    const executionId = result.executionId!
    assert.equal((await loadDesire(desire.id, username))?.execution?.status, 'outcome_unknown')
    await run({ graph: workflow, executionId, context: { username, userId: username } })
    const originalInput = { ...desire, execution: { ...desire.execution, executionId } }
    const dispatches: any[] = []
    const replay = await DesireExecutorNode.execute({ desire: originalInput }, {
      username, graphExecution: { executionId, dispatch: (intent: any) => { dispatches.push(intent); return intent } } as any,
    }, {})
    assert.equal(replay.execution.status, 'outcome_unknown', 'Reusing a manifest receipt must preserve uncertainty')
    assert.equal(replay.desire.metrics.executionAttemptCount, 1)
    assert.equal(attempts, 1, 'Neither graph recovery nor manifest replay repeats the external attempt')
    const reviews = manager.getAllTasks().filter(task => task.input.desireId === desire.id && task.handler === 'agency.desire-outcome-review')
    assert.equal(reviews.length, 1)
    assert.equal(dispatches[0].payload.idempotencyKey, reviews[0].idempotencyKey)
    const { applyDesireOutcomeReview } = await import('../agency/desire-outcome-transition.js')
    const reviewed = await applyDesireOutcomeReview(replay.desire, {
      id: 'external-outcome', planId: plan.id, planVersion: 1, executionStartedAt: now,
      verdict: 'retry', reasoning: 'Try the report again.', successScore: 0, failureCategory: 'external_error',
      isFixableBug: false, lessonsLearned: [], notifyUser: true, reviewedAt: now, completionCriteriaMet: false,
    }, username)
    assert.equal(reviewed.desire.status, 'needs_attention', 'A model retry cannot resolve an unknown external outcome')
    assert.equal(reviewed.desire.metrics.outcomeRetryCount, 0)
    assert.equal(attempts, 1)
  })
})
test('standalone image interpretations reach the next Controller through configured observation nodes without extra model calls', async () => {
  await withUserContext(user, async () => {
    configureProvider()
    const current = freshObservation('visual-history')
    current.environmentId = 'visual-history-robot'
    recordEnvironmentObservation(current)
    const beforeCalls = calls.length
    const interpretation = { summary: 'A red object is beside a chair.', frameIds: [current.visual!.id], uncertainties: ['Its identity is unknown.'] }
    replies.push({ ...routes, needsAction: false }, { response: '', actions: [], movementRequest: null,
      taskDecision: null, visualObservation: interpretation })
    const first = await run({ graph: graph('environment'), context: { ...context(current), userMessage: 'Describe the scene privately.' } })
    assert.equal(first.status, 'completed', first.error?.stack)
    assert.equal(calls.length, beforeCalls + 2, 'Routing and the existing selector only')
    assert.equal(first.nodes.get('save-observation')?.status, 'completed')
    assert.equal(first.nodes.get('action-results')?.status, 'skipped')
    const saved = first.nodes.get('save-observation')!.outputs!.observation
    let store = openExecutionStore(username)
    assert.equal(store.task(first.executionId!), null)
    assert.ok(store.dispatches(first.executionId!).every(item => !['environment_command', 'tts'].includes(item.kind)))
    assert.equal(store.observationHistory(first.executionId!, { ...visualObservationSource(current), limit: 5 }).length, 1)
    store.close()
    assert.equal(loadRobotStatus(username)?.latestVisualObservation?.observationId, saved.observationId)

    const controller = graph('robot-autonomy-controller')
    controller.nodes.find(node => node.id === 'observation-history')!.data.properties.limit = 1
    const roundTripped = validateSvelteFlowGraph(JSON.parse(JSON.stringify(controller)))
    assert.equal(roundTripped.nodes.find(node => node.id === 'observation-history')!.data.properties.limit, 1)
    replies.push({ ...controllerChoice('none'), response: '', instruction: '',
      observationSummary: 'The previous interpretation remains useful context.' })
    const next = await run({ graph: roundTripped, context: controllerContext(current) })
    assert.equal(next.status, 'completed', next.error?.stack)
    assert.equal(calls.length, beforeCalls + 3, 'History retrieval adds no model call')
    const message = calls.at(-1)!.messages.find(message => message.role === 'user')
    const text = Array.isArray(message.content) ? message.content.find((part: any) => part.type === 'text').text : message.content
    const envelope = JSON.parse(text.slice(text.indexOf('{')))
    assert.deepEqual(envelope.observationHistory, [saved])
    assert.equal(next.nodes.get('save-observation')?.status, 'skipped', 'No observation is fabricated from narrative-only output')
    store = openExecutionStore(username)
    assert.deepEqual(store.frame(next.executionId!, current.visual!.id), current.visual)
    assert.equal(store.observationHistory(next.executionId!, { ...visualObservationSource(current), limit: 5 }).length, 1)
    store.close()
    const replay = await run({ graph: roundTripped, executionId: next.executionId, context: controllerContext(current) })
    assert.equal(replay.status, 'completed', replay.error?.stack)
    assert.equal(calls.length, beforeCalls + 3)
    assert.equal(replies.length, 0)
  })
})
