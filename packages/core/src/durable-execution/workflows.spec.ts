import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { EnvironmentObservation } from '../environment-interface/types.js'

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
    const reply = replies.shift()
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
const user = { username, userId: username, role: 'owner' }
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
  needsRobotStatus: true, needsEnvironment: true, needsVision: true, needsAction: true, needsTaskLifecycle: true,
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
  userMessage: objective, cognitiveMode: 'environment', environment: 'server', operatorMode: 'full',
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
    taskDecision: { outcome: 'act', objective, objectiveComplete: false, reason: 'Inspect a different area.',
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
    completionEvidence: '', nextInstruction: outcome === 'continue' ? 'Inspect the adjacent area to locate the same fixture target.' : '' }
}

function completeAction(current: EnvironmentObservation, expectedType: string, frameId: string) {
  const actions = dispatchEnvironmentActions(current.sessionId!, 10)
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
    const unsubscribe = subscribeEnvironmentActions(observation.sessionId, () => {})
    try {
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false, needsTaskLifecycle: false },
        { response: 'I am here with you.', actions: [], movementRequest: null, taskDecision: null })
      const conversational = await run({ graph: graph('environment'), context: { ...context(), userMessage: 'How are you?' } })
      assert.equal(conversational.status, 'completed', conversational.error?.stack)
      assert.equal(conversational.nodes.get('action-results')?.status, 'skipped')
      assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command').length, 0)
      assert.equal(calls.length, 2)
      assert.equal(calls[0].provider, 'ollama')
      assert.equal(calls[0].options.model, 'fixture-model')

      replies.push(routes, { response: 'I will look in the adjacent area.',
        actions: [{ type: 'robotCommand', command: 'walk' }], movementRequest: null,
        taskDecision: { outcome: 'act', objective, objectiveComplete: false, reason: 'Inspect a different area.',
          requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded' } })
      const started = await run({ graph: graph('environment'), context: context() })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      let store = openExecutionStore(username)
      assert.equal(store.task(executionId)?.objective, objective)
      assert.match(store.task(executionId)!.objectiveId, /^[a-f0-9-]{36}$/)
      store.close()
      const [action] = dispatchEnvironmentActions(observation.sessionId, 1)
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
      replies.push({ response: '', taskDecision: { overallObjectiveState: 'not_achieved',
        reason: 'The move completed; the search still needs review.', requiredCompletionBasis: 'visual_observation',
        observationSummary: 'A new part of the floor is visible.', completionEvidence: '' } },
        { response: 'The target is on the floor.', outcome: 'complete',
          reason: 'The supplied after-action image contains the fixture target.', requiredCompletionBasis: 'visual_observation',
          observationSummary: 'The target is visible.', completionEvidence: 'The target in fixture-after.', nextInstruction: '' })
      const resumed = await run({ graph: graph('environment'), context: context(), executionId })
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
      assert.equal(calls.length, beforeResumeCalls + 2, 'Only action-result and goal-review inference should run after resumption')
      store = openExecutionStore(username)
      assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
      assert.equal(store.task(executionId)?.objective, objective)
      assert.equal(store.frame(executionId, 'fixture-before')?.id, 'fixture-before')
      assert.equal(store.frame(executionId, 'fixture-after')?.id, 'fixture-after')
      assert.equal(loadRobotStatus(username)?.task?.executionId, executionId)
      assert.equal(loadRobotStatus(username)?.task?.decision.objectiveComplete, true)
      assert.equal(manager.getAllTasks().filter(task => task.type === 'environment_command').length, 0)
      store.close()
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Controller calls the real Executor and resumes its preset action under the same parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('controller-preset')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Controller selects Observer, waits for its image, then calls Executor without losing the parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('controller-observer')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
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
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
    try {
      const beforeCalls = calls.length
      const standing = { R1: '135', R2: '45', L1: '45', L2: '135', R4: '0', R3: '180', L3: '0', L4: '180' }
      const generated = { summary: 'Lift and lower a front limb.',
        frames: [{ durationMs: '600', ...standing, R3: '160' }, { durationMs: '600', ...standing }], endPose: 'stand' }
      replies.push(routes, { response: '', actions: [], movementRequest: { description: 'Lift and lower a front limb.' },
        taskDecision: { outcome: 'act', objective: 'Lift and lower a front limb.', objectiveComplete: false,
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
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
    replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false, needsTaskLifecycle: false },
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
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
    try {
      const beforeCalls = calls.length
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const [action] = dispatchEnvironmentActions(current.sessionId!, 1)
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('saved Environment reviews a rejected standalone action without requiring a nonexistent after-image', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('rejected-action')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
    try {
      const beforeCalls = calls.length
      replies.push({ ...routes, needsTaskLifecycle: false }, { ...presetChoice(), taskDecision: null })
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const [action] = dispatchEnvironmentActions(current.sessionId!, 1)
      assert.ok(action)
      recordEnvironmentActionResult({ id: randomUUID(), actionId: action.id, type: 'rejected',
        timestamp: new Date().toISOString(), message: 'The fixture adapter did not execute this action' })
      replies.push({ response: 'The adapter rejected the movement before it started.', taskDecision: null })
      const finished = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(finished.status, 'completed', finished.error?.stack)
      assert.equal(calls.length, beforeCalls + 3, 'Only one action-result review is needed for a rejected standalone action')
      const store = openExecutionStore(username)
      try {
        assert.equal(store.task(executionId), null, 'A rejected standalone action must not create a goal')
        assert.equal(store.events(executionId).some(event => event.kind === 'observation_received'), false)
      } finally { store.close() }
      assert.equal(loadRobotStatus(username)?.lastAction?.status, 'rejected')
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('the same saved workflow follows a different profile-configured provider through the current model router', async () => {
  await withUserContext(user, async () => {
    const beforeCalls = calls.length
    configureProvider('openai', 'fixture-alternate-model')
    try {
      replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false, needsTaskLifecycle: false },
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
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
    assert.equal(work.input.robotOperatorContext.controllerDecision.instruction, 'Reflect imaginatively on the recent observations.')
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

test('saved Goal Review continues through the real Executor and reviews its next result in the same parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-continue')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
    try {
      replies.push(routes, presetChoice())
      const started = await run({ graph: graph('environment'), context: context(current) })
      assert.equal(started.status, 'waiting', started.error?.stack)
      const executionId = started.executionId!
      const initial = completeAction(current, 'robotCommand', 'goal-continue-first-after')
      const beforeReview = calls.length
      replies.push(incompleteActionReview(), goalReview('continue'), routes, presetChoice())
      const continuing = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(continuing.status, 'waiting', continuing.error?.stack)
      assert.equal(calls.length, beforeReview + 4, 'Action Result, Goal Review, intent and selection each execute once')
      const next = completeAction(initial.after, 'robotCommand', 'goal-continue-second-after')
      assert.notEqual(next.action.id, initial.action.id)
      assert.equal(next.action.executionId, executionId)
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

test('saved Environment admits user steering into the exact Goal Review wait and completion remains on that parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-steering')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
          taskDecision: { outcome: 'complete', objective, objectiveComplete: true,
            continuationPolicy: 'none',
            reason: 'The user reports finding the target.', requiredCompletionBasis: 'user_input',
            observationSummary: 'The user located the target beside the window.', completionEvidence: message } })
      const resumed = await run({ graph: graph('environment'), context: context(current), executionId })
      assert.equal(resumed.status, 'completed', resumed.error?.stack)
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

test('malformed Observer output fails its actual saved parent instead of silently completing the selected activity', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('observer-invalid')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0, 'No motion follows invalid observation planning')
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('malformed Environment selection fails without dispatch or a fabricated successful workflow', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('selector-invalid')
    replies.push({ ...routes, needsEnvironment: false, needsVision: false, needsAction: false },
      { response: 'The task is complete.', actions: [], movementRequest: null,
        taskDecision: { outcome: 'complete', objective, objectiveComplete: true,
          continuationPolicy: 'none', reason: 'Fixture malformed contract.', requiredCompletionBasis: 'not-a-supported-evidence-type' } })
    const result = await run({ graph: graph('environment'), context: context(current) })
    assert.equal(result.status, 'failed')
    assert.match(result.error?.message ?? '', /Environment Action Selector output is invalid/)
    assert.equal(result.nodes.get('6')?.status, 'failed')
    assert.equal(manager.getAllTasks().filter(task => task.durable?.executionId === result.executionId && task.type === 'environment_command').length, 0)
    const store = openExecutionStore(username)
    try { assert.equal(store.get(result.executionId!).status, 'failed') } finally { store.close() }
    assert.equal(replies.length, 0)
  })
})

test('saved Environment cancellation ends the identified Goal Review wait without another action', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-cancel')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
        needsEnvironment: false, needsVision: false, needsAction: false, needsTaskLifecycle: false },
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})

test('an autonomy event at a user-origin Goal Review wait can select a non-robot specialist under that parent', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('goal-autonomy-specialist')
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
    const unsubscribe = subscribeEnvironmentActions(current.sessionId!, () => {})
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
      assert.equal(dispatchEnvironmentActions(current.sessionId!, 10).length, 0)
      assert.equal(replies.length, 0)
    } finally { unsubscribe() }
  })
})
