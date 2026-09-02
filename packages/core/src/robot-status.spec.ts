import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const originalRoot = process.env.METAHUMAN_ROOT
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-robot-status-'))
process.env.METAHUMAN_ROOT = testRoot

const {
  loadRobotStatus,
  parseRobotStatusSituation,
  robotStatusPath,
  saveRobotStatus,
} = await import('./robot-status.js')
const { robotStatusContextBuilderNode } = await import('./nodes/robot-status/context-builder.node.js')
const { robotStatusNode } = await import('./nodes/robot-status/status.node.js')
const { robotStatusWriterNode } = await import('./nodes/robot-status/writer.node.js')
const { buildEnvironmentSelectorEnvelope } = await import('./nodes/environment/helpers.js')

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true })
  if (originalRoot === undefined) delete process.env.METAHUMAN_ROOT
  else process.env.METAHUMAN_ROOT = originalRoot
})

const situation = {
  situationalSummary: 'Connected and attentive beside the work area.',
  environmentDescription: 'A dim work area is the latest supported environment context.',
  currentGoal: 'Continue inspecting the work area.',
  currentIntent: 'Use the next fresh observation to choose a useful continuation.',
  userContext: 'The user is working nearby.',
  uncertainties: ['No fresh image was supplied to this status update.'],
}

const sources = {
  sourceUpdatedAt: {
    environment: '2026-08-27T18:00:00.000Z',
    telemetry: '2026-08-27T18:00:01.000Z',
    conversation: '2026-08-27T18:00:02.000Z',
    robotHistory: '2026-08-27T18:00:03.000Z',
    agency: '2026-08-27T18:00:04.000Z',
  },
  body: {
    sessionId: 'robot-1',
    environmentId: 'ainekio',
    connectionStatus: 'connected',
    observationAt: '2026-08-27T18:00:00.000Z',
    telemetryAt: '2026-08-27T18:00:01.000Z',
    battery: {
      voltage: 7.4,
      observedAt: '2026-08-27T18:00:01.000Z',
    },
    motion: {
      available: true,
      activity: 'idle',
      observedAt: '2026-08-27T18:00:00.000Z',
    },
    state: { posture: 'standing' },
    telemetry: { vbat: 7.4 },
    capabilities: { actions: ['robotCommand'], robotCommands: ['wave'] },
  },
  lastAction: {
    actionId: 'action-1',
    type: 'robotCommand',
    command: 'wave',
    description: 'Wave.',
    status: 'completed',
    message: 'Wave completed.',
    completedAt: '2026-08-27T18:00:03.000Z',
  },
  activeDesires: [{
    id: 'desire-1',
    title: 'Find the cat',
    description: 'Look for the cat in the room.',
    reason: 'The cat has not been seen recently.',
    status: 'planning',
    strength: 0.9,
    updatedAt: '2026-08-27T18:00:04.000Z',
  }],
}

test('Robot Status strictly validates semantic model output', () => {
  assert.deepEqual(parseRobotStatusSituation(situation), situation)
  assert.throws(
    () => parseRobotStatusSituation({ ...situation, action: 'walk' }),
    /exactly the six situation fields/,
  )
  assert.throws(
    () => parseRobotStatusSituation({ ...situation, situationalSummary: '' }),
    /requires a situationalSummary/,
  )
})

test('Robot Status storage keeps deterministic facts and bounded history in one profile snapshot', () => {
  const username = 'robot-status-owner'
  const first = saveRobotStatus(username, situation, sources)
  assert.deepEqual(first.body?.battery, {
    voltage: 7.4,
    observedAt: '2026-08-27T18:00:01.000Z',
  })
  assert.deepEqual(first.body?.motion, {
    available: true,
    activity: 'idle',
    observedAt: '2026-08-27T18:00:00.000Z',
  })
  assert.equal(first.body?.telemetry.vbat, 7.4)
  assert.equal(first.lastAction?.status, 'completed')
  assert.equal(first.agency.activeDesires[0]?.title, 'Find the cat')
  assert.deepEqual(first.history, [])

  for (let index = 0; index < 10; index += 1) {
    saveRobotStatus(username, {
      ...situation,
      situationalSummary: `Status update ${index}`,
    }, sources)
  }
  const loaded = loadRobotStatus(username)
  assert.equal(loaded?.history.length, 8)
  assert.equal(loaded?.history.at(-1)?.situationalSummary, 'Status update 8')
  assert.equal(robotStatusPath(username), path.join(testRoot, 'profiles', username, 'state', 'robot-status.json'))
})

test('Robot Status context separates current facts from bounded narrative context', async () => {
  const robotCommands = [
    '#1',
    '#2',
    ...Array.from({ length: 40 }, (_value, index) => `motion_${String(index + 1).padStart(2, '0')}`),
  ]
  const result = await robotStatusContextBuilderNode.execute!({
    instruction: 'Return the compact status JSON.',
    environmentSummary: {
      sessions: [{
        sessionId: 'robot-1',
        environmentId: 'ainekio',
        status: 'connected',
        lastSeenAt: '2026-08-27T18:00:00.000Z',
        latestObservation: {
          timestamp: '2026-08-27T18:00:00.000Z',
          state: { posture: 'standing', body: { motionAvailable: true } },
          location: { label: 'work area' },
          visual: {
            id: 'frame-1',
            timestamp: '2026-08-27T18:00:00.000Z',
            source: 'robot-camera',
            dataUrl: 'data:image/jpeg;base64,secret-image-data',
          },
          capabilities: {
            actions: ['robotCommand'],
            robotCommands,
            movement: true,
            visual: true,
          },
        },
      }],
    },
    robotTelemetry: [{
      sessionId: 'robot-1',
      updatedAt: '2026-08-27T18:00:01.000Z',
      robotStatus: { vbat: 7.4, state: 'idle' },
    }],
    conversationHistory: [{
      role: 'user',
      content: 'Please keep looking for the cat.',
      timestamp: '2026-08-27T18:00:02.000Z',
    }],
    robotHistory: [{
      role: 'robot',
      timestamp: '2026-08-27T18:00:03.000Z',
      meta: {
        bridgeRecord: {
          direction: 'inbound',
          status: 'completed',
          actionId: 'action-1',
          message: 'Wave completed.',
          action: { id: 'action-1', type: 'robotCommand', command: 'wave' },
        },
      },
    }],
    activeDesires: sources.activeDesires,
    previousStatus: { situation, history: [{ currentGoal: 'Find the cat' }] },
  }, {})

  assert.equal(result.sourceFacts.body.telemetry.vbat, 7.4)
  assert.deepEqual(result.sourceFacts.body.battery, {
    voltage: 7.4,
    observedAt: '2026-08-27T18:00:01.000Z',
  })
  assert.deepEqual(result.sourceFacts.body.motion, {
    available: true,
    activity: 'idle',
    observedAt: '2026-08-27T18:00:00.000Z',
  })
  assert.equal(result.sourceFacts.lastAction.command, 'wave')
  assert.equal(result.sourceFacts.lastAction.status, 'completed')
  assert.equal(result.sourceFacts.activeDesires[0].title, 'Find the cat')
  assert.deepEqual(result.sourceFacts.body.capabilities.robotCommands, robotCommands)
  assert.equal(result.context.environmentEvidence.location.label, 'work area')
  assert.equal(JSON.stringify(result.context).includes('secret-image-data'), false)
  assert.equal(result.messages.length, 2)
})

test('Robot Status retains the semantic description of the last generated movement', async () => {
  const result = await robotStatusContextBuilderNode.execute!({
    instruction: 'Return the compact status JSON.',
    robotHistory: [{
      role: 'robot',
      timestamp: '2026-08-27T18:00:03.000Z',
      meta: {
        bridgeRecord: {
          direction: 'inbound',
          status: 'completed',
          actionId: 'motion-1',
          message: 'done',
          action: {
            id: 'motion-1',
            type: 'robotMotionPlan',
            frames: [{ durationMs: 500, targets: [] }],
            endPose: 'stand',
            metadata: {
              motionSummary: 'Raised both front legs, paused, then returned to standing.',
            },
          },
        },
      },
    }],
  }, {})

  assert.equal(
    result.sourceFacts.lastAction.description,
    'Raised both front legs, paused, then returned to standing.',
  )
})

test('Robot Status writer and reusable input node share the same canonical snapshot', async () => {
  const username = 'robot-status-writer-owner'
  const written = await robotStatusWriterNode.execute!({
    response: JSON.stringify(situation),
    sourceFacts: sources,
  }, { username })
  assert.equal(written.persisted, true)
  assert.equal(written.event.meta.type, 'robot_status')
  assert.match(written.event.content, /^Robot Status saved\.\n/)
  assert.match(written.event.content, /Robot: robot-1 \(connected\)/)
  assert.match(written.event.content, /Battery: 7\.4 V/)
  assert.match(written.event.content, /Motion: available \(idle\)/)
  assert.match(written.event.content, /Last action: Wave\. — completed/)
  assert.match(written.event.content, /Environment: A dim work area is the latest supported environment context\./)
  assert.match(written.event.content, /Goal: Continue inspecting the work area\./)
  assert.match(written.event.content, /Intent: Use the next fresh observation to choose a useful continuation\./)
  assert.match(written.event.content, /User context: The user is working nearby\./)
  assert.match(written.event.content, /Active desires: Find the cat \(planning\)/)
  assert.match(written.event.content, /Uncertainties: No fresh image was supplied to this status update\./)
  assert.equal(written.event.content.includes(situation.situationalSummary), false)

  const read = await robotStatusNode.execute!({}, { username }, { historyLimit: 3 })
  assert.equal(read.found, true)
  assert.equal(read.status.updatedAt, written.status.updatedAt)
  assert.equal(read.context.situation.currentGoal, situation.currentGoal)
  assert.equal(read.context.body.battery.voltage, 7.4)
  assert.equal(read.context.body.motion.available, true)
  assert.equal(read.context.lastAction.command, 'wave')
  assert.equal(read.context.agency.activeDesires[0].title, 'Find the cat')
  assert.equal(read.context.agency.activeDesires[0].reason, 'The cat has not been seen recently.')
  assert.equal('telemetry' in read.context.body, false)
  assert.equal('capabilities' in read.context.body, false)
  assert.equal(JSON.stringify(read.context).length < 6_000, true)
  assert.deepEqual(Object.keys(read.historyContext).sort(), ['history', 'situation', 'updatedAt'])
})

test('Environment selector receives the decision-bearing Robot Status fields', async () => {
  const username = 'robot-status-environment-owner'
  await robotStatusWriterNode.execute!({
    response: JSON.stringify(situation),
    sourceFacts: sources,
  }, { username })
  const read = await robotStatusNode.execute!({}, { username }, { historyLimit: 3 })
  const envelope = JSON.parse(buildEnvironmentSelectorEnvelope({
    instruction: 'Continue the current goal.',
    observation: {
      sessionId: 'robot-1',
      environmentId: 'ainekio',
      timestamp: '2026-08-27T18:05:00.000Z',
      state: {},
      capabilities: {
        actions: ['robotCommand'],
        robotCommands: ['wave'],
        motionClasses: ['body_local'],
        navigation: false,
        visual: true,
        movement: true,
      },
    },
    robotStatus: read.context,
  } as any))

  assert.equal(envelope.robotStatus.body.battery.voltage, 7.4)
  assert.equal(envelope.robotStatus.body.motion.available, true)
  assert.equal(envelope.robotStatus.lastAction.command, 'wave')
  assert.equal(envelope.robotStatus.situation.currentGoal, situation.currentGoal)
  assert.equal(envelope.robotStatus.agency.activeDesires[0].title, 'Find the cat')
  assert.equal(envelope.robotStatus.agency.activeDesires[0].reason, 'The cat has not been seen recently.')
})

test('Robot Status has one editable graph and is consumed only after boredom planning', () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
  const graphPath = path.join(repositoryRoot, 'etc/cognitive-graphs/robot-status-mode.json')
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  const nodeTypes = graph.nodes.map((node: any) => node.data?.nodeType)
  assert.equal(nodeTypes.filter((type: string) => type === 'model_router').length, 1)
  assert.equal(nodeTypes.filter((type: string) => type === 'robot_status_writer').length, 1)
  assert.equal(nodeTypes.filter((type: string) => type === 'system_buffer').length, 1)
  assert.equal(nodeTypes.includes('active_desires'), true)
  assert.equal(nodeTypes.includes('environment_send_action'), false)
  assert.equal(nodeTypes.includes('robot_buffer'), false)

  for (const workflow of ['environment', 'boredom-autonomy']) {
    const consumer = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, `etc/cognitive-graphs/${workflow}-mode.json`),
      'utf8',
    ))
    assert.equal(consumer.nodes.filter((node: any) => node.data?.nodeType === 'robot_status').length, 1)
    assert.equal(consumer.edges.some((edge: any) => edge.targetHandle === 'robotStatus'), true)
  }

  for (const planner of ['boredom-observer', 'boredom-movement', 'boredom-reflection']) {
    const graph = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, `etc/cognitive-graphs/${planner}-mode.json`),
      'utf8',
    ))
    assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'robot_status'), false)
    assert.equal(graph.edges.some((edge: any) => edge.targetHandle === 'robotStatus'), false)
  }
})
