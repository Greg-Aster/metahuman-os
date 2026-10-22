import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { EnvironmentObservation } from '../../environment-interface/types.js'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-fast-body-event-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network or physical dispatch in body-event tests') }
const router = await import('../../model-router.js')
const calls: any[] = []
let inspectInference: (() => void) | undefined
const spoken = 'Gravity has filed another complaint.'
let generatedSpeech = spoken
let speechDisabled = false
mock.module('../../model-router.js', { namedExports: { ...router, callLLM: async (request: any) => {
  calls.push(request)
  inspectInference?.()
  return { content: JSON.stringify({ speech: generatedSpeech }) }
} } })
const voice = await import('../../tts/robot-speech.js')
mock.module('../../tts/robot-speech.js', { namedExports: { ...voice,
  getSpeechOutputSettings: () => ({ provider: 'kokoro', outputTarget: 'robot', speechDisabled }),
  getRobotSpeakerSession: () => { throw new Error('Event-bound speech must retain its supplied session') },
} })
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const published: any[] = []
mock.method(eventBus, 'emit', (...args: any[]) => { published.push(args) })
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const { fastBodyEventContextNode, fastBodyEventResponseNode } = await import('./fast-body-event.node.js')
const { loadGraphForMode } = await import('../../graph-streaming.js')
const { runDurableGraph, withGraphWork } = await import('../../durable-execution/runtime.js')
const { getQueueManager } = await import('../../queue/unified-queue-manager.js')
const { openExecutionStore } = await import('../../durable-execution/storage.js')
const { writeEnvironmentBridgeState, subscribeEnvironmentActions } = await import('../../environment-interface/store.js')
const { createUser } = await import('../../users.js')
const { withUserContext } = await import('../../context.js')
const { getProfilePaths } = await import('../../path-builder.js')
const { loadBufferForUser } = await import('../../conversation-buffer.js')
const username = 'fast-body-fixture'
const user = createUser(username, 'fixture-password-only', 'owner')
fs.mkdirSync(path.join(root, 'etc/cognitive-graphs'), { recursive: true })
for (const name of ['fast-body-event-mode.json', 'robot-speech-mode.json']) {
  fs.copyFileSync(path.join(repository, 'etc/cognitive-graphs', name), path.join(root, 'etc/cognitive-graphs', name))
}
const { graph } = await loadGraphForMode('fast-body-event', username)
const manager = getQueueManager()

function observation(kind: string, sessionId = `body-${kind}`) {
  const timestamp = '2026-10-19T15:00:00.123Z'
  return { sessionId, environmentId: 'ainekio', adapter: 'ainekio-gateway', timestamp,
    capabilities: { actions: ['faceExpression', 'speak'], expressionLibrary: [
      { name: 'confused', label: 'Confused' }, { name: 'surprised', label: 'Surprised' },
    ] }, state: { body: { authenticated: true, robotId: 'fixture-p4' },
      bodyEvent: { name: 'body_event', event_id: `${sessionId}-event`, robot_id: 'fixture-p4', epoch: 17,
        timestamp, data: { kind,
          ...(kind === 'servo_stall' ? { joints: [{ id: 0, name: 'rear_left_shoulder' }],
            reason: 'no_position_progress', outputs_released: true } : {}),
          tilt_degrees: 72.5, acceleration_change_g: 1.7, rotation_dps: 201.3,
          imu: { roll: 71.3, pitch: 8.4, acceleration: { x: 0.7, y: 0.8, z: 1.3 } },
          thresholds: { tilt_degrees: 60, acceleration_g: 0.75, rotation_dps: 180 },
          raw: { unknown_new_sensor: { measured: true, value: 37 } } } } } } satisfies EnvironmentObservation
}

for (const [kind, measurements, promptProperty] of [
  ['tipped', { tilt_degrees: 72.5 }, 'tippedPrompt'],
  ['rapid_movement', { acceleration_change_g: 1.7, rotation_dps: 201.3 }, 'rapidMovementPrompt'],
] as const) {
  test(`${kind} sends only its event kind and selected prompt while preserving complete event evidence`, async () => {
    const current = observation(kind)
    const originalEvent = JSON.stringify(current.state.bodyEvent)
    const properties = graph.nodes.find(node => node.id === 'event')!.data.properties!
    const result = await fastBodyEventContextNode.execute({}, { environmentObservation: current,
      conversationHistory: ['unrelated-history'], persona: { name: 'unrelated-persona' },
      robotStatus: { unrelated: true }, memories: ['unrelated-memory'] } as any, properties)
    const supplied = JSON.parse(result.messages[1].content)
    assert.deepEqual(supplied, { eventKind: kind })
    assert.equal(result.event, current.state.bodyEvent)
    assert.equal(JSON.stringify(result.event), originalEvent)
    assert.equal(JSON.stringify(current.state.bodyEvent), originalEvent)
    assert.equal(result.event.timestamp, current.timestamp)
    assert.equal(result.event.event_id, current.state.bodyEvent.event_id)
    assert.equal(result.event.robot_id, 'fixture-p4')
    assert.equal(result.sessionId, current.sessionId)
    assert.equal(result.eventKind, kind)
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0].content, properties[promptProperty])
    assert.deepEqual(result.jsonSchema.properties, { speech: { type: 'string' } })
    assert.doesNotMatch(JSON.stringify(result.messages), /unrelated-|thresholds|unknown_new_sensor|"imu"/)
    await assert.rejects(() => fastBodyEventContextNode.execute({}, { environmentObservation: current },
      { ...properties, [promptProperty]: '' }), /requires its reaction prompt/)
  })

  for (const present of [false, true]) {
    test(`${kind} keeps ${present ? 'zero measurements' : 'missing measurements'} in evidence without sending them to speech`, async () => {
      const current = observation(kind)
      const values = present ? Object.fromEntries(Object.keys(measurements).map(key => [key, 0])) : {}
      const event = { ...current.state.bodyEvent, data: { kind, ...values, unrelated_count: 17 } }
      const result = await fastBodyEventContextNode.execute({}, { environmentObservation: {
        ...current, state: { ...current.state, bodyEvent: event },
      } }, graph.nodes.find(node => node.id === 'event')!.data.properties)
      assert.deepEqual(JSON.parse(result.messages[1].content), { eventKind: kind })
      assert.equal(result.event, event)
      assert.deepEqual(result.event.data, { kind, ...values, unrelated_count: 17 })
      assert.equal(result.event.timestamp, current.timestamp)
      assert.equal(result.sessionId, current.sessionId)
    })
  }
}

for (const stallData of [
  { joints: [{ id: 0, name: 'rear_left_shoulder' }], reason: 'no_position_progress', outputs_released: true },
  { joints: [{ id: 7, name: 'front_left_carrier' }, { id: 11, name: 'front_right_crank' }],
    reason: 'no_position_progress', outputs_released: false },
  {},
]) {
  test(`servo stall preserves reported joint identities and release evidence (${JSON.stringify(stallData)})`, async () => {
    const current = observation('servo_stall')
    const event = { ...current.state.bodyEvent, data: { kind: 'servo_stall', ...stallData,
      joint_mask: 2048, command_sequence: 27, clock_us: 123456, unrelated_sensor: 'not speech context' } }
    const original = JSON.stringify(event)
    const properties = graph.nodes.find(node => node.id === 'event')!.data.properties!
    const result = await fastBodyEventContextNode.execute({}, { environmentObservation: {
      ...current, state: { ...current.state, bodyEvent: event },
    }, persona: 'not supplied', conversationHistory: ['not supplied'] } as any, properties)
    assert.deepEqual(JSON.parse(result.messages[1].content), { eventKind: 'servo_stall', ...stallData })
    assert.equal(result.messages[0].content, properties.motorStallPrompt)
    assert.equal(result.messages.length, 2)
    assert.equal(result.sessionId, current.sessionId)
    assert.equal(result.event, event)
    assert.equal(JSON.stringify(event), original)
    await assert.rejects(() => fastBodyEventContextNode.execute({}, { environmentObservation: {
      ...current, state: { ...current.state, bodyEvent: event },
    } }, { ...properties, motorStallPrompt: '' }), /requires its reaction prompt/)
  })
}

test('speech parser retains exact wording and exposes malformed output to the execution owner', async () => {
  const speech = '  I object to this gravitational arrangement.  '
  assert.deepEqual(await fastBodyEventResponseNode.execute({ response: JSON.stringify({ speech }) }, {}, {}), { speech })
  await assert.rejects(() => fastBodyEventResponseNode.execute({ response: 'not json' }, {}, {}), /must be JSON/)
  await assert.rejects(() => fastBodyEventResponseNode.execute({ response: '{"speech":null}' }, {}, {}), /requires speech/)
})

for (const [kind, expression, available, speechMode] of [
  ['tipped', 'confused', true, 'enabled'], ['rapid_movement', 'surprised', true, 'enabled'],
  ['tipped', 'confused', false, 'enabled'], ['rapid_movement', 'surprised', false, 'enabled'],
  ['tipped', 'confused', true, 'empty'], ['rapid_movement', 'surprised', true, 'disabled'],
  ['servo_stall', undefined, false, 'enabled'],
] as const) {
  test(`${kind} ${kind === 'servo_stall' ? 'delivers a help request without selecting a face' : available
    ? 'sets before inference and releases after outputs' : 'reports unavailable face without release'} with ${speechMode} speech`, async () => {
    await withUserContext({ username, userId: user.id, role: 'owner' }, async () => {
      generatedSpeech = speechMode === 'empty' ? '' : spoken
      speechDisabled = speechMode === 'disabled'
      const hasFeed = generatedSpeech !== ''
      const hasSpeech = hasFeed && !speechDisabled
      const current = observation(kind, `${kind}-${available}-${speechMode}`)
      if (!available && kind !== 'servo_stall') current.capabilities.actions = ['speak']
      const timestamp = new Date().toISOString()
      writeEnvironmentBridgeState({ enabled: true, updatedAt: timestamp, feedback: [], sessions: {
        [current.sessionId]: { sessionId: current.sessionId, environmentId: current.environmentId,
          adapter: current.adapter, status: 'connected', firstSeenAt: timestamp, lastSeenAt: timestamp,
          latestObservation: current },
      } })
      const unsubscribe = subscribeEnvironmentActions(current.sessionId, () => {})
      const countBefore = calls.length
      const publishedBefore = published.length
      let releaseAdmissions = 0
      inspectInference = () => {
        const faces = manager.getAllTasks().filter(task => task.input.sessionId === current.sessionId
          && task.type === 'environment_command' && task.input.type === 'faceExpression')
        assert.equal(faces.length, available ? 1 : 0)
        if (available) {
          assert.equal(faces[0].input.expression, expression)
          assert.equal(faces[0].state, 'queued', 'Inference starts without waiting for display acceptance or completion')
        }
        assert.equal(manager.getAllTasks().filter(task => task.input.sessionId === current.sessionId
          && task.handler === 'tts.robot-speech').length, 0)
      }
      const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'environment',
        username, input: {}, maxAttempts: 1 })
      try {
        assert.ok(manager.claim(work.id))
        const enqueue = async (input: any) => {
            if (input.input?.type === 'faceExpression' && input.input.displayRelease === true) {
              releaseAdmissions += 1
              assert.equal(calls.length, countBefore + 1)
              const speechWork = manager.getAllTasks().filter(task => task.input.sessionId === current.sessionId
                && task.handler === 'tts.robot-speech')
              assert.equal(speechWork.length, hasSpeech ? 1 : 0,
                'Expression release retains the original speech admission')
              assert.equal(published.slice(publishedBefore).filter(args => args[1] === 'conversation.feed').length,
                hasFeed ? 1 : 0, 'Expression release follows conversation publication')
            }
            return manager.enqueue(input)
          }
        const run = (executionId?: string) => withGraphWork(work, id => manager.attachExecution(work.id, id),
          () => runDurableGraph({ graph, executionId, context: { username, userId: user.id, cognitiveMode: 'environment',
            environmentObservation: current, environmentObservationCurrent: true, userMessage: '' } }), enqueue)
        let result = await run()
        if (hasSpeech && available) {
          assert.equal(result.status, 'waiting', result.error?.stack)
          assert.equal(releaseAdmissions, 0, 'Queued speech must not release the reaction face')
          const id = result.executionId!
          const effectId = result.nodes.get('speech')!.outputs!.delivery.deliveryId
          const evidence = openExecutionStore(username)
          try {
            evidence.appendEvent(id, { eventId: 'rendered', kind: 'work_result', payload: {
              effectId, result: { state: 'completed', result: { actionIds: ['chunk-1', 'chunk-2'] } },
            } })
            result = await run(id)
            assert.equal(result.status, 'waiting')
            evidence.appendEvent(id, { eventId: 'first-played', kind: 'physical_result', actionId: 'chunk-1',
              payload: { feedback: { type: 'completed' } } })
            result = await run(id)
            assert.equal(result.status, 'waiting')
            assert.equal(releaseAdmissions, 0, 'Every chunk must finish before face release')
            evidence.appendEvent(id, { eventId: 'last-played', kind: 'physical_result', actionId: 'chunk-2',
              payload: { feedback: { type: 'completed' } } })
            result = await run(id)
            assert.equal(result.nodes.get('release-face')?.status, 'completed', result.error?.stack)
          } finally { evidence.close() }
        }
        assert.equal(result.error, undefined)
        assert.equal(calls.length, countBefore + 1)
        const request = calls[countBefore]
        assert.equal(request.role, 'lightweight')
        assert.equal(request.options.enableThinking, false)
        assert.deepEqual(request.options.jsonSchema.required, ['speech'])
        assert.deepEqual(JSON.parse(request.messages[1].content), { eventKind: kind,
          ...(kind === 'servo_stall' ? { joints: current.state.bodyEvent.data.joints,
            reason: 'no_position_progress', outputs_released: true } : {}),
        })
        assert.deepEqual(result.nodes.get('event')?.outputs?.event, current.state.bodyEvent)
        const selectedFace = result.nodes.get(kind === 'tipped' ? 'tipped-face' : 'movement-face')!
        if (kind === 'servo_stall') assert.equal(selectedFace.status, 'skipped')
        else assert.equal(selectedFace.outputs?.success, available)
        assert.equal(result.nodes.get(kind === 'tipped' ? 'movement-face' : 'tipped-face')?.status, 'skipped')
        const release = result.nodes.get('release-face')!
        assert.equal(release.status, available ? 'completed' : 'skipped')
        assert.equal(releaseAdmissions, available ? 1 : 0)
        if (available) {
          assert.equal(release.outputs?.success, true)
          assert.equal(release.outputs?.token, selectedFace.outputs?.token)
          for (const id of ['feed', 'speech']) {
            const output = result.nodes.get(id)!
            assert.equal(output.status, hasFeed ? 'completed' : 'skipped')
            if (output.status === 'completed') assert.ok(output.endTime! <= release.startTime!,
              `${id} completes before the expression release node starts`)
          }
        }
        if (speechDisabled) assert.equal(result.nodes.get('speech')?.outputs?.queued, false)
        const speech = manager.getAllTasks().filter(task => task.handler === 'tts.robot-speech'
          && task.durable?.executionId === result.executionId)
        assert.equal(speech.length, hasSpeech ? 1 : 0)
        if (hasSpeech) {
          assert.equal(speech[0].input.sessionId, current.sessionId)
          assert.equal(speech[0].input.text, spoken)
        }
        const store = openExecutionStore(username)
        try {
          const effects = store.dispatches(result.executionId!)
          assert.equal(effects.filter(effect => effect.kind === 'buffer_entry').length, 0)
          assert.equal(effects.filter(effect => effect.kind === 'conversation_feed').length, hasFeed ? 1 : 0)
          assert.deepEqual(new Set(effects.map(effect => effect.kind)),
            new Set(hasFeed ? ['coordinator_work', 'conversation_feed'] : ['coordinator_work']))
          const display = effects.filter(effect => effect.kind === 'coordinator_work'
            && (effect.payload as any).input?.type === 'faceExpression')
          assert.equal(display.length, available ? 2 : 0)
          if (available) {
            const set = display.find(effect => (effect.payload as any).input.displayRelease === false)!
            const reset = display.find(effect => (effect.payload as any).input.displayRelease === true)!
            const setInput = (set.payload as any).input
            const resetInput = (reset.payload as any).input
            assert.equal(setInput.expression, expression)
            assert.equal(resetInput.displayToken, setInput.displayToken)
            assert.equal(resetInput.displayToken, selectedFace.outputs?.token)
            assert.equal(resetInput.sessionId, current.sessionId)
            assert.equal(resetInput.expression, undefined)
          }
          const feed = published.filter(args => args[1] === 'conversation.feed'
            && args[2]?.message?.meta?.executionId === result.executionId)
          assert.equal(feed.length, hasFeed ? 1 : 0)
          const count = manager.getAllTasks().length
          inspectInference = () => { throw new Error('Completed reaction must not be regenerated on resume') }
          await runDurableGraph({ graph, executionId: result.executionId, context: { username } })
          assert.equal(manager.getAllTasks().length, count)
          assert.equal(calls.length, countBefore + 1)
          assert.equal(releaseAdmissions, available ? 1 : 0)
          assert.equal(store.dispatches(result.executionId!).length, effects.length)
        } finally { store.close() }
        for (const mode of ['conversation', 'inner'] as const) assert.equal(loadBufferForUser(username, mode).messages.length, 0)
        const episodic = getProfilePaths(username).episodic
        const memories = fs.existsSync(episodic) ? fs.readdirSync(episodic, { recursive: true }).filter(file => String(file).endsWith('.json')) : []
        assert.equal(memories.length, 0)
      } finally {
        if (manager.getTask(work.id)?.state === 'leased') manager.complete(work.id, true)
        inspectInference = undefined
        generatedSpeech = spoken
        speechDisabled = false
        unsubscribe()
      }
    })
  })
}

after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })
