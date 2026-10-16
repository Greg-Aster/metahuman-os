import assert from 'node:assert/strict'
import { after, afterEach, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import type { EnvironmentCommandWork, EnvironmentObservation } from '../environment-interface/types.js'

// Real saved graphs, node implementations, router, SQLite and Coordinator.
// Only the provider/voice transport is replaced; all runtime files are isolated.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const restartRequest = process.env.METAHUMAN_GOAL_TEST_RESUME
  ? JSON.parse(fs.readFileSync(process.env.METAHUMAN_GOAL_TEST_RESUME, 'utf8'))
  : null
const root: string = restartRequest?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-goal-continuation-'))
assert.equal(path.dirname(root), os.tmpdir())
assert.ok(path.basename(root).startsWith('metahuman-goal-continuation-'))
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
afterEach(() => {
  replies.length = 0
  const store = openExecutionStore(username)
  try { for (const record of store.list(username)) {
    if (record.status === 'waiting') store.cancel(record.executionId, {eventId: randomUUID(), kind:'user_cancelled', payload:{reason:'Isolated test cleanup'}})
  } } finally { store.close() }
})
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
const { extractGraphOutput } = await import('../graph-runtime.js')
const { openExecutionStore } = await import('./storage.js')
const { withUserContext } = await import('../context.js')
const { getProfilePaths } = await import('../path-builder.js')
const { recordEnvironmentObservation, subscribeEnvironmentActions, dispatchEnvironmentActions,
  recordEnvironmentActionResult, publishEnvironmentObservation, setEnvironmentBridgeEnabled,
  dispatchEnvironmentVisualReads, recordEnvironmentVisualReadResult, getLatestEnvironmentVisual } = await import('../environment-interface/store.js')
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js')
const { invalidateModelCache } = await import('../model-resolver.js')
const username = 'workflow-fixture'
const { createUser } = await import('../users.js')
if (!restartRequest) createUser(username, 'fixture-only-password', 'owner')
const profile = getProfilePaths(username)
const { loadBufferForUser } = await import('../conversation-buffer.js')
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
  const roles = { orchestrator: 'fixture', persona: 'fixture', planner: 'fixture', psychotherapist: 'fixture', environmentActionSelector: 'fixture', environmentVision: 'fixture' }
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

function presetChoice() {
  return { program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'walk' } }] },
    taskDecision: { outcome: 'act', objective, completionCriteria: 'Identify the target in visual evidence and report its location.',
      reason: 'Inspect a different area.',
      requiredCompletionBasis: 'visual_observation', continuationPolicy: 'bounded' } }
}

function goalReview(outcome: 'wait' | 'request_user') {
  return { outcome, objective, completionCriteria: presetChoice().taskDecision.completionCriteria, reason: 'The current evidence does not yet establish the target location.',
    requiredCompletionBasis: 'visual_observation', observationSummary: 'The visible floor area does not contain the target.',
    completionEvidence: '' }
}

function goalCompletion(frameId: string) {
  return { outcome: 'complete', objective, completionCriteria: presetChoice().taskDecision.completionCriteria, reason: 'The returned image identifies the target and its location.',
    requiredCompletionBasis: 'visual_observation', observationSummary: `Target identified in ${frameId}.`,
    completionEvidence: `The target and its location are visible in ${frameId}.` }
}

const adapterActions = new Map<string, EnvironmentCommandWork[]>()
function connectAdapter(sessionId: string, cameraError?: string) {
  setEnvironmentBridgeEnabled(true)
  assert.equal(adapterActions.has(sessionId), false, 'Each fixture body has one accepting adapter')
  const received: EnvironmentCommandWork[] = []
  adapterActions.set(sessionId, received)
  // Like the SSE adapter, claim at admission notification rather than after the
  // entire parent graph unwinds. Command deadlines still apply at this boundary.
  const dispatch = () => {
    received.push(...dispatchEnvironmentActions(sessionId, 10))
    for (const request of dispatchEnvironmentVisualReads(sessionId)) {
      recordEnvironmentVisualReadResult({ ...request, ...(cameraError ? { error: cameraError } : { visual: getLatestEnvironmentVisual(sessionId) ?? null }) })
    }
  }
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

function completeAction(current: EnvironmentObservation, expectedType: string, frameId: string, completion: 'completed' | 'failed' = 'completed') {
  const actions = takeAdapterActions(current.sessionId!, 10)
  assert.equal(actions.length, 1, 'Exactly one chosen physical effect should be dispatched')
  const action = actions[0]
  assert.equal(action.type, expectedType)
  const result = { id: randomUUID(), actionId: action.id, type: completion,
    timestamp: new Date().toISOString(), message: 'Fixture effect completed' }
  recordEnvironmentActionResult({ ...result, id: randomUUID(), type: 'accepted' })
  recordEnvironmentActionResult(result)
  const after: EnvironmentObservation = { ...current, timestamp: new Date().toISOString(),
    metadata: { actionId: action.id }, feedback: [result],
    visual: { ...observation.visual, id: frameId, timestamp: new Date().toISOString(), metadata: { actionId: action.id } } }
  publishEnvironmentObservation(after, { username })
  return { action, after }
}


// Use the current contracts and unchanged checked-in graph prompts.
const intent = (action = false, response = false) => ({ needsAction: action, needsResponse: response,
  needsToolUse: false, taskContext: ['executionContext', 'environment'], conversationContext: [] })
function snapshot(id: string) {
  const store = openExecutionStore(username)
  try { return { record: store.get(id), task: store.task(id), events: store.events(id) } }
  finally { store.close() }
}
async function settleReads(state: any, entry: string, ctx: any) {
  const consumed = new Set<string>()
  for (;;) {
    const read = manager.getHistory().find(w => w.handler === 'environment.visual-read'
      && w.durable?.executionId === state.executionId && !consumed.has(w.id))
    if (!read || state.status !== 'waiting') return state
    consumed.add(read.id)
    state = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx, executionId: state.executionId })
  }
}
async function settleSpeech(state: any, entry: string, ctx: any) {
  const work = manager.getAllTasks().find(w => w.handler === 'environment.conversation' && w.durable?.executionId === state.executionId && w.state === 'queued')
  if (!work) return state
  assert.ok(manager.claim(work.id))
  await (engine as any).execute(work)
  assert.equal(manager.getTask(work.id)?.state, 'completed', JSON.stringify(manager.getTask(work.id)?.error))
  return run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx, executionId: state.executionId })
}
async function probe(label: string, entry: string, action: boolean, response: boolean, taskDecision: any) {
  const current = { ...freshObservation(label), visual: undefined }
  recordEnvironmentObservation(current)
  setEnvironmentBridgeEnabled(true)
  const disconnect = connectAdapter(current.sessionId!)
  const request = taskDecision?.objective ?? 'How are you today?'
  const ctx = entry === 'environment' ? { ...context(current), userMessage: request } : {
    ...controllerContext(current), robotOperatorContext: {
      ...controllerContext(current).robotOperatorContext,
      plannerDecision: { observed: 'The target is not identified yet.', instruction: request, reason: 'Locate and report it.' },
    },
  }
  const choice = { taskDecision, program: action ? presetChoice().program : null }
  const needsTask = action || Boolean(taskDecision)
  replies.push(intent(needsTask, response))
  if (needsTask) replies.push(choice)
  if (response) replies.push('A fixture response.')
  if (!action && !response && taskDecision && !['wait', 'request_user'].includes(taskDecision.outcome)) replies.push(goalReview('wait'))
  let state = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx })
  assert.notEqual(state.status, 'failed', state.error?.stack)
  if (action) {
    const completed = completeAction(current, 'robotCommand', label + '-after')
    if (taskDecision.requiredCompletionBasis !== 'action_result') replies.push(goalReview('wait'))
    state = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: context(completed.after), executionId: state.executionId })
  }
  if (!action && response && taskDecision && !['wait', 'request_user'].includes(taskDecision.outcome)) replies.push(goalReview('wait'))
  state = await settleSpeech(state, entry, ctx)
  const saved = snapshot(state.executionId!)
  disconnect()
  return { state, saved, ctx, current }
}

if (restartRequest) {
  await withUserContext(user, async () => {
    replies.push(...restartRequest.replies)
    const result = await run({ graph: graph(restartRequest.graphName), context: { username, userId: username, environment:'server' }, executionId: restartRequest.executionId })
    fs.writeFileSync(restartRequest.output, JSON.stringify({status:result.status, error:result.error?.message, saved:snapshot(result.executionId!), calls}))
  })
  process.exit(0)
}

test('greeting has no durable goal or review call', async () => {
  await withUserContext(user, async () => {
    const before = calls.length
    const {state,saved} = await probe('greeting','environment',false,true,null)
    assert.equal(state.status,'completed')
    assert.equal(saved.task,null)
    assert.equal(state.nodes.get('review-remaining-objective')?.status,'skipped')
    assert.equal(calls.length - before, 2, 'Only Intent and Persona run for this conversation-only route')
  })
})
test('selected action and assessment return before one final Persona response is generated', async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation('final-result-join'), visual: undefined }
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const ctx = context(current)
      const before = calls.length
      replies.push(intent(true, true), presetChoice())
      let state = await run({ graph: graph('environment'), context: ctx })
      assert.equal(state.status, 'waiting', state.error?.stack)
      assert.equal(calls.length - before, 2, 'Persona cannot start while the selected action is outstanding')
      const { action } = completeAction(current, 'robotCommand', 'returned-result-frame')
      const assessment = goalCompletion('returned-result-frame')
      replies.push(assessment, 'The target is beside the fixture box.')
      state = await run({ graph: graph('environment'), context: ctx, executionId: state.executionId })
      assert.equal(calls.length - before, 3, 'Goal Review returns before queued conversation inference')
      state = await settleSpeech(state, 'environment', ctx)
      assert.equal(state.status, 'completed', state.error?.stack)
      assert.equal(calls.length - before, 4)
      const finalContext = JSON.stringify(calls.at(-1)!.messages)
      assert.ok(finalContext.includes('goalAssessment'))
      assert.ok(finalContext.includes(assessment.completionEvidence))
      assert.ok(finalContext.includes(action.id))
      assert.ok(finalContext.includes('Fixture effect completed'))
      assert.equal(loadBufferForUser(username, 'conversation').messages.filter(entry => entry.content === 'The target is beside the fixture box.').length, 1)
      assert.equal(snapshot(state.executionId!).task!.decision.objectiveComplete, true)
      assert.deepEqual(extractGraphOutput(state), state.nodes.get('conversation-result')!.outputs,
        'Conversation Out is the explicit output, not the task model JSON')
    } finally { disconnect() }
  })
})
test('Intent-selected reply conveys Goal Review request_user then genuinely waits', async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation('review-clarification'), visual: undefined }
    recordEnvironmentObservation(current)
    const ctx = context(current)
    replies.push(intent(true, true), { program: null, taskDecision: { ...presetChoice().taskDecision, outcome: 'continue' } },
      goalReview('request_user'), 'Which of the two targets do you mean?')
    let state = await run({ graph: graph('environment'), context: ctx })
    state = await settleSpeech(state, 'environment', ctx)
    assert.equal(state.status, 'waiting', state.error?.stack)
    assert.equal(snapshot(state.executionId!).record.waitingReason, 'user_or_autonomy')
    const before = calls.length
    state = await run({ graph: graph('environment'), context: ctx, executionId: state.executionId })
    assert.equal(state.status, 'waiting', state.error?.stack)
    assert.equal(calls.length, before)
    assert.equal(loadBufferForUser(username, 'conversation').messages.filter(entry => entry.content === 'Which of the two targets do you mean?').length, 1)
  })
})
test('finite action-result goal completes without Goal Review', async () => {
  await withUserContext(user, async () => {
    const begin=calls.length
    const {state,saved}=await probe('finite-action','environment',true,false,{...presetChoice().taskDecision,objective:'Walk forward once.',completionCriteria:'The walk completes.',requiredCompletionBasis:'action_result',continuationPolicy:'none'})
    assert.equal(state.status,'completed',state.error?.stack)
    assert.equal(saved.task?.decision.objectiveComplete,true)
    assert.equal(calls.length-begin,2)
    assert.equal(state.nodes.get('review-remaining-objective')?.status,'skipped')
  })
})
test('a conversational objective waiting for user input remains persisted', async () => {
  await withUserContext(user, async () => {
    const {state,saved}=await probe('user-input-goal','environment',false,false,{...presetChoice().taskDecision,objective:'Keep an ongoing conversation with me.',completionCriteria:'The participant concludes the conversation.',outcome:'request_user',requiredCompletionBasis:'user_input',continuationPolicy:'none'})
    assert.equal(state.status,'waiting',state.error?.stack)
    assert.equal(saved.task?.decision.objectiveComplete,false)
    assert.equal(saved.record.waitingReason,'user_or_autonomy')
  })
})
for (const entry of ['environment', 'autonomy']) test(`${entry}: unfinished goal without an action stays eligible for continuation`, async () => {
  await withUserContext(user, async () => {
    const start = calls.length
    const {state,saved,ctx} = await probe('nonphysical-goal',entry,false,false,{...presetChoice().taskDecision,outcome:'continue',continuationPolicy:'none'})
    assert.equal(saved.task?.decision.objectiveComplete,false)
    assert.equal(state.status,'waiting','An unfinished selected goal must remain available to the Full Auto continuation owner')
    assert.equal(calls.length - start, 3, 'The unfinished task is assessed once; the reviewer explicitly selects wait')
    const before = calls.length
    const stillWaiting = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx, executionId: state.executionId })
    assert.equal(stillWaiting.status, 'waiting', stillWaiting.error?.stack)
    assert.equal(calls.length, before, 'Resuming without new input must not repeat model calls')
    assert.equal(snapshot(state.executionId!).task?.objectiveId, saved.task?.objectiveId)
  })
})
for (const firstAction of [false, true]) test(`Full Auto resumes a goal with preserved intent and history (firstAction=${firstAction})`, async () => {
  await withUserContext(user, async () => {
    const {state,saved,ctx,current} = await probe('continuing-goal','environment',firstAction,false,firstAction ? presetChoice().taskDecision : { ...presetChoice().taskDecision, outcome: 'continue' })
    assert.equal(state.status,'waiting')
    assert.equal(saved.record.waitingReason,'user_or_autonomy')
    const start = calls.length
    replies.push(controllerChoice('robot-autonomy-executor'),intent(true,false),presetChoice())
    await signalExecution(state.executionId!)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const next = await settleReads(await run({graph:graph('environment'),context:ctx,executionId:state.executionId}), 'environment', ctx)
      assert.notEqual(next.status,'failed',next.error?.stack)
      const beforeReceipt = snapshot(state.executionId!)
      assert.equal(beforeReceipt.task?.objectiveId,saved.task?.objectiveId)
      assert.equal(beforeReceipt.task?.instruction,saved.task?.instruction)
      assert.equal(beforeReceipt.task?.completionCriteria,saved.task?.completionCriteria)
      const controllerMessages = JSON.stringify(calls[start]?.messages)
      const taskMessages = JSON.stringify(calls[start+2]?.messages)
      assert.ok(controllerMessages.includes(saved.task!.objectiveId))
      if (firstAction) assert.ok(controllerMessages.includes(saved.task!.actionId))
      assert.ok(taskMessages.includes(saved.task!.objectiveId))
      if (firstAction) {
        assert.ok(taskMessages.includes(saved.task!.actionId))
        assert.ok(taskMessages.includes('Fixture effect completed'))
      }
      completeAction(current,'robotCommand','second-step-after')
      replies.push(goalCompletion('second-step-after'))
      const finished = await run({graph:graph('environment'),context:ctx,executionId:state.executionId})
      assert.equal(finished.status,'completed',finished.error?.stack)
      assert.equal(snapshot(state.executionId!).task?.decision.objectiveComplete,true)
      assert.equal(snapshot(state.executionId!).task?.objectiveId,saved.task?.objectiveId)
    } finally { disconnect() }
  })
})
for (const basis of ['visual_observation', 'environment_state']) test(`visual goal is assessed before its reply with no manufactured physical action (${basis})`, async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('image-answer')
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const ctx = { ...context(current), userMessage: 'Please tell me what you see' }
      const start = calls.length
      const answer = `The image shows the fixture target beside a blue box (${basis}).`
      replies.push({ ...intent(true, true), taskPlanner: 'vision', taskContext: ['environment', 'vision', 'executionContext'], conversationContext: ['vision'] },
        { program: null, taskDecision: { outcome: 'continue', objective: 'Locate the target in the attached image.',
          completionCriteria: 'Visual evidence identifies the target location.',
          reason: 'The attached frame provides enough visual evidence to answer the request.',
          requiredCompletionBasis: basis, continuationPolicy: 'none' } },
        goalCompletion(current.visual!.id), answer)
      let state = await settleReads(await run({ graph: graph('environment'), context: ctx }), 'environment', ctx)
      state = await settleSpeech(state, 'environment', ctx)
      assert.equal(state.status, 'completed', state.error?.stack)
      assert.equal(snapshot(state.executionId!).task?.decision.objectiveComplete, true)
      assert.equal(calls.length - start, 4, 'Intent, visual planner, one assessment and final conversation')
      const review = JSON.stringify(calls.at(-2)!.messages)
      assert.equal(review.includes(answer), false)
      assert.ok(review.includes(current.visual!.id))
      assert.ok(JSON.stringify(calls.at(-1)!.messages).includes('goalAssessment'))
      assert.deepEqual(takeAdapterActions(current.sessionId!), [], 'No physical action is manufactured for an answer')
    } finally { disconnect() }
  })
})

for (const entry of ['environment', 'autonomy']) test(`${entry}: unfinished assessment updates the goal without another plan or repeated reply`, async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation('assessment-only'), visual: undefined }
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const ctx = { ...context(current), userMessage: 'Please inspect the target' }
      const before = calls.length
      const assessment = goalReview('wait')
      replies.push(intent(true, true), { taskDecision: { ...presetChoice().taskDecision, outcome: 'continue' }, program: null },
        assessment, 'The target has not been identified in the available evidence.')
      let state = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx })
      const original = snapshot(state.executionId!).task!
      state = await settleSpeech(state, entry, ctx)
      assert.equal(state.status, 'waiting', state.error?.stack)
      const saved = snapshot(state.executionId!)
      assert.equal(saved.record.waitingReason, 'user_or_autonomy')
      assert.equal(saved.task!.objectiveId, original.objectiveId)
      assert.equal(saved.task!.decision.outcome, 'wait')
      assert.equal(saved.task!.decision.observationSummary, assessment.observationSummary)
      assert.equal(saved.task!.decision.objectiveComplete, false)
      assert.equal(calls.length - before, 4, 'Intent, Task, assessment and the Intent-selected final reply only')
      for (let i = 0; i < 2; i++) {
        state = await run({ graph: graph(entry === 'autonomy' ? 'environment' : entry), context: ctx, executionId: state.executionId })
        assert.equal(state.status, 'waiting', state.error?.stack)
      }
      assert.equal(calls.length - before, 4, 'No new input means no replanning or repeated response')
      assert.equal(loadBufferForUser(username, 'conversation').messages.filter(message =>
        message.content === 'The target has not been identified in the available evidence.'
        && message.meta?.executionId === state.executionId).length, 1)
      assert.deepEqual(takeAdapterActions(current.sessionId!), [])
    } finally { disconnect() }
  })
})

for (const outcome of ['wait', 'abandon'] as const) test(`Goal Review can revise or retire a goal without executing work (${outcome})`, async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation(`goal-revision-${outcome}`), visual: undefined }
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const before = calls.length
      replies.push(intent(true, false), presetChoice())
      const ctx = context(current)
      let state = await run({ graph: graph('environment'), context: ctx })
      const original = snapshot(state.executionId!).task!
      const { action } = completeAction(current, 'robotCommand', 'goal-revision-result')
      const assessment = { ...goalReview('wait'), outcome,
        objective: 'Identify the fixture target beside the doorway.',
        completionCriteria: 'A current frame identifies the target beside the doorway.',
        reason: outcome === 'abandon' ? 'The supplied correction withdraws this goal.' : 'The recorded result narrows the search area.' }
      replies.push(assessment)
      state = await run({ graph: graph('environment'), context: ctx, executionId: state.executionId })
      assert.equal(state.status, outcome === 'abandon' ? 'completed' : 'waiting', state.error?.stack)
      const saved = snapshot(state.executionId!)
      assert.equal(saved.task!.objectiveId, original.objectiveId)
      assert.equal(saved.task!.instruction, original.instruction)
      assert.equal(saved.task!.source, original.source)
      assert.equal(saved.task!.objective, assessment.objective)
      assert.equal(saved.task!.completionCriteria, assessment.completionCriteria)
      assert.equal(saved.task!.decision.outcome, outcome)
      assert.equal(saved.task!.decision.objectiveComplete, false, 'Abandonment is not success')
      assert.equal(saved.task!.actionId, action.id)
      assert.equal(saved.task!.feedback?.type, 'completed')
      assert.ok(saved.events.some(event => JSON.stringify(event.payload).includes(action.id)), 'Recorded action evidence remains available')
      const { loadRobotStatus } = await import('../robot-status.js')
      const status = loadRobotStatus(username)!
      assert.equal(status.situation.currentGoal, outcome === 'abandon' ? '' : assessment.objective)
      assert.equal(calls.length - before, 3, 'Assessment does not start another planner or a reply')
      assert.deepEqual(takeAdapterActions(current.sessionId!), [])
      if (outcome === 'wait') {
        replies.push(controllerChoice('none'))
        await signalExecution(state.executionId!)
        await settleReads(await run({ graph: graph('environment'), context: ctx, executionId: state.executionId }), 'environment', ctx)
        const received = JSON.stringify(calls[before + 3]?.messages)
        assert.ok(received.includes(assessment.objective), 'Independently triggered Full Auto receives the revised goal')
        assert.ok(received.includes(assessment.completionCriteria))
        assert.ok(received.includes(original.instruction))
        assert.ok(received.includes(action.id))
      }
    } finally { disconnect() }
  })
})

test('failed camera read reports failure rather than waiting for user input or inventing completion', async () => {
  await withUserContext(user, async () => {
    const current = freshObservation('camera-failure')
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!, 'Fixture camera disconnected')
    try {
      replies.push({ ...intent(true, true), taskPlanner: 'vision', taskContext: ['vision'], conversationContext: ['vision'] })
      const ctx = { ...context(current), userMessage: 'Please tell me what you see' }
      const state = await settleReads(await run({ graph: graph('environment'), context: ctx }), 'environment', ctx)
      assert.equal(state.status, 'failed')
      assert.match(state.error!.message, /Fixture camera disconnected/)
      assert.equal(snapshot(state.executionId!).record.status, 'failed')
      assert.deepEqual(takeAdapterActions(current.sessionId!), [])
    } finally { disconnect() }
  })
})

test('an incomplete action assessment records its receipt without dispatching another action', async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation('assessment-after-action'), visual: undefined }
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const before = calls.length
      replies.push(intent(true, false), presetChoice())
      const ctx = context(current)
      let state = await run({ graph: graph('environment'), context: ctx })
      const original = snapshot(state.executionId!).task!
      const first = completeAction(current, 'robotCommand', 'first-step')
      replies.push(goalReview('wait'))
      state = await run({ graph: graph('environment'), context: ctx, executionId: state.executionId })
      assert.equal(state.status, 'waiting', state.error?.stack)
      const next = snapshot(state.executionId!).task!
      assert.equal(next.objectiveId, original.objectiveId)
      assert.equal(next.actionId, first.action.id)
      assert.equal(next.feedback?.type, 'completed')
      assert.equal(next.decision.objectiveComplete, false)
      assert.equal(calls.length - before, 3, 'Review does not call Intent or Task again')
      assert.deepEqual(takeAdapterActions(current.sessionId!), [])
    } finally { disconnect() }
  })
})

test('restart joins a saved answer after assessment without repeating either model call', async () => {
  await withUserContext(user, async () => {
    const current = { ...freshObservation('restart-answer'), visual: undefined }
    recordEnvironmentObservation(current)
    const disconnect = connectAdapter(current.sessionId!)
    try {
      const ctx = { ...context(current), userMessage: 'Please tell me what you see' }
      replies.push(intent(true, true), { program: null, taskDecision: { ...presetChoice().taskDecision,
        outcome: 'continue', requiredCompletionBasis: 'action_result', continuationPolicy: 'none' } },
        goalCompletion('recorded observation'), 'Saved description from the available observation.')
      const started = await run({ graph: graph('environment'), context: ctx })
      const conversation = manager.getAllTasks().find(work => work.handler === 'environment.conversation'
        && work.durable?.executionId === started.executionId)!
      assert.ok(manager.claim(conversation.id))
      await (engine as any).execute(conversation)
      assert.equal(manager.getTask(conversation.id)?.state, 'completed')
      const requestPath = path.join(root, 'restart-answer-probe.json'), output = path.join(root, 'restart-answer-result.json')
      fs.writeFileSync(requestPath, JSON.stringify({ root, graphName: 'environment', executionId: started.executionId,
        replies: [], output }))
      const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(import.meta.url)],
        { cwd: repo, env: { ...process.env, METAHUMAN_GOAL_TEST_RESUME: requestPath }, encoding: 'utf8', timeout: 30000 })
      assert.equal(child.status, 0, child.stderr)
      const result = JSON.parse(fs.readFileSync(output, 'utf8'))
      assert.equal(result.status, 'completed', result.error)
      assert.equal(result.calls.length, 0, 'Both completed model results survive restart')
      assert.equal(result.saved.task.decision.objectiveComplete, true)
      assert.equal(loadBufferForUser(username, 'conversation').messages.filter(entry => entry.content === 'Saved description from the available observation.').length, 1)
    } finally { disconnect() }
  })
})

test('fresh process restores the goal and receipt then runs only its pending review', async () => {
  await withUserContext(user, async () => {
    const current={...freshObservation('restart-goal'),visual:undefined}
    recordEnvironmentObservation(current)
    setEnvironmentBridgeEnabled(true)
    const disconnect=connectAdapter(current.sessionId!)
    try {
      replies.push(intent(true,false),presetChoice())
      const started=await run({graph:graph('environment'),context:context(current)})
      assert.equal(started.status,'waiting',started.error?.stack)
      const saved=snapshot(started.executionId!)
      completeAction(current,'robotCommand','restart-after')
      const requestPath=path.join(root,'restart-probe.json'), output=path.join(root,'restart-result.json')
      fs.writeFileSync(requestPath,JSON.stringify({root,graphName:'environment',executionId:started.executionId,replies:[goalReview('wait')],output}))
      const child=spawnSync(process.execPath,['--experimental-test-module-mocks','--import','tsx',fileURLToPath(import.meta.url)],{cwd:repo,env:{...process.env,METAHUMAN_GOAL_TEST_RESUME:requestPath},encoding:'utf8',timeout:30000})
      fs.writeFileSync(path.join(root,'restart-probe.log'),child.stdout+child.stderr)
      assert.equal(child.status,0,child.stderr)
      const result=JSON.parse(fs.readFileSync(output,'utf8'))
      assert.equal(result.status,'waiting',result.error)
      assert.equal(result.saved.task.objectiveId,saved.task!.objectiveId)
      assert.equal(result.saved.task.instruction,saved.task!.instruction)
      assert.equal(result.saved.task.feedback.type,'completed')
      assert.equal(result.calls.length,1,'Only pending Goal Review should call the fixture model')
    } finally {disconnect()}
  })
})
after(() => {
  eventBus.disconnect()
  mock.restoreAll()
  fs.rmSync(root, { recursive: true, force: true })
})
