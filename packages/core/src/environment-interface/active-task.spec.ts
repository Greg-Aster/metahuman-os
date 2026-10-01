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
mock.module(new URL('../tts/robot-speech.ts', import.meta.url).href, { namedExports: { ...voice,
  getSpeechOutputSettings: () => ({ speechDisabled: true, outputTarget: 'local' }) } })
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
  needsEnvironment: true, needsVision: true, needsAction: true, executionDisposition: 'new', targetExecutionId: '' }

function fixture(sessionId: string) {
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
  async function run(executionId?: string) {
    core.touchEnvironmentSession(sessionId)
    const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', username, source: 'user', maxAttempts: 1, input: { requestId: randomUUID() } })
    assert.ok(manager.claim(work.id))
    const result = await withGraphWork(work, id => manager.attachExecution(work.id, id),
      () => runDurableGraph({ graph, context, executionId }), async input => manager.enqueue(input))
    manager.complete(work.id, result.status !== 'failed', { status: result.status })
    assert.notEqual(result.status, 'failed', result.error?.stack)
    await new Promise(resolve => setImmediate(resolve)); return result
  }
  function feedback(action: EnvironmentCommandWork, type: 'accepted' | 'completed' | 'cancelled') {
    core.recordEnvironmentActionResult({ id: randomUUID(), actionId: action.id, type, timestamp: new Date().toISOString(), message: type })
  }
  function complete(action: EnvironmentCommandWork) { feedback(action, 'accepted'); feedback(action, 'completed') }
  async function perception(frameCounter: number, x: number) {
    const now = Date.now()
    assert.equal(await core.recordEnvironmentPerception(sessionId, { version: 1, robotId: 'fixture-robot', epoch: 1,
      gatewayInstance: 'fixture-gateway', frameCounter, timeBasis: 'gateway_receipt', observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10000).toISOString(),
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
      replies.push(() => new Promise(resolve => { resolveIdentification = resolve }))
      assert.ok(manager.claim(identification.id))
      const processing = (engine as unknown as { execute(task: typeof identification): Promise<void> }).execute(identification)
      for (let i = 0; !resolveIdentification && i < 100; i++) await new Promise(resolve => setImmediate(resolve))
      assert.ok(resolveIdentification)
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
      const [stop] = f.received.splice(0); assert.equal(stop.type, 'stop')
      f.complete(stop); f.feedback(motion, 'cancelled')
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
      assert.equal(update.movementUpdate!.controls.turn, -30)
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

test('remote outage leaves live steering responsive and returns an explicit failure to the planner', async () => {
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
