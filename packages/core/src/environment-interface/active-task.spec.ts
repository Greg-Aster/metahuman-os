import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { after, mock, test } from 'node:test'
import type { EnvironmentObservation, EnvironmentCommandWork } from './types.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-active-task-'))
process.env.METAHUMAN_ROOT = root
const nativeFetch = globalThis.fetch
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const calls: any[] = []
const replies: any[] = []
const provider = await import('../providers/bridge.js')
mock.module(new URL('../providers/bridge.ts', import.meta.url).href, { namedExports: { ...provider,
  callProvider: async (provider: string, messages: any[], options: any) => {
    calls.push({ provider, messages, options })
    if (options.executionTarget === 'remote') return remoteProvider(provider as any, messages, options)
    assert.equal(provider, 'ollama')
    assert.equal(options.model, 'fixture-model')
    assert.ok(replies.length, 'Every model call needs an explicit fixture response')
    const reply = replies.shift()
    const result = typeof reply === 'function' ? await reply() : reply
    return { provider, model: options.model, content: JSON.stringify(result) }
  } } })
const voice = await import('../tts/robot-speech.js')
let speechDisabled = true
mock.module(new URL('../tts/robot-speech.ts', import.meta.url).href, { namedExports: { ...voice,
  getSpeechOutputSettings: () => ({ speechDisabled, outputTarget: 'local' }) } })
const core = await import('./index.js')
const { getQueueManager } = await import('../queue/unified-queue-manager.js')
const { ExecutionEngine } = await import('../queue/execution-engine.js')
const { runDurableGraph, withGraphWork } = await import('../durable-execution/runtime.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js')
const { getProfilePaths } = await import('../path-builder.js')
const { withUserContext } = await import('../context.js')
const { createDefaultPersonaFacetConfig } = await import('../persona-facets.js')
const { validateEnvironmentSelectorOutput } = await import('../nodes/environment/helpers.js')
const { identifyActiveTaskImage } = await import('./active-task.js')
const manager = getQueueManager()
const engine = new ExecutionEngine({}, manager)
const username = 'active-task-fixture'
const { createUser } = await import('../users.js')
createUser(username, 'fixture-only-password', 'owner')
const profile = getProfilePaths(username)
fs.mkdirSync(profile.etc, { recursive: true })
fs.mkdirSync(profile.persona, { recursive: true })
fs.writeFileSync(path.join(profile.persona, 'facets.json'), JSON.stringify(createDefaultPersonaFacetConfig()))
fs.writeFileSync(path.join(profile.persona, 'core.json'), JSON.stringify({ identity: { name: 'Fixture' },
  personality: { traits: [] }, values: [], goals: [], preferences: {}, communication: {} }))
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
fs.cpSync(path.join(repo, 'etc/cognitive-graphs'), path.join(root, 'etc/cognitive-graphs'), { recursive: true })
fs.copyFileSync(path.join(repo, 'etc/agents.json'), path.join(root, 'etc/agents.json'))
fs.copyFileSync(path.join(repo, 'etc/services.json'), path.join(root, 'etc/services.json'))
fs.writeFileSync(path.join(root, 'etc/llm-backend.json'), JSON.stringify({ activeBackend: 'ollama',
  remote: { provider: 'server', model: 'fixture-remote-vision' } }))
const remoteCalls: any[] = []
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/api/llm/chat')
    assert.equal(request.headers.cookie, 'mh_session=fixture-session')
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    remoteCalls.push(input)
    assert.equal(input.model, 'fixture-remote-vision')
    assert.equal(input.messages.at(-1).content.at(-1).type, 'image_url')
    assert.ok(replies.length)
    const reply = replies.shift()
    const result = typeof reply === 'function' ? await reply() : reply
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ model: 'fixture-remote-vision', message: { content: JSON.stringify(result) } }))
  } catch (error) { response.statusCode = 503; response.end(String(error)) }
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const serverUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
const forbiddenNetworkCalls: string[] = []
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith(`${serverUrl}/`)) {
    forbiddenNetworkCalls.push(String(url))
    throw new Error('Only the simulated remote backend may receive network requests')
  }
  return nativeFetch(url, options)
}
const { saveRemoteServerCredentials } = await import('../llm-config.js')
saveRemoteServerCredentials(username, serverUrl, 'fixture-session')
const remoteProvider = provider.callProvider
const roles = { orchestrator: 'fixture', environmentActionSelector: 'fixture', persona: 'fixture' }
fs.writeFileSync(path.join(profile.etc, 'models.json'), JSON.stringify({ version: '1', description: 'Isolated local task fixture', defaults: roles,
  cognitiveModeMappings: { environment: roles }, roleHierarchy: Object.fromEntries(Object.keys(roles).map(role => [role, ['fixture']])),
  models: { fixture: { provider: 'ollama', model: 'fixture-model', adapters: [], roles: Object.keys(roles),
    capabilities: ['text', 'image'], description: 'Fixture model transport', options: {} } } }))
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
  assert.deepEqual(forbiddenNetworkCalls, [], 'Remote work must never probe or fall back to a local inference backend')
})
test('remote perception uses the remote model even when the lightweight local role is text-only', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    replies.push({ matchesTarget: true, completionSatisfied: true, outcome: 'positive',
      description: 'The remote model sees the target.', evidence: 'The target is visible in the supplied image.' })
    const result = await remoteProvider('ollama', [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2gAA/9k=' } },
    ] }], { model: 'lightweight-text-model', modelCapabilities: ['text'], executionTarget: 'remote' })
    assert.equal(result.provider, 'remote-server')
    assert.equal(result.model, 'fixture-remote-vision')
  })
})
const graph = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(path.join(root, 'etc/cognitive-graphs/environment-mode.json'), 'utf8')))
const decision = { outcome: 'act', objective: 'Find the described object and greet it.', completionCriteria: 'Identify it, then complete the requested wave.',
  reason: 'Execute the complete instruction locally.', requiredCompletionBasis: 'action_result', continuationPolicy: 'bounded' }
const behavior = { kind: 'behavior', target: 'the distinctive object described by the owner', completionCriteria: 'Identify the described object in an image.',
  motion: { type: 'move', direction: 'forward', continuous: true, durationMs: 1000, speed: 60, forward: 80, turn: 20 },
  candidateLabels: ['cup'], identifyEveryFrames: 3, steering: { label: 'cup', gain: 100 } }
const program = { steps: [behavior, { kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] }
const route = { needsResponse: false, needsConversationHistory: false, needsMemory: false, needsRobotStatus: false,
  needsEnvironment: true, needsVision: true, needsAction: true, needsExecutionContext: false, needsPersona: false }

function fixture(sessionId: string, automaticInterpretation = true) {
  const timestamp = new Date().toISOString()
  const observation: EnvironmentObservation = { adapter: 'ainekio-gateway', environmentId: 'fixture-room', sessionId, timestamp,
    capabilities: { actions: ['move', 'stop', 'captureImage', 'robotCommand'], robotCommands: ['wave', 'dance', 'turn_right_180', 'run'], visual: true, movement: true },
    state: { body: { authenticated: true, cameraReady: true, robotId: 'fixture-robot' },
      gateway: { robots: { 'fixture-robot': { epoch: 1, connection_state: 'online' } } },
      activeMovementUpdates: { version: 1, available: true, gatewayInstance: 'fixture-gateway', robotId: 'fixture-robot', epoch: 1,
        maxValidityMs: 2000, maxInFlight: 1, controls: ['speed', 'stride', 'rate', 'forward', 'turn'] } },
    visual: { id: 'before', mimeType: 'image/jpeg', timestamp, dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=' } }
  const context = { username, userId: username, sessionId, userMessage: decision.objective,
    cognitiveMode: 'environment' as const, environmentObservation: observation, environmentObservationCurrent: true, recordPersonaMemory: false }
  const received: EnvironmentCommandWork[] = []
  core.recordEnvironmentObservation(observation); core.setEnvironmentBridgeEnabled(true)
  const unsubscribe = core.subscribeEnvironmentActions(sessionId, () => received.push(...core.dispatchEnvironmentActions(sessionId, 10)))
  let initialPerceptionRecorded = false
  async function run(executionId?: string, turnContext: Record<string, unknown> = {}) {
    core.touchEnvironmentSession(sessionId)
    if (!executionId && !initialPerceptionRecorded) {
      await perception(0, .4)
      initialPerceptionRecorded = true
    }
    const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', resource: executionId ? `execution:${executionId}` : 'local-llm', username, source: 'user', maxAttempts: 1, input: { requestId: randomUUID() } })
    assert.ok(manager.claim(work.id))
    const result = await withGraphWork(work, id => manager.attachExecution(work.id, id),
      () => runDurableGraph({ graph, context: { ...context, ...turnContext }, executionId }), async input => manager.enqueue(input))
    // Drive the real Coordinator cleanup handler (the fixture does not start
    // its automatic worker loop). No body receipts are synthesized here.
    for (const cleanup of manager.getAllTasks().filter(task => task.handler === 'environment.cancel-owned-work'
      && task.durable?.executionId === result.executionId && task.state === 'queued')) {
      assert.ok(manager.claim(cleanup.id))
      await (engine as unknown as { execute(task: typeof cleanup): Promise<void> }).execute(cleanup)
    }
    manager.complete(work.id, result.status !== 'failed', { status: result.status })
    const interpretation = manager.getAllTasks().find(task => task.handler === 'environment.interpret'
      && task.durable?.executionId === result.executionId && task.state === 'queued')
    if (interpretation && automaticInterpretation && replies.length) {
      assert.ok(manager.claim(interpretation.id))
      await (engine as unknown as { execute(task: typeof interpretation): Promise<void> }).execute(interpretation)
      return run(result.executionId)
    }
    assert.notEqual(result.status, 'failed', result.error?.stack)
    await new Promise(resolve => setImmediate(resolve))
    if (result.status === 'waiting') {
      const saved = openExecutionStore(username)
      try {
        if (saved.task(result.executionId!)?.decision.objectiveComplete) return run(result.executionId)
      } finally { saved.close() }
    }
    return result
  }
  function feedback(action: EnvironmentCommandWork, type: 'accepted' | 'completed' | 'cancelled' | 'outcome_unknown') {
    core.recordEnvironmentActionResult({ id: randomUUID(), actionId: action.id, type, timestamp: new Date().toISOString(), message: type })
  }
  function complete(action: EnvironmentCommandWork) { feedback(action, 'accepted'); feedback(action, 'completed') }
  async function perception(frameCounter: number, x: number, ttlMs = 10000) {
    const now = Date.now()
    assert.equal(await core.recordEnvironmentPerception(sessionId, { version: 1, robotId: 'fixture-robot', epoch: 1,
      gatewayInstance: 'fixture-gateway', frameCounter, timeBasis: 'gateway_receipt', observedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString(),
      backend: 'fixture', model: 'fixture', summary: 'An object is visible.', objects: [{ label: 'cup', box: { x, y: .2, width: .2, height: .2 } }], uncertainties: [] }, async input => manager.enqueue(input)), true)
  }
  return { observation, received, run, feedback, complete, perception, unsubscribe }
}

test('complete programs are generic and the retired selector routes are rejected', () => {
  const result = validateEnvironmentSelectorOutput(JSON.stringify({ response: '', program, taskDecision: decision }), 'fixture-body')
  assert.equal(result.valid, true, result.errors.join('; '))
  assert.equal(result.value?.program?.steps.length, 2)
  assert.equal(validateEnvironmentSelectorOutput(JSON.stringify({ response: '', actions: [], movementRequest: null, localTask: {}, taskDecision: decision })).valid, false)
})

test('conversation completes without any physical work', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('greeting-body'); const before = calls.length
    try {
      replies.push({ ...route, needsResponse: true, needsVision: false, needsAction: false }, { response: 'Hello.', program: null, taskDecision: null })
      assert.equal((await f.run()).status, 'completed'); assert.equal(f.received.length, 0); assert.equal(calls.length, before + 2)
    } finally { f.unsubscribe() }
  })
})

test('turn then dance executes locally with no model decision between movements', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('sequence-body'); const before = calls.length
    try {
      replies.push(route, { response: '', taskDecision: { ...decision, objective: 'Turn around and dance.' }, program: { steps: [
        { kind: 'action', action: { type: 'robotCommand', command: 'turn_right_180' } },
        { kind: 'action', action: { type: 'robotCommand', command: 'dance' } }] } })
      const started = await f.run(); assert.equal(started.status, 'waiting')
      const [turn] = f.received.splice(0); assert.equal(turn.command, 'turn_right_180'); f.complete(turn)
      assert.equal((await f.run(started.executionId)).status, 'waiting')
      const [dance] = f.received.splice(0); assert.equal(dance.command, 'dance'); f.complete(dance)
      assert.equal((await f.run(started.executionId)).status, 'completed')
      assert.equal(calls.length, before + 2, 'Only initial routing and complete-task selection may call a model')
      const { loadRobotStatus } = await import('../robot-status.js')
      const status = loadRobotStatus(username)!
      assert.equal(status.lastAction?.actionId, dance.id)
      assert.equal(status.lastAction?.command, 'dance')
      assert.equal(status.lastAction?.status, 'completed')
      assert.equal(status.lastBodyAction?.actionId, dance.id)
      assert.equal(status.lastAction?.sessionId, f.observation.sessionId)
    } finally { f.unsubscribe() }
  })
})

test('the running gait steers during delayed identification, then waves before whole-task completion', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('search-body'); const before = calls.length
    try {
      replies.push(route, { response: '', taskDecision: decision, program })
      const started = await f.run(); const executionId = started.executionId!
      const [motion, snapshot] = f.received.splice(0)
      assert.equal(motion.continuous, true); assert.equal(motion.turn, 20); assert.deepEqual(snapshot.bodyLease, motion.bodyLease)
      f.feedback(motion, 'accepted'); f.complete(snapshot)
      core.publishEnvironmentObservation({ ...f.observation, id: 'snapshot-result', metadata: { actionId: snapshot.id },
        visual: { ...f.observation.visual!, id: 'interest-image', timestamp: new Date().toISOString(), metadata: { actionId: snapshot.id } } }, { username })
      await f.run(executionId)
      const [initialUpdate] = f.received.splice(0); assert.equal(initialUpdate.movementUpdate?.actionId, motion.id); f.complete(initialUpdate)
      const identification = manager.getAllTasks().find(task => task.handler === 'environment.identify' && task.durable?.executionId === executionId)!
      assert.equal(identification.input.completionCriteria, behavior.completionCriteria)
      let resolveIdentification!: (value: unknown) => void
      let markRequestStarted!: () => void
      const requestStarted = new Promise<void>(resolve => { markRequestStarted = resolve })
      replies.push(() => new Promise(resolve => { resolveIdentification = resolve; markRequestStarted() }))
      assert.ok(manager.claim(identification.id))
      const processing = (engine as unknown as { execute(task: typeof identification): Promise<void> }).execute(identification)
      await Promise.race([requestStarted, processing.then(() => {
        throw new Error('Identification work ended before the simulated HTTP request arrived')
      })])
      await f.perception(1, .1); await f.run(executionId)
      const [left] = f.received.splice(0); assert.equal(left.movementUpdate?.controls.turn, 50); assert.deepEqual(left.bodyLease, motion.bodyLease)
      f.complete(left); await f.run(executionId)
      await f.perception(2, .7); await f.run(executionId)
      const [right] = f.received.splice(0); assert.ok(Math.abs(right.movementUpdate!.controls.turn + 10) < 1e-8)
      assert.equal(right.movementUpdate?.actionId, motion.id, 'Steering must update the original gait, not finish it')
      assert.equal(manager.getTask(identification.id)?.state, 'leased'); assert.equal(calls.length, before + 3)
      f.complete(right)
      resolveIdentification({ matchesTarget: true, completionSatisfied: true, outcome: 'positive', description: 'The requested object is identified.', evidence: 'Object visible in interest-image.' }); await processing
      await f.run(executionId)
      const [finish] = f.received.splice(0)
      assert.equal(finish.movementUpdate?.actionId, motion.id)
      assert.equal(finish.movementUpdate?.controls.speed, 0)
      f.complete(finish)
      assert.equal((await f.run(executionId)).status, 'waiting')
      assert.equal(f.received.length, 0, 'Finish ACK cannot advance to the wave')
      f.feedback(motion, 'completed')
      await f.run(executionId)
      const [wave] = f.received.splice(0); assert.equal(wave.command, 'wave')
      const saved = openExecutionStore(username); assert.equal(saved.task(executionId)?.decision.objectiveComplete, false); saved.close()
      f.complete(wave); assert.equal((await f.run(executionId)).status, 'completed')
      const final = openExecutionStore(username); assert.equal(final.task(executionId)?.decision.objectiveComplete, true); final.close()
      assert.equal(calls.length, before + 3, 'Wave and completion cannot invoke the retired result/review chain')
      assert.equal(remoteCalls.at(-1).model, 'fixture-remote-vision', 'The provider transport must call the configured remote backend')
    } finally { f.unsubscribe() }
  })
})

test('new instructions steer the same active movement and conversation preserves the authorized behavior', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('steered-instruction-body')
    try {
      const single = { steps: [behavior] }
      replies.push(route, { response: '', taskDecision: decision, program: single })
      const started = await f.run(); const id = started.executionId!
      const [motion, snapshot] = f.received.splice(0)
      f.feedback(motion, 'accepted'); await f.run(id)
      const [settings] = f.received.splice(0); f.complete(settings); await f.run(id)
      const input = (message: string) => {
        const store = openExecutionStore(username)
        try { store.deliverEvent(id, { eventId: randomUUID(), kind: 'user_steering',
          payload: { userMessage: message, sessionId: f.observation.sessionId } }) } finally { store.close() }
      }
      input('Hello.')
      replies.push({ ...route, needsVision: false, needsAction: false }, { response: 'Hello.', program: null, taskDecision: null })
      assert.equal((await f.run(id)).status, 'waiting')
      assert.equal(f.received.length, 0, 'Conversation cannot restart the gait or duplicate its snapshot')
      const revised = { steps: [{ ...behavior, motion: { ...behavior.motion, turn: -30 } }] }
      input('Continue looking while turning right.')
      replies.push(route, { response: '', taskDecision: decision, program: revised })
      assert.equal((await f.run(id)).status, 'waiting')
      const changed = f.received.splice(0)
      const update = changed.find(action => action.movementUpdate)!
      assert.equal(update.movementUpdate!.actionId, motion.id)
      assert.ok(Math.abs(update.movementUpdate!.controls.turn + 30) < 1e-8)
      assert.deepEqual(update.bodyLease, motion.bodyLease)
      assert.equal(changed.some(action => action.type === 'move' && !action.movementUpdate), false)
      assert.equal(changed.some(action => action.type === 'captureImage'), false, 'Steering the same search preserves its pending snapshot')
      f.complete(snapshot)
      core.publishEnvironmentObservation({ ...f.observation, metadata: { actionId: snapshot.id },
        visual: { ...f.observation.visual!, id: 'steered-interest-image', timestamp: new Date().toISOString(), metadata: { actionId: snapshot.id } } }, { username })
      await f.run(id)
      const identification = manager.getAllTasks().find(task => task.handler === 'environment.identify' && task.durable?.executionId === id)!
      assert.equal(identification.input.image.id, 'steered-interest-image', 'The original snapshot still reaches identification after steering')
      const store = openExecutionStore(username)
      try { store.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { store.close() }
    } finally { f.unsubscribe() }
  })
})

test('an ongoing movement accepts a new composed instruction without a search or gait restart', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('direct-ongoing-body')
    try {
      const movement = { type: 'move', continuous: true, durationMs: 0, direction: 'forward', speed: 60, forward: 90, turn: 10 }
      const select = (action: typeof movement) => ({ response: '', taskDecision: decision,
        program: { steps: [{ kind: 'action', action }] } })
      replies.push(route, select(movement))
      const started = await f.run(); const id = started.executionId!
      const [motion] = f.received.splice(0)
      f.feedback(motion, 'accepted'); await f.run(id)
      const [firstUpdate] = f.received.splice(0); f.complete(firstUpdate); await f.run(id)
      for (let change = 0; change < 8; change++) {
        const turn = change % 2 ? 60 : -60
        const store = openExecutionStore(username)
        try { store.deliverEvent(id, { eventId: randomUUID(), kind: 'user_steering',
          payload: { userMessage: `Continue forward while turning ${turn > 0 ? 'left' : 'right'}.`, sessionId: f.observation.sessionId } }) } finally { store.close() }
        replies.push(route, select({ ...movement, turn }))
        assert.equal((await f.run(id)).status, 'waiting')
        const [update] = f.received.splice(0)
        assert.equal(update.movementUpdate!.actionId, motion.id)
        assert.equal(update.movementUpdate!.controls.forward, 90)
        assert.equal(update.movementUpdate!.controls.turn, turn)
        assert.deepEqual(update.bodyLease, motion.bodyLease)
        assert.equal(f.received.length, 0)
        f.complete(update); await f.run(id)
      }
    } finally { f.unsubscribe() }
  })
})

test('ongoing named gaits retain their adapter defaults and accept speed changes on the original movement', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('named-ongoing-body')
    try {
      const movement = { type: 'robotCommand', command: 'run', continuous: true }
      const select = (action: typeof movement & { speed?: number }) => ({ response: '', taskDecision: decision,
        program: { steps: [{ kind: 'action', action }] } })
      replies.push(route, select(movement))
      const started = await f.run(); const id = started.executionId!
      const [motion] = f.received.splice(0)
      f.feedback(motion, 'accepted'); await f.run(id)
      assert.equal(f.received.length, 0, 'The executor cannot replace an unspecified named gait speed or direction')
      const store = openExecutionStore(username)
      try { store.deliverEvent(id, { eventId: randomUUID(), kind: 'user_steering',
        payload: { userMessage: 'Continue running at speed 120.', sessionId: f.observation.sessionId } }) } finally { store.close() }
      replies.push(route, select({ ...movement, speed: 120 }))
      assert.equal((await f.run(id)).status, 'waiting')
      const [update] = f.received.splice(0)
      assert.equal(update.movementUpdate!.actionId, motion.id)
      assert.deepEqual(update.movementUpdate!.controls, { speed: 120 })
      assert.deepEqual(update.bodyLease, motion.bodyLease)
      assert.equal(f.received.length, 0)
    } finally { f.unsubscribe() }
  })
})

for (const outcome of ['positive', 'negative', 'ambiguous', 'failed'] as const) {
  test(`capture-only visual search uses remote ${outcome} evidence and returns to the existing planner`, async () => {
    await withUserContext({ username, userId: username, role: 'owner' }, async () => {
      const f = fixture(`capture-${outcome}`)
      const visualDecision = { ...decision, objective: 'Find the red cup', completionCriteria: 'Identify the red cup in this captured image',
        requiredCompletionBasis: 'visual_observation' }
      try {
        replies.push(route, { response: '', taskDecision: visualDecision,
          program: { steps: [{ kind: 'action', action: { type: 'captureImage' } }] } })
        const started = await f.run(); const id = started.executionId!
        const [capture] = f.received.splice(0)
        f.complete(capture)
        assert.equal((await f.run(id)).status, 'waiting', 'A capture receipt cannot complete visual search')
        const beforeImage = openExecutionStore(username)
        assert.equal(beforeImage.task(id)?.decision.objectiveComplete, false); beforeImage.close()
        core.publishEnvironmentObservation({ ...f.observation, metadata: { actionId: capture.id },
          visual: { ...f.observation.visual!, id: `captured-${outcome}`, timestamp: new Date().toISOString(), metadata: { actionId: capture.id } } }, { username })
        await f.run(id)
        const identification = manager.getAllTasks().find(task => task.handler === 'environment.identify' && task.durable?.executionId === id)!
        assert.ok(identification)
        replies.push(outcome === 'failed' ? () => { throw new Error('Simulated remote perception unavailable') }
          : { matchesTarget: outcome === 'positive', completionSatisfied: outcome === 'positive', outcome,
            description: `Image assessment ${outcome}`, evidence: `Observed evidence in captured-${outcome}` })
        assert.ok(manager.claim(identification.id))
        await (engine as unknown as { execute(task: typeof identification): Promise<void> }).execute(identification)
        if (outcome !== 'positive') replies.push({ response: '', outcome: 'wait', taskId: 'none', instruction: '', completionEvidence: '',
          requiredCompletionBasis: 'visual_observation', observationSummary: `Perception ${outcome}`,
          reason: outcome === 'failed' ? 'Remote perception unavailable; the target has not been established' : `The image assessment is ${outcome}` })
        const result = await f.run(id)
        assert.equal(result.status, outcome === 'positive' ? 'completed' : 'waiting')
        const final = openExecutionStore(username)
        assert.equal(final.task(id)?.decision.objectiveComplete, outcome === 'positive'); final.close()
        assert.equal(f.received.length, 0, 'Neither a failed nor negative image result can invent body behavior')
        if (outcome !== 'positive') assert.match(JSON.stringify(calls.at(-1).messages), outcome === 'failed'
          ? /Simulated remote perception unavailable/ : new RegExp(`captured-${outcome}`))
      } finally { f.unsubscribe() }
    })
  })
}

test('a stalled remote inference request remains cancellable without calling local inference', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    let release!: (value: unknown) => void
    replies.push(() => new Promise(resolve => { release = resolve }))
    const controller = new AbortController()
    const callsBefore = remoteCalls.length
    const request = identifyActiveTaskImage({ target: 'red cup', objective: 'Find the red cup', completionCriteria: 'Identify it',
      image: { id: 'cancelled-frame', timestamp: new Date().toISOString(), dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=' } }, controller.signal)
    const rejected = assert.rejects(request, error => error instanceof Error && error.name === 'AbortError')
    for (let i = 0; !release && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
    assert.ok(release, 'The actual remote HTTP server must receive the request before cancellation')
    controller.abort()
    await rejected
    release({ matchesTarget: true, completionSatisfied: true, outcome: 'positive', description: 'Late result', evidence: 'Late image evidence' })
    assert.equal(remoteCalls.length, callsBefore + 1)
    assert.equal(calls.at(-1).options.executionTarget, 'remote')
  })
})

test('remote outage requests owned cancellation and waits for its receipt before returning to the planner', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('remote-outage-body')
    let failRemote!: () => void
    try {
      replies.push(route, { response: '', taskDecision: decision, program: { steps: [behavior] } })
      const started = await f.run(); const id = started.executionId!
      const [motion, capture] = f.received.splice(0)
      f.feedback(motion, 'accepted'); f.complete(capture)
      core.publishEnvironmentObservation({ ...f.observation, metadata: { actionId: capture.id },
        visual: { ...f.observation.visual!, id: 'outage-image', timestamp: new Date().toISOString(), metadata: { actionId: capture.id } } }, { username })
      await f.run(id)
      const [initial] = f.received.splice(0); f.complete(initial)
      const identification = manager.getAllTasks().find(task => task.handler === 'environment.identify' && task.durable?.executionId === id)!
      replies.push(() => new Promise((_resolve, reject) => { failRemote = () => reject(new Error('Remote backend outage')) }))
      assert.ok(manager.claim(identification.id))
      const processing = (engine as unknown as { execute(task: typeof identification): Promise<void> }).execute(identification)
      for (let i = 0; !failRemote && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
      assert.ok(failRemote)
      await f.perception(1, .1)
      assert.equal((await f.run(id)).status, 'waiting')
      const [steering] = f.received.splice(0)
      assert.equal(steering.movementUpdate?.actionId, motion.id)
      assert.equal(steering.movementUpdate?.controls.turn, 50)
      assert.equal(manager.getTask(identification.id)?.state, 'leased', 'The controller must progress before remote inference settles')
      f.complete(steering)
      failRemote(); await processing
      const beforeCleanup = calls.length
      assert.equal((await f.run(id)).status, 'waiting')
      const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
      assert.ok(owned.cancellationRequestedAt, 'The existing Coordinator cancellation must reach the bridge')
      assert.equal(calls.length, beforeCleanup, 'The planner cannot run before the gait terminal receipt')
      f.feedback(motion, 'outcome_unknown')
      assert.equal((await f.run(id)).status, 'waiting')
      assert.equal(calls.length, beforeCleanup)
      f.feedback(motion, 'cancelled')
      replies.push({ response: '', outcome: 'wait', taskId: 'none', instruction: '', completionEvidence: '',
        requiredCompletionBasis: 'visual_observation', observationSummary: 'No successful perception result',
        reason: 'The remote backend is unavailable; the goal remains incomplete' })
      assert.equal((await f.run(id)).status, 'waiting')
      assert.match(JSON.stringify(calls.at(-1).messages), /Remote backend outage/)
      const final = openExecutionStore(username)
      assert.equal(final.task(id)?.decision.objectiveComplete, false); final.close()
      assert.equal(f.received.length, 0)
    } finally { failRemote?.(); f.unsubscribe() }
  })
})

test('one photo clarification waits durably until new user input, without another model call', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('clarification-body'); const before = calls.length;
    try {
      replies.push({ ...route, needsResponse: true, needsVision: false, needsAction: false }, {
        response: 'What would you like photographed?', program: null,
        taskDecision: { ...decision, objective: 'Take a picture', outcome: 'wait',
          continuationPolicy: 'none', requiredCompletionBasis: 'user_input', reason: 'Await the user’s chosen subject.' },
      });
      const started = await f.run();
      assert.equal(started.status, 'waiting');
      assert.equal(calls.length, before + 2);
      assert.equal(f.received.length, 0);
      assert.equal((await f.run(started.executionId)).status, 'waiting');
      assert.equal(calls.length, before + 2, 'Resuming without input cannot repeat the clarification');
      const store = openExecutionStore(username);
      try { store.deliverEvent(started.executionId!, { eventId: randomUUID(), kind: 'user_steering',
        payload: { userMessage: 'Just tell me whether the camera is available instead.', sessionId: f.observation.sessionId } }); }
      finally { store.close(); }
      replies.push({ ...route, needsResponse: true, needsVision: false, needsAction: false }, {
        response: 'The camera is available.', program: null, taskDecision: { ...decision, objective: 'Report camera availability', outcome: 'complete',
          continuationPolicy: 'none', requiredCompletionBasis: 'user_input', reason: 'Answered the revised question using camera readiness.' },
      });
      assert.equal((await f.run(started.executionId)).status, 'completed');
      assert.equal(calls.length, before + 4);
      assert.equal(f.received.length, 0);
    } finally { f.unsubscribe(); }
  });
});

test('a second user turn preserves the objective and history while replacing speech and response metadata', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const { beginTTSUserTurn, claimNextTTS } = await import('../tts/delivery-queue.js')
    const { loadBufferForUser } = await import('../conversation-buffer.js')
    const f = fixture('turn-metadata-body')
    const firstTime = new Date(Date.now() - 60_000).toISOString()
    const secondTime = new Date().toISOString()
    const firstMessage = 'Please wave when I tell you to.'
    const secondMessage = 'Wave now, please.'
    const firstResponse = 'Ready when you are.'
    const secondResponse = 'I will wave now.'
    const initial = { ...decision, objective: 'Wave at the requested time', outcome: 'wait',
      continuationPolicy: 'none', requiredCompletionBasis: 'user_input' }
    speechDisabled = false
    try {
      const firstGeneration = beginTTSUserTurn(username)!.generation
      replies.push({ ...route, needsResponse: true, needsConversationHistory: true, needsVision: false, needsAction: false },
        { response: firstResponse, program: null, taskDecision: initial })
      const started = await f.run(undefined, { userMessage: firstMessage, conversationInput: firstMessage,
        memoryTimestamp: firstTime, ttsGeneration: firstGeneration, replyToContent: 'old-reply-context',
        idempotencyKey: 'first-turn' })
      assert.equal(started.status, 'waiting')
      const store = openExecutionStore(username)
      const objectiveId = store.task(started.executionId!)!.objectiveId
      store.close()
      const secondGeneration = beginTTSUserTurn(username)!.generation
      replies.push({ ...route, needsResponse: true, needsVision: false, needsAction: true, needsExecutionContext: true },
        { response: '', program: null, taskDecision: null, executionDisposition: 'steer', targetExecutionId: started.executionId })
      const admission = await f.run(undefined, { userMessage: secondMessage, conversationInput: secondMessage,
        memoryTimestamp: secondTime, ttsGeneration: secondGeneration, idempotencyKey: 'second-turn' })
      assert.equal(admission.status, 'completed')
      assert.equal(admission.nodes.get('execution-input-out')?.outputs?.sent, true)
      const eventStore = openExecutionStore(username)
      const event = eventStore.events(started.executionId!).find(event => event.kind === 'user_steering')!
      eventStore.close()
      assert.equal((event.payload as any).ttsGeneration, secondGeneration)
      assert.equal((event.payload as any).memoryTimestamp, secondTime)
      assert.equal((event.payload as any).conversationInput, secondMessage)
      assert.equal((event.payload as any).replyToContent, null)
      replies.push({ ...route, needsResponse: true, needsConversationHistory: true, needsVision: false },
        { response: secondResponse, program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'wave' } }] },
          taskDecision: { ...decision, objective: initial.objective } })
      const resumed = await f.run(started.executionId)
      assert.equal(resumed.status, 'waiting')
      const envelope = JSON.parse(calls.at(-1).messages.at(-1).content)
      assert.equal(envelope.currentInstruction, secondMessage)
      assert.ok(envelope.recentConversation.some((message: any) => message.content === firstMessage))
      assert.ok(envelope.recentConversation.some((message: any) => message.content === firstResponse))
      assert.ok(!JSON.stringify(envelope).includes('old-reply-context'))
      const messages = loadBufferForUser(username, 'conversation').messages
      const response = messages.find(message => message.content === secondResponse)!
      assert.equal(response.timestamp, Date.parse(secondTime))
      assert.equal(messages.filter(message => message.content === secondMessage).length, 1)
      const speech = claimNextTTS(username, 'fixture-consumer').item
      assert.ok(speech, 'The real speech queue must accept the resumed response')
      assert.equal(speech.text, secondResponse)
      assert.equal(speech.generation, secondGeneration)
      const saved = openExecutionStore(username)
      assert.equal(saved.task(started.executionId!)!.objectiveId, objectiveId)
      assert.equal(saved.task(started.executionId!)!.instruction, firstMessage)
      saved.close()
      const [action] = f.received.splice(0)
      assert.equal(action.command, 'wave')
      f.complete(action)
      assert.equal((await f.run(started.executionId)).status, 'completed')
    } finally { speechDisabled = true; f.unsubscribe() }
  })
})

test('Coordinator deadline wakes a silent feedback stream and requests cancellation without inference completing', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('feedback-expiry-body')
    try {
      replies.push(route, { response: '', taskDecision: decision, program: { steps: [behavior] } })
      const started = await f.run(); const id = started.executionId!
      const [motion] = f.received.splice(0)
      f.feedback(motion, 'accepted')
      await f.perception(1, .4, 3000)
      await f.run(id)
      const deadline = manager.getAllTasks().find(task => task.handler === 'environment.active-task-deadline'
        && task.durable?.executionId === id && task.state === 'queued')!
      assert.ok(deadline)
      assert.equal(manager.claim(deadline.id), null, 'The existing notBefore gate owns timing')
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(deadline.notBefore!) - Date.now() + 10)))
      assert.ok(manager.claim(deadline.id))
      await (engine as unknown as { execute(task: typeof deadline): Promise<void> }).execute(deadline)
      const callsBefore = calls.length
      assert.equal((await f.run(id)).status, 'waiting')
      const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
      assert.ok(owned.cancellationRequestedAt, 'Feedback expiry must use the existing cancellation transport')
      assert.equal(calls.length, callsBefore, 'Cleanup does not depend on another model call')
      assert.equal(f.received.some(command => command.type === 'stop'), false, 'No unscoped Stop action is admitted')
    } finally { f.unsubscribe() }
  })
})

for (const termination of ['finish', 'cancel'] as const) {
  test(`instructions buffered during ${termination} cross the real graph handoff before another ongoing phase`, async () => {
    await withUserContext({ username, userId: username, role: 'owner' }, async () => {
      const f = fixture(`buffered-${termination}-body`)
      const nextBehavior = { ...behavior, target: 'the doorway', motion: { ...behavior.motion, speed: 35, turn: -20 } }
      const phases = { steps: [behavior, nextBehavior] }
      try {
        replies.push(route, { response: '', taskDecision: decision, program: phases })
        const started = await f.run(); const id = started.executionId!
        const [motion, capture] = f.received.splice(0)
        f.feedback(motion, 'accepted'); f.complete(capture)
        core.publishEnvironmentObservation({ ...f.observation, metadata: { actionId: capture.id },
          visual: { ...f.observation.visual!, id: `buffered-${termination}-image`, timestamp: new Date().toISOString(),
            metadata: { actionId: capture.id } } }, { username })
        await f.run(id)
        const [settings] = f.received.splice(0); f.complete(settings)
        const identify = manager.getAllTasks().find(task => task.handler === 'environment.identify' && task.durable?.executionId === id)!
        replies.push(termination === 'finish'
          ? { matchesTarget: true, completionSatisfied: true, outcome: 'positive', description: 'Cup found', evidence: 'Fresh cup image' }
          : () => { throw new Error('Required identification failed') })
        assert.ok(manager.claim(identify.id))
        await (engine as unknown as { execute(task: typeof identify): Promise<void> }).execute(identify)
        await f.run(id)
        if (termination === 'finish') {
          const [finish] = f.received.splice(0)
          assert.equal(finish.movementUpdate?.actionId, motion.id)
          assert.equal(finish.movementUpdate?.controls.speed, 0)
          f.complete(finish)
        } else {
          const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
          assert.ok(owned.cancellationRequestedAt)
        }
        const input = (message: string, generation: number) => {
          const store = openExecutionStore(username)
          try { store.deliverEvent(id, { eventId: randomUUID(), kind: 'user_steering', payload: {
            userMessage: message, conversationInput: message, sessionId: f.observation.sessionId, ttsGeneration: generation,
          } }) } finally { store.close() }
        }
        input('What have you found?', 1)
        input('Explain before the next search.', 2)
        const before = calls.length
        assert.equal((await f.run(id)).status, 'waiting')
        assert.equal(calls.length, before, 'Interpretation waits for command termination')
        assert.equal(f.received.length, 0, 'No next ongoing behavior while termination is pending')
        if (termination === 'cancel') {
          f.feedback(motion, 'outcome_unknown')
          assert.equal((await f.run(id)).status, 'waiting')
          assert.equal(calls.length, before)
          assert.equal(f.received.length, 0)
        }
        f.feedback(motion, termination === 'finish' ? 'completed' : 'cancelled')
        input('Now tell me, then look for the doorway.', 3)
        replies.push(() => {
          assert.equal(f.received.length, 0, 'Pending user input must route before another body command')
          return { ...route, needsResponse: true, needsVision: false }
        }, () => {
          const content = calls.at(-1).messages.at(-1).content
          const envelope = JSON.parse(typeof content === 'string' ? content : content.find((part: any) => part.type === 'text').text)
          assert.deepEqual(JSON.parse(envelope.currentInstruction).pendingTurns.map((turn: any) => turn.userMessage),
            ['What have you found?', 'Explain before the next search.', 'Now tell me, then look for the doorway.'])
          assert.equal(f.received.length, 0)
          // Conversation resumes the remaining settled program; a revised
          // program after cancellation must receive a fresh action identity.
          return { response: 'The previous search has ended.',
            program: termination === 'finish' ? null : { steps: [nextBehavior] },
            taskDecision: termination === 'finish' ? null : decision }
        })
        await f.perception(2, .4)
        assert.equal((await f.run(id)).status, 'waiting')
        assert.equal(calls.length, before + 2)
        const next = f.received.splice(0)
        const newMotion = next.find(action => action.type === 'move' && !action.movementUpdate)!
        assert.ok(newMotion, 'The selected next behavior receives a new command')
        assert.notEqual(newMotion.id, motion.id, 'Never adopt the terminated gait identity')
        assert.deepEqual(newMotion.metadata?.interpretationBody,
          [f.observation.sessionId, 'fixture-gateway', 'fixture-robot', 1, null],
          'The actual graph-to-command path carries the proposal ownership fence')
        assert.equal(newMotion.speed, nextBehavior.motion.speed)
        assert.equal(newMotion.turn, nextBehavior.motion.turn)
        assert.equal(next.some(action => action.movementUpdate?.actionId === motion.id), false)
        const store = openExecutionStore(username)
        try {
          assert.deepEqual(store.events(id).filter(event => event.kind === 'user_steering')
            .map(event => (event.payload as any).ttsGeneration), [1, 2, 3])
          store.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} })
        } finally { store.close() }
      } finally { f.unsubscribe() }
    })
  })
}

function instruction(executionId: string, sessionId: string, userMessage: string, generation = 1) {
  const store = openExecutionStore(username)
  try { store.deliverEvent(executionId, { eventId: randomUUID(), kind: 'user_steering', payload: {
    userMessage, conversationInput: userMessage, sessionId, ttsGeneration: generation,
    memoryTimestamp: new Date().toISOString(), replyToQuestionId: `question-${generation}`,
  } }) } finally { store.close() }
}
function queuedInterpretation(executionId: string) {
  const job = manager.getAllTasks().find(task => task.handler === 'environment.interpret'
    && task.durable?.executionId === executionId && task.state === 'queued')
  assert.ok(job, 'Interpretation is finite Coordinator work belonging to the active execution')
  return job
}
async function executeWork(job: ReturnType<typeof queuedInterpretation>) {
  assert.ok(manager.claim(job.id))
  await (engine as unknown as { execute(task: typeof job): Promise<void> }).execute(job)
}
async function startFeedbackTask(f: ReturnType<typeof fixture>) {
  replies.push(route, { response: '', program, taskDecision: decision })
  const started = await f.run()
  const [motion] = f.received.splice(0)
  f.feedback(motion, 'accepted'); await f.run(started.executionId)
  for (const update of f.received.splice(0)) f.complete(update)
  await f.run(started.executionId)
  return { id: started.executionId!, motion }
}

test('delayed interpretation keeps steering live, combines superseded turns, and applies once to the same gait with newest speech attribution', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const { beginTTSUserTurn, claimNextTTS } = await import('../tts/delivery-queue.js')
    const { loadBufferForUser } = await import('../conversation-buffer.js')
    const f = fixture('slow-instruction-body', false)
    let release!: () => void
    let entered!: () => void
    const reachedModel = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    let worker: Promise<void> | undefined
    speechDisabled = false
    try {
      const { id, motion } = await startFeedbackTask(f)
      const firstGeneration = beginTTSUserTurn(username)!.generation
      instruction(id, f.observation.sessionId, 'What do you see?', firstGeneration)
      await f.run(id)
      const old = queuedInterpretation(id)
      replies.push(async () => { entered(); await blocked; return route })
      worker = executeWork(old)
      await reachedModel
      await f.perception(1, .1)
      assert.ok(manager.getAllTasks().some(task => task.handler === 'graph.resume'
        && task.input.executionId === id && task.resource === `execution:${id}`),
      'The real event outbox resumes feedback independently of the occupied LLM lane')
      await f.run(id)
      const steering = f.received.splice(0).find(command => command.movementUpdate)!
      assert.equal(steering.movementUpdate!.actionId, motion.id)
      assert.equal(steering.movementUpdate!.controls.turn, 50)
      f.complete(steering); await f.run(id)
      const secondGeneration = beginTTSUserTurn(username)!.generation
      instruction(id, f.observation.sessionId, 'Keep searching, and answer my question.', secondGeneration)
      await f.run(id)
      assert.ok(manager.getTask(old.id)?.cancellationRequestedAt, 'Superseded inference uses Coordinator cancellation')
      const latest = queuedInterpretation(id)
      assert.equal(latest.input.identity.executionId, id)
      assert.equal(latest.input.identity.sessionId, f.observation.sessionId)
      assert.ok(latest.input.identity.revision > old.input.identity.revision)
      assert.deepEqual(latest.input.turns.map((turn: any) => turn.userMessage), ['What do you see?', 'Keep searching, and answer my question.'])
      // The simulated provider ignores abort; its late result must still be discarded.
      release(); await worker
      replies.push({ ...route, needsResponse: true, needsConversationHistory: true, needsVision: false },
        { response: 'I see an object and am still searching.', program: null, taskDecision: null })
      await executeWork(latest)
      await f.run(id)
      const envelope = JSON.parse(calls.at(-1).messages.at(-1).content)
      assert.deepEqual(JSON.parse(envelope.currentInstruction).pendingTurns.map((turn: any) => turn.replyToQuestionId),
        [`question-${firstGeneration}`, `question-${secondGeneration}`])
      assert.ok(envelope.recentConversation.some((turn: any) => turn.content === decision.objective))
      assert.equal(f.received.some(command => command.type === 'move' && !command.movementUpdate), false)
      const messages = loadBufferForUser(username, 'conversation').messages
      assert.equal(messages.filter(turn => turn.content === 'What do you see?').length, 1)
      assert.equal(messages.filter(turn => turn.content === 'Keep searching, and answer my question.').length, 1)
      assert.equal(messages.filter(turn => turn.content === 'I see an object and am still searching.').length, 1)
      const speech = claimNextTTS(username, 'slow-interpretation-fixture').item!
      assert.equal(speech.generation, secondGeneration)
      assert.equal(speech.text, 'I see an object and am still searching.')
      const store = openExecutionStore(username)
      try {
        store.deliverEvent(id, { eventId: randomUUID(), kind: 'work_result', payload: {
          effectId: old.durable!.effectId, result: { state: 'completed', result: { ...old.input.identity,
            route, response: JSON.stringify({ response: 'Obsolete reply', program, taskDecision: decision }) } },
        } })
      } finally { store.close() }
      await f.run(id)
      assert.equal(loadBufferForUser(username, 'conversation').messages.some(turn => turn.content === 'Obsolete reply'), false)
      const saved = openExecutionStore(username)
      try { assert.equal(saved.task(id)!.actionId, motion.id); saved.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) }
      finally { saved.close() }
    } finally { release?.(); await worker; speechDisabled = true; f.unsubscribe() }
  })
})

test('required feedback expiry cancels motion while instruction inference is still blocked', async () => {
  await withUserContext({ username, userId: username, role: 'owner' }, async () => {
    const f = fixture('instruction-expiry-body', false)
    let release!: () => void, entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const reachedModel = new Promise<void>(resolve => { entered = resolve })
    let worker: Promise<void> | undefined
    try {
      const { id, motion } = await startFeedbackTask(f)
      instruction(id, f.observation.sessionId, 'Explain the search.')
      await f.run(id)
      replies.push(async () => { entered(); await blocked; return route })
      worker = executeWork(queuedInterpretation(id)); await reachedModel
      await f.perception(2, .4, 3000)
      await f.run(id)
      const deadline = manager.getAllTasks().find(task => task.handler === 'environment.active-task-deadline'
        && task.durable?.executionId === id && task.state === 'queued')!
      assert.ok(deadline)
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(deadline.notBefore!) - Date.now() + 10)))
      await executeWork(deadline)
      await f.run(id)
      const owned = manager.findTask(task => task.type === 'environment_command' && task.input.id === motion.id)!
      assert.ok(owned.cancellationRequestedAt)
      f.feedback(motion, 'outcome_unknown'); await f.run(id)
      const store = openExecutionStore(username)
      try { assert.equal(store.task(id)!.actionStatus, 'outcome_unknown') } finally { store.close() }
      // Execution cancellation remains independent of model completion.
      const cancel = openExecutionStore(username)
      try { cancel.cancel(id, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} }) } finally { cancel.close() }
      replies.push({ response: 'Late cancelled execution reply', program: null, taskDecision: null })
      release(); await worker
      assert.equal(f.received.some(command => command.type === 'move' && !command.movementUpdate), false)
    } finally { release?.(); await worker; f.unsubscribe() }
  })
})
