import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { test, after } from 'node:test'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'robot-status-live-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No external services in status tests') }
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { readRobotStatusLive } = await import('./robot-status-live.js')
const { recordEnvironmentObservation, writeEnvironmentBridgeState, readEnvironmentBridgeState } = await import('./environment-interface/store.js')
const { getQueueManager } = await import('./queue/index.js')
const { openExecutionStore } = await import('./durable-execution/storage.js')
const { ExecutionCheckpointer } = await import('./durable-execution/checkpointer.js')
const { robotStatusNode } = await import('./nodes/robot-status/status.node.js')
const { environmentContextBuilderNode } = await import('./nodes/environment/context-builder.node.js')
const { handleEnvironmentBridgeTelemetry } = await import('./api/handlers/environment-bridge.js')
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

function observation(now = Date.now()) {
  const timestamp = new Date(now).toISOString()
  return { environmentId: 'robot', adapter: 'ainekio-gateway', sessionId: 'robot-session', timestamp,
    capabilities: { actions: ['move' as const, 'stop' as const], movement: true, visual: true },
    state: { body: { authenticated: true, robotId: 'p4', cameraReady: true },
      gateway: { robots: { p4: { epoch: 1, connection_state: 'online', body_command_sequence: 3,
        body_command_source: 'coordinator', active_walk_sequence: 3, camera_frames: { received: 20, counter: 1, age_ms: 50 },
        active_walk: { name: 'walk', speed: 40, forward: 60, turn: 20 } } } },
      activeMovementUpdates: { gatewayInstance: 'gateway' },
      recognition: { enabled: true, maxFrameAgeMs: 1000, reportedAt: timestamp, observationAgeMs: 50,
        processedFps: 4, freshFps: 3, receivedFrames: 20, errors: 0 },
      perception: { version: 1 as const, robotId: 'p4', epoch: 1, gatewayInstance: 'gateway', frameCounter: 1,
        timeBasis: 'gateway_receipt' as const, observedAt: new Date(now - 50).toISOString(), expiresAt: new Date(now + 950).toISOString(),
        backend: 'local', model: 'fixture', summary: 'A person', uncertainties: ['Identity is an estimate'],
        objects: [{ label: 'person', score: 0.9, box: { x: 0.2, y: 0.2, width: 0.3, height: 0.6 }, identity: { state: 'tracked' as const, trackId: 't1', personId: 'p1', name: 'Person One', faceAgeMs: 150 } }] } } }
}
function reset(value = observation()) {
  writeEnvironmentBridgeState({ enabled: true, updatedAt: value.timestamp, sessions: {}, feedback: [] })
  recordEnvironmentObservation(value)
  return value
}

test('status ages observations and face evidence at read time without mutating history or admitting work', async () => {
  const now = Date.now(); reset(observation(now))
  const before = JSON.stringify(readEnvironmentBridgeState()); const jobs = getQueueManager().getAllTasks().length
  const fresh = await readRobotStatusLive('status-user', 'robot-session', now + 200)
  assert.equal(fresh.recognition.peopleCount, 1); assert.equal(fresh.recognition.status, 'fresh')
  assert.equal(fresh.recognition.people![0].identity!.faceAgeMs, 400)
  assert.equal(fresh.recognition.observationAgeMs, 250); assert.equal(fresh.camera.receivingFrames, true)
  assert.equal(fresh.recognition.freshResultsPerSecond, 3)
  const stale = await readRobotStatusLive('status-user', 'robot-session', now + 1100)
  assert.equal(stale.recognition.status, 'stale'); assert.equal(stale.recognition.people, null)
  assert.equal(stale.recognition.peopleCount, null, 'Stale is not a fresh zero-person observation')
  assert.equal(stale.camera.receivingFrames, false)
  assert.equal(JSON.stringify(readEnvironmentBridgeState()), before)
  assert.equal(getQueueManager().getAllTasks().length, jobs)
})

test('disabled, error, disconnected and replaced sessions do not expose current identity', async () => {
  const original = observation(); original.state.recognition.enabled = false; reset(original)
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).recognition.status, 'disabled')
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).recognition.people, null)
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).camera.receivingFrames, true, 'Recognition can be disabled while the camera still receives frames')
  const failed: any = observation(); failed.metadata = { recognitionFailure: { robotId: 'p4', epoch: 1, gatewayInstance: 'gateway', reason: 'Detector failed' } }; reset(failed)
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).recognition.status, 'error')
  assert.equal((await readRobotStatusLive('status-user', 'missing-session')).recognition.people, null)
  const state = readEnvironmentBridgeState(); state.sessions['robot-session'].status = 'disconnected'; writeEnvironmentBridgeState(state)
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).recognition.status, 'disconnected')
  const reconnected = observation(); reconnected.state.gateway.robots.p4.epoch = 2; reset(reconnected)
  assert.equal((await readRobotStatusLive('status-user', 'robot-session')).recognition.people, null)
})

test('gateway manual source and commanded steering never become measured motion or orientation', async () => {
  const source = observation(); source.state.gateway.robots.p4.body_command_source = 'manual'; reset(source)
  const live = await readRobotStatusLive('status-user', 'robot-session')
  assert.equal(live.control.manualTakeover, true)
  assert.equal(live.movement.commanded.turn, 20)
  assert.equal(live.movement.measuredPhysicalMotion.available, false)
  assert.equal(live.movement.physicalRestConfirmed, false)
  assert.equal(live.sensing.orientation.available, false)
})

test('checkpoint behavior and correlated termination survive expiry of candidate window', async () => {
  const now = Date.now(); reset(observation(now))
  const username = 'behavior-user'; const store = openExecutionStore(username)
  const definition = { graphId: 'fixture', graphHash: 'h', runtimeVersion: 'v', checkpointSchemaVersion: 1, nodeVersions: {} }
  const execution = store.create(username, definition); const lease = store.claim(execution.executionId, definition)
  const saver = new ExecutionCheckpointer(store, lease)
  const active = { stepIndex: 0, updateRevision: 1, evidence: [], motionId: 'walk-1', action: { type: 'move', forward: 60, turn: 20 },
    personLoss: { startedAt: now, expiresAt: now + 3000, reason: 'absent', consecutive: 3, candidateFrame: 'frame-3', lastExpiresAt: now + 900 } }
  const task = { executionId: execution.executionId, objectiveId: 'objective', objective: 'Track a candidate', completionCriteria: 'Until cancelled', instruction: 'track', source: 'environment',
    decision: { outcome: 'act', reason: 'request', objectiveComplete: false }, selectedAction: null,
    actionId: 'walk-1', actionStatus: 'outcome_unknown', feedback: null, baselineFrame: null, updatedAt: new Date(now).toISOString(),
    personResume: { sessionId: 'robot-session', candidateFrame: 'frame-3', windowExpiresAt: new Date(now + 3000).toISOString(), terminationConfirmed: false } }
  try {
    await saver.put({ configurable: { thread_id: execution.executionId } }, { v: 4, id: randomUUID(), ts: new Date(now).toISOString(),
      channel_values: { contextSnapshot: { activeTaskSessionId: 'robot-session', activeProgram: { steps: [{ kind: 'behavior', target: 'candidate person' }] } },
        nodeEntries: [['step', { definition: { type: 'environment_active_task_step' }, endTime: now, outputs: { state: active } }]],
        executionTransition: { transitionId: 'status-fixture', task, dispatches: [{ effectId: 'move-effect', kind: 'coordinator_work', actionId: 'walk-1',
          payload: { type: 'environment_command', input: { id: 'walk-1', type: 'move', sessionId: 'robot-session', forward: 60, turn: 20 } } }] } },
      channel_versions: {}, versions_seen: {} }, { source: 'loop', step: 0, parents: {} })
    store.deliverEvent(execution.executionId, { eventId: 'unknown', actionId: 'walk-1', kind: 'physical_result', payload: { feedback: { type: 'outcome_unknown', actionId: 'walk-1' } } })
    store.deliverEvent(execution.executionId, { eventId: 'unrelated-stop', actionId: 'other-action', kind: 'physical_result', payload: { feedback: { type: 'cancelled', actionId: 'other-action' } } })
    let live = await readRobotStatusLive(username, 'robot-session', now + 300)
    assert.equal(live.executions[0].behavior?.target, 'candidate person')
    assert.equal(live.executions[0].behavior?.tracking, 'awaiting_operator_confirmation')
    assert.equal(live.executions[0].commands[0].termination, 'unknown')
    live = await readRobotStatusLive(username, 'robot-session', now + 3100)
    assert.equal(live.executions[0].behavior?.tracking, 'observation_window_expired')
    assert.deepEqual(live.executions[0].unresolvedActionIds, ['walk-1'])
    store.deliverEvent(execution.executionId, { eventId: 'walk-terminal', actionId: 'walk-1', kind: 'physical_result', payload: { feedback: { type: 'cancelled', actionId: 'walk-1' } } })
    live = await readRobotStatusLive(username, 'robot-session', now + 3200)
    assert.equal(live.executions[0].commands[0].termination, 'terminal_receipt')
    assert.deepEqual(live.executions[0].unresolvedActionIds, [])
    assert.equal(live.movement.physicalRestConfirmed, false)
  } finally { store.release(lease); store.close() }
})

test('Robot Status works before a semantic summary exists; task and conversation receive current facts', async () => {
  const source = reset()
  const context: any = { username: 'new-status-user', sessionId: source.sessionId }
  const status: any = await robotStatusNode.execute({}, context, {})
  assert.equal(status.found, false); assert.equal(status.context.live.recognition.peopleCount, 1)
  for (const purpose of ['task', 'conversation']) {
    const result: any = await environmentContextBuilderNode.execute({ userInstruction: 'What is visible?', observation: source, sourceObservation: source,
      robotStatus: status.context, selectedTask: { program: null, taskDecision: null },
      routingAnalysis: { needsResponse: true, needsAction: false, taskContext: ['robotStatus'], conversationContext: ['robotStatus'] } }, context, { purpose })
    const message = JSON.parse(result.message)
    assert.equal(message.robotStatus.live.recognition.peopleCount, 1)
    assert.equal(message.robotStatus.live.control.manualTakeover, false)
    assert.ok(!result.message.includes('data:image'))
  }
})

// Model context can reference an earlier identical object with a JSON Pointer.
function expandedMessage(message: string): any {
  const root = JSON.parse(message)
  function expand(value: any): any {
    if (!value || typeof value !== 'object') return value
    if (typeof value.$ref === 'string') return expand(value.$ref.slice(2).split('/').reduce(
      (node: any, key: string) => node[key.replace(/~1/g, '/').replace(/~0/g, '~')], root))
    return Array.isArray(value) ? value.map(expand) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]))
  }
  return expand(root)
}

test('vision task and conversation carry named-person evidence alongside the exact image without extra work', async () => {
  const source = reset()
  const frame = { id: 'camera-1', timestamp: source.timestamp, source: 'robot-camera',
    metadata: { robotId: 'p4', gatewayInstance: 'gateway', epoch: 1, counter: 1 } }
  const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,fixture' } }
  const jobs = getQueueManager().getAllTasks().length
  const before = JSON.stringify(readEnvironmentBridgeState())
  for (const purpose of ['task', 'conversation']) {
    const result: any = await environmentContextBuilderNode.execute({
      userInstruction: 'What do you see?', observation: source, sourceObservation: source,
      frames: [frame], images: [image], selectedTask: { program: null, taskDecision: null },
      routingAnalysis: { needsResponse: true, needsAction: false, taskContext: ['vision'], conversationContext: ['vision'] },
    }, { username: 'vision-user', sessionId: source.sessionId } as any, { purpose })
    const evidence = expandedMessage(result.message).currentEnvironment.recognition
    assert.equal(evidence.people[0].identity.name, 'Person One')
    assert.equal(evidence.people[0].identity.state, 'tracked')
    assert.equal(evidence.people[0].identity.personId, 'p1')
    assert.deepEqual(evidence.people[0].box, source.state.perception.objects[0].box)
    assert.equal(evidence.people[0].detectionConfidence, 0.9)
    assert.ok(evidence.people[0].identity.faceAgeMs >= 200)
    assert.equal(evidence.identityVerification, 'estimates_only')
    assert.deepEqual(evidence.matchingVisualFrameIds, ['camera-1'])
    assert.equal(evidence.imageAssociation, 'exact_frame')
    assert.ok(result.messages[1].content.some((part: any) => part.image_url?.url === image.image_url.url))
    assert.ok(result.messages[1].content[0].text.includes('Person One'))
  }
  assert.equal(JSON.stringify(readEnvironmentBridgeState()), before)
  assert.equal(getQueueManager().getAllTasks().length, jobs)
})

test('existing bridge telemetry supplies face-match and unknown people to vision context without exporting enrollment data', async () => {
  const source = reset()
  const token = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'person-context-fixture'
  try {
    const perception = { ...source.state.perception, frameCounter: 2, objects: [
      { label: 'person', score: 0.96, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.7 },
        identity: { state: 'face_match', trackId: 'track-a', personId: 'saved-person-a', name: 'Person Two', faceAgeMs: 0, similarity: 0.82 } },
      { label: 'person', score: 0.91, box: { x: 0.6, y: 0.1, width: 0.2, height: 0.7 },
        identity: { state: 'unknown', trackId: 'track-b' } },
    ] }
    const response: any = await handleEnvironmentBridgeTelemetry({
      path: '/api/environment-bridge/telemetry', method: 'POST',
      user: { userId: 'fixture', username: 'fixture', role: 'guest', isAuthenticated: false },
      headers: { authorization: 'Bearer person-context-fixture' }, body: { sessionId: source.sessionId, perception },
    } as any)
    assert.equal(response.status, 200)
    assert.equal(response.data.perceptionAccepted, true)
    const result: any = await environmentContextBuilderNode.execute({ userInstruction: 'What do you see?',
      observation: source, sourceObservation: source, selectedTask: { program: null },
      routingAnalysis: { needsResponse: true, needsAction: false, taskContext: ['vision'], conversationContext: ['vision'] },
    }, { username: 'vision-user', sessionId: source.sessionId } as any, { purpose: 'conversation' })
    const evidence = expandedMessage(result.message).currentEnvironment.recognition
    assert.equal(evidence.peopleCount, 2)
    assert.equal(evidence.people[0].identity.name, 'Person Two', 'Read the accepted telemetry, not the old observation input')
    assert.equal(evidence.people[0].identity.similarity, 0.82)
    assert.equal(evidence.people[0].identity.state, 'face_match')
    assert.deepEqual(evidence.people[1].identity, { trackId: 'track-b', state: 'unknown' })
    assert.equal(evidence.imageAssociation, 'no_image')
    assert.ok(!result.message.includes('Person One'))
    assert.ok(!result.message.includes('embedding'))
  } finally { if (token === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN; else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = token }
})

test('returned capture uses current identity evidence, never names an unrelated image or revives a stale match', async () => {
  const source = reset()
  const frame = { id: 'returned-2', timestamp: source.timestamp, source: 'robot-camera',
    metadata: { robotId: 'p4', gatewayInstance: 'gateway', epoch: 1, counter: 2 } }
  const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,returned' } }
  const inputs = { userInstruction: 'What do you see?', observation: source, sourceObservation: source,
    resultFrames: [frame], resultImages: [image], taskResult: { done: true },
    selectedTask: { program: null, taskDecision: null },
    routingAnalysis: { needsResponse: true, needsAction: false, taskContext: [], conversationContext: [] } }
  const run = async () => environmentContextBuilderNode.execute(inputs,
    { username: 'vision-user', sessionId: source.sessionId } as any, { purpose: 'conversation' }) as Promise<any>
  let result = await run()
  let recognition = JSON.parse(result.message).currentEnvironment.recognition
  assert.equal(recognition.people[0].identity.name, 'Person One')
  assert.equal(recognition.imageAssociation, 'different_frame')
  assert.deepEqual(recognition.matchingVisualFrameIds, [])
  assert.equal(result.messages[1].content[1].image_url.url, image.image_url.url)
  for (const key of ['epoch', 'counter', 'gatewayInstance', 'robotId'] as const) {
    const { buildEnvironmentSelectorEnvelope } = await import('./nodes/environment/helpers.js')
    const matched = { ...frame, metadata: { robotId: 'p4', gatewayInstance: 'gateway', epoch: 1, counter: 1, [key]: 'other' } }
    const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({ instruction: '', observation: source,
      visualFrames: [matched], recognition }))
    assert.deepEqual(envelope.currentEnvironment.recognition.matchingVisualFrameIds, [])
  }
  const expired = observation(Date.now() - 2000); reset(expired)
  result = await run()
  recognition = JSON.parse(result.message).currentEnvironment.recognition
  assert.equal(recognition.people, null)
  assert.equal(recognition.peopleCount, null)
  assert.ok(!JSON.stringify(recognition).includes('Person One'))
  source.state.recognition.enabled = false; reset(source)
  recognition = JSON.parse((await run()).message).currentEnvironment.recognition
  assert.equal(recognition.status, 'disabled')
  assert.equal(recognition.people, null)
})

test('authenticated perception telemetry retains measured rate without new work or accepting stale metrics', async () => {
  const now = Date.now(); const source = reset(observation(now))
  const token = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN; process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'status-fixture'
  const before = getQueueManager().getAllTasks().length
  const request: any = { path: '/api/environment-bridge/telemetry', method: 'POST',
    user: { userId: 'fixture', username: 'fixture', role: 'guest', isAuthenticated: false }, headers: { authorization: 'Bearer status-fixture' },
    body: { sessionId: source.sessionId, perception: { ...source.state.perception, frameCounter: 2 },
      recognitionReportedAt: new Date(now + 1).toISOString(), recognitionProcessing: { freshFps: 2.5, processedFps: 3, observationAgeMs: 50, arbitraryPayload: 'excluded' } } }
  try {
    assert.equal((await handleEnvironmentBridgeTelemetry(request)).status, 200)
    const live = await readRobotStatusLive('status-user', 'robot-session', now + 200)
    assert.equal(live.recognition.freshResultsPerSecond, 2.5)
    assert.equal(live.camera.lastFrameAgeMs, 250)
    request.body.recognitionProcessing.freshFps = 999
    assert.equal((await handleEnvironmentBridgeTelemetry(request) as any).data.perceptionAccepted, false)
    assert.equal((await readRobotStatusLive('status-user', 'robot-session', now + 200)).recognition.freshResultsPerSecond, 2.5)
    assert.equal(getQueueManager().getAllTasks().length, before)
  } finally { if (token === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN; else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = token }
})

test('actual active behavior graph exposes its current checkpoint through Robot Status', async () => {
  const source = reset()
  await import('./index.js')
  const { runDurableGraph, withGraphWork } = await import('./durable-execution/runtime.js')
  const { validateSvelteFlowGraph } = await import('./cognitive-graph-schema.js')
  const graph = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(new URL('../../../etc/cognitive-graphs/robot-active-task-mode.json', import.meta.url), 'utf8')))
  const manager = getQueueManager(); const username = 'actual-behavior'
  const work = manager.enqueue({ type: 'generic', username, handler: 'graph.resume', input: {} })
  const { subscribeEnvironmentActions } = await import('./environment-interface/store.js')
  const unsubscribe = subscribeEnvironmentActions(source.sessionId, () => {})
  const result = await withGraphWork(work, () => {}, () => runDurableGraph({ graph, context: {
    username, userId: username, sessionId: source.sessionId, environment: 'server', activeTaskSessionId: source.sessionId,
    activeProgram: { steps: [{ kind: 'behavior', target: 'current candidate person', completionCriteria: 'Until cancelled',
      motion: { type: 'move', continuous: true, direction: 'forward', speed: 40 }, candidateLabels: ['person'], identifyEveryFrames: 100, steering: null }] },
    activeTaskDecision: { outcome: 'act', objective: 'Observe candidate', reason: 'Directly selected fixture', objectiveComplete: false,
      completionCriteria: 'Until cancelled', requiredCompletionBasis: 'visual_observation' },
  } }), async input => manager.enqueue(input))
  unsubscribe()
  assert.equal(result.status, 'waiting', result.error?.stack)
  const live = await readRobotStatusLive(username, source.sessionId)
  const active = live.executions.find(item => item.executionId === result.executionId)!
  assert.equal(active.behavior?.target, 'current candidate person')
  assert.equal(active.behavior?.stepIndex, 0)
  assert.ok(active.unresolvedActionIds.length > 0)
  assert.equal(live.movement.physicalRestConfirmed, false)
})
