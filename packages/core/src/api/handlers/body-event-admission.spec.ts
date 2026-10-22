import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'body-event-admission-'))
process.env.METAHUMAN_ROOT = root
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-token'
globalThis.fetch = async () => { throw new Error('No network in event admission tests') }
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { handleEnvironmentBridgeObservation, environmentObservationNeedsCognition } = await import('./environment-bridge.js')
const { getQueueManager } = await import('../../queue/index.js')
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

test('bridge admits a body event once into its separate workflow and leaves telemetry as state', async () => {
  const observation = { id: 'body-event-observation', sessionId: 'p4-session', environmentId: 'ainekio',
    adapter: 'ainekio-gateway', timestamp: new Date().toISOString(), capabilities: { actions: [] },
    metadata: { perceptionEvent: 'body_event' },
    state: { body: { robotId: 'p4', authenticated: true }, bodyEvent: { name: 'body_event',
      event_id: 'boot-7-1', robot_id: 'p4', epoch: 1, data: { kind: 'wake', reason: 'boot' } } } }
  const req: any = { path: '/api/environment-bridge/observation', method: 'POST', body: observation,
    user: { userId: 'fixture', username: 'fixture', role: 'owner', isAuthenticated: true },
    headers: { authorization: 'Bearer fixture-token', 'x-metahuman-environment-graph': 'environment' } }
  const first = await handleEnvironmentBridgeObservation(req, () => 'fixture')
  assert.equal(first.status, 200, JSON.stringify(first.data))
  const data: any = first.data
  assert.equal(data.graphQueued, true)
  assert.equal(getQueueManager().getTask(data.workId)?.input.graph, 'body-event-trigger')
  const replay = await handleEnvironmentBridgeObservation(req, () => 'fixture')
  assert.equal(replay.status, 200)
  assert.equal((replay.data as any).workId, data.workId)
  assert.equal(environmentObservationNeedsCognition({ ...observation, metadata: {}, state: { body: observation.state.body } }), false)
})

test('spoken Stop carrying an earlier body event reaches Environment Mode unchanged', async () => {
  const timestamp = new Date().toISOString()
  const body = { id: 'spoken-stop', sessionId: 'speech-session', environmentId: 'ainekio',
    adapter: 'ainekio-gateway', timestamp, capabilities: { actions: ['stop'] },
    metadata: { perceptionEvent: 'audio_utterance', audioUtteranceId: 'speech-1' },
    text: [{ id: 'speech-1', source: 'player', text: 'Please stop.', timestamp, channel: 'microphone' }],
    state: { bodyEvent: { name: 'body_event', event_id: 'earlier-movement', data: { kind: 'rapid_movement' } } } }
  const response = await handleEnvironmentBridgeObservation({ body, headers: {
    authorization: 'Bearer fixture-token', 'x-metahuman-environment-graph': 'environment',
  } } as any, () => 'fixture')
  assert.equal(response.status, 200)
  const work = getQueueManager().getTask((response.data as any).workId)
  assert.equal(work?.input.graph, 'environment')
  assert.deepEqual(work?.input.observation.text, body.text)
  assert.deepEqual(work?.input.observation.state.bodyEvent, body.state.bodyEvent)
  assert.equal(environmentObservationNeedsCognition({ ...body, text: [], metadata: {} } as any), false,
    'A retained event in a state snapshot is context, not another event invocation')
})

for (const kind of ['tipped', 'rapid_movement', 'servo_stall']) {
  test(`${kind} uses the fast body workflow without duplicate admission`, async () => {
    const timestamp = new Date().toISOString()
    const observation = { id: `${kind}-observation`, sessionId: `session-${kind}`, environmentId: 'ainekio',
      adapter: 'ainekio-gateway', timestamp, capabilities: { actions: [] },
      metadata: { perceptionEvent: 'body_event' },
      state: { bodyEvent: { name: 'body_event', event_id: `${kind}-event`, data: {
        kind, ...(kind === 'servo_stall' ? { joints: [{ id: 0, name: 'rear_left_shoulder' }],
          reason: 'no_position_progress', outputs_released: true } : { source: 'imu' }),
      } } } }
    const req: any = { body: observation, headers: { authorization: 'Bearer fixture-token' } }
    const response = await handleEnvironmentBridgeObservation(req, () => 'fixture')
    assert.equal(response.status, 200)
    const work = getQueueManager().getTask((response.data as any).workId)
    assert.equal(work?.input.graph, 'fast-body-event')
    assert.deepEqual(work?.input.observation.state.bodyEvent, observation.state.bodyEvent)
    const replay = await handleEnvironmentBridgeObservation(req, () => 'fixture')
    assert.equal((replay.data as any).workId, work?.id)
  })
}
