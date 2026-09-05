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
const { robotStatusOutNode } = await import('./nodes/robot-status/out.node.js')
const { robotStatusWriterNode } = await import('./nodes/robot-status/writer.node.js')
const { buildEnvironmentSelectorEnvelope } = await import('./nodes/environment/helpers.js')
const { robotActionResultParserNode } = await import('./nodes/robot-operator/action-result-parser.node.js')
const { robotGoalReviewParserNode } = await import('./nodes/robot-operator/goal-review-parser.node.js')

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

test('Robot Status Out persists the Environment LLM task and correlated action result without another model call', async () => {
  const username = 'robot-status-out-owner'
  const selectedAction = { type: 'robotCommand', command: 'walk_forward' }
  const initial = await robotStatusOutNode.execute!({
    observation: {
      sessionId: 'robot-1',
      environmentId: 'ainekio',
      timestamp: '2026-09-02T18:00:00.000Z',
      state: { posture: 'standing', body: { motionAvailable: true } },
      capabilities: {
        actions: ['robotCommand'],
        robotCommands: ['walk_forward'],
        movement: true,
        visual: true,
      },
    },
    instruction: 'Move closer to inspect the object.',
    userInstruction: 'Move closer to inspect the object.',
    inputSource: 'user',
    taskDecision: {
      objective: 'Inspect the object from closer range.',
      outcome: 'act',
      reason: 'The advertised forward walk is the appropriate current step.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'visual_observation',
      motionClass: 'open_loop_displacement',
      actionPurpose: 'information_gain',
      visualEvidenceMode: 'comparison',
    },
    actions: [selectedAction],
    response: 'I will move closer for a better view.',
    bridgeRecord: {
      status: 'coordinated_for_adapter',
      message: 'Queued for the robot adapter.',
      requestedActions: [selectedAction],
      commands: [{ id: 'action-2' }],
    },
    frames: [{
      id: 'before-action-2',
      timestamp: '2026-09-02T18:00:00.000Z',
      source: 'robot-camera',
      metadata: { correlationId: 'cycle-2' },
    }],
  }, { username })

  assert.equal(initial.persisted, true)
  assert.equal(initial.task.objective, 'Inspect the object from closer range.')
  assert.equal(initial.task.selectedAction.command, 'walk_forward')
  assert.equal(initial.task.actionId, 'action-2')
  assert.equal(initial.task.baselineFrame.id, 'before-action-2')
  assert.equal(initial.lastAction.command, 'walk_forward')

  const completed = await robotStatusOutNode.execute!({
    observation: {
      sessionId: 'robot-1',
      environmentId: 'ainekio',
      timestamp: '2026-09-02T18:00:05.000Z',
      state: { posture: 'standing', body: { motionAvailable: true } },
      capabilities: {
        actions: ['robotCommand'],
        robotCommands: ['walk_forward'],
        movement: true,
        visual: true,
      },
    },
    instruction: 'Move closer to inspect the object.',
    inputSource: 'user',
    taskDecision: {
      objective: 'Inspect the object from closer range.',
      outcome: 'complete',
      reason: 'The correlated result and current view satisfy the objective.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'visual_observation',
      completionEvidence: 'The object occupies more of the current view.',
    },
    terminalFeedback: {
      id: 'feedback-2',
      timestamp: '2026-09-02T18:00:05.000Z',
      type: 'completed',
      actionId: 'action-2',
      message: 'Forward walk completed.',
    },
    actionContext: { actionId: 'action-2', requested: selectedAction },
    bridgeRecord: { status: 'no_actions', message: 'No further action selected.' },
  }, { username })

  assert.equal(completed.task.decision.objectiveComplete, true)
  assert.equal(completed.task.actionStatus, 'completed')
  assert.equal(completed.task.feedback.actionId, 'action-2')
  assert.equal(completed.lastAction.command, 'walk_forward')
  assert.equal(completed.lastAction.status, 'completed')
  assert.equal(completed.status.situation.currentGoal, '')
  assert.equal(loadRobotStatus(username)?.task?.decision.outcome, 'complete')
})

test('Robot Status Out persists the durable objective explicitly selected for an autonomous next step', async () => {
  const username = 'robot-status-goal-continuation-owner'
  await robotStatusOutNode.execute!({
    taskDecision: {
      objective: 'Find the cat.',
      outcome: 'continue',
      reason: 'A better-lit viewpoint may provide useful evidence.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The latest view is too dark to establish the cat location.',
      nextInstruction: 'Move to a better-lit area and continue looking for the cat.',
    },
  }, { username })

  const delegatedStep = await robotStatusOutNode.execute!({
    instruction: 'Move to a better-lit area and continue looking for the cat.',
    inputSource: 'autonomy',
    taskDecision: {
      objective: 'Find the cat.',
      outcome: 'act',
      reason: 'Changing viewpoint may improve the available visual evidence.',
      objectiveComplete: false,
      requiredCompletionBasis: 'action_result',
    },
    actions: [{ type: 'robotCommand', command: 'walk_forward' }],
    bridgeRecord: {
      status: 'coordinated_for_adapter',
      requestedActions: [{ type: 'robotCommand', command: 'walk_forward' }],
      commands: [{ id: 'continuation-action' }],
    },
  }, { username })

  assert.equal(delegatedStep.task.objective, 'Find the cat.')
  assert.equal(delegatedStep.task.instruction, 'Move to a better-lit area and continue looking for the cat.')
  assert.equal(delegatedStep.task.source, 'user')
  assert.equal(delegatedStep.task.selectedAction.command, 'walk_forward')
})

test('Robot Status Out does not replace an unfinished task for a standalone action', async () => {
  const username = 'robot-status-standalone-action-owner'
  await robotStatusOutNode.execute!({
    instruction: 'Locate the missing object.',
    userInstruction: 'Locate the missing object.',
    inputSource: 'user',
    taskDecision: {
      objective: 'Locate the missing object.',
      outcome: 'act',
      reason: 'A new viewpoint is needed.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
    },
    actions: [{ type: 'captureImage', target: 'current_surroundings' }],
    bridgeRecord: {
      status: 'coordinated_for_adapter',
      requestedActions: [{ type: 'captureImage', target: 'current_surroundings' }],
      commands: [{ id: 'search-capture' }],
    },
  }, { username })

  const standalone = await robotStatusOutNode.execute!({
    instruction: 'Turn right forty-five degrees.',
    userInstruction: 'Turn right forty-five degrees.',
    inputSource: 'user',
    taskDecision: null,
    actions: [{ type: 'robotCommand', command: 'turn_right_45' }],
    bridgeRecord: {
      status: 'coordinated_for_adapter',
      requestedActions: [{ type: 'robotCommand', command: 'turn_right_45' }],
      commands: [{ id: 'standalone-turn' }],
    },
  }, { username })

  assert.equal(standalone.task.objective, 'Locate the missing object.')
  assert.equal(standalone.task.actionId, 'search-capture')
  assert.equal(standalone.lastAction.command, 'turn_right_45')
  assert.equal(standalone.lastAction.actionId, 'standalone-turn')

  const returned = await robotStatusOutNode.execute!({
    taskDecision: null,
    terminalFeedback: {
      type: 'completed',
      actionId: 'standalone-turn',
      message: 'Turn completed.',
    },
    actionContext: {
      actionId: 'standalone-turn',
      requested: { type: 'robotCommand', command: 'turn_right_45' },
    },
  }, { username })

  assert.equal(returned.task.objective, 'Locate the missing object.')
  assert.equal(returned.task.actionId, 'search-capture')
  assert.equal(returned.lastAction.command, 'turn_right_45')
  assert.equal(returned.lastAction.status, 'completed')
})

test('Robot Status Out applies LLM-assessed current-objective evidence regardless of the triggering action ID', async () => {
  const username = 'robot-status-overlapping-result-owner'
  await robotStatusOutNode.execute!({
    instruction: 'Inspect the work area.',
    userInstruction: 'Inspect the work area.',
    inputSource: 'user',
    taskDecision: {
      objective: 'Inspect the work area.',
      outcome: 'act',
      reason: 'A current image is needed.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
    },
    actions: [{ type: 'captureImage', target: 'current_surroundings' }],
    bridgeRecord: {
      status: 'coordinated_for_adapter',
      requestedActions: [{ type: 'captureImage', target: 'current_surroundings' }],
      commands: [{ id: 'current-capture' }],
    },
  }, { username })

  const result = await robotStatusOutNode.execute!({
    taskDecision: {
      objective: 'Inspect the work area.',
      outcome: 'complete',
      reason: 'The current visual evidence establishes the saved objective.',
      objectiveComplete: true,
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The work area is visible in the current camera frame.',
    },
    terminalFeedback: {
      type: 'completed',
      actionId: 'earlier-autonomy-action',
      message: 'done',
    },
    actionContext: {
      actionId: 'earlier-autonomy-action',
      requested: { type: 'robotCommand', command: 'curious' },
    },
  }, { username })

  assert.equal(result.task.objective, 'Inspect the work area.')
  assert.equal(result.task.decision.objectiveComplete, true)
  assert.equal(result.task.source, 'user')
  assert.equal(result.status.situation.currentGoal, '')
  assert.equal(result.lastAction.actionId, 'earlier-autonomy-action')
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

test('Robot Status has one editable refresh graph and is read and written by action executors', () => {
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
    assert.equal(consumer.nodes.filter((node: any) => node.data?.nodeType === 'robot_status_out').length, 1)
    assert.equal(consumer.edges.some((edge: any) => edge.targetHandle === 'robotStatus'), true)
    assert.equal(consumer.edges.some((edge: any) => edge.targetHandle === 'bridgeRecord'
      && consumer.nodes.find((node: any) => node.id === edge.target)?.data?.nodeType === 'robot_status_out'), true)
    for (const retired of [
      'environment_task_input',
      'environment_task_preparation',
      'environment_task_reducer',
    ]) {
      assert.equal(consumer.nodes.some((node: any) => node.data?.nodeType === retired), false)
    }
  }

  for (const planner of ['boredom-observer', 'boredom-movement', 'boredom-reflection']) {
    const graph = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, `etc/cognitive-graphs/${planner}-mode.json`),
      'utf8',
    ))
    const statusNodes = graph.nodes.filter((node: any) => node.data?.nodeType === 'robot_status')
    assert.equal(statusNodes.length, 1)
    assert.equal(graph.edges.some((edge: any) => (
      edge.source === statusNodes[0].id
      && edge.sourceHandle === 'context'
      && edge.targetHandle === 'robotStatus'
    )), true)
  }
})

test('Robot task lifecycle persists one result and delegates at most one later instruction', async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../..')
  const readGraph = (name: string) => JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, `etc/cognitive-graphs/${name}-mode.json`),
    'utf8',
  ))
  const environment = readGraph('environment')
  const autonomy = readGraph('boredom-autonomy')
  const resultGraph = readGraph('robot-action-result')
  const reviewGraph = readGraph('robot-goal-review')

  for (const graph of [environment, autonomy]) {
    const bridge = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_send_action')
    assert.equal(bridge?.data?.properties?.feedbackGraph, 'robot-action-result')
    assert.notEqual(bridge?.data?.properties?.feedbackGraph, graph === environment ? 'environment' : 'boredom-autonomy')
  }

  const resultTypes = resultGraph.nodes.map((node: any) => node.data?.nodeType)
  assert.equal(resultTypes.filter((type: string) => type === 'model_router').length, 1)
  assert.equal(resultTypes.filter((type: string) => type === 'robot_status_out').length, 1)
  assert.equal(resultTypes.filter((type: string) => type === 'environment_action_context_input').length, 1)
  assert.equal(
    resultGraph.nodes.find((node: any) => node.data?.nodeType === 'environment_action_context_input')?.data?.label,
    'Verify Matched Sent Action',
  )
  assert.equal(resultTypes.includes('environment_send_action'), false)
  assert.equal(resultTypes.includes('robot_operator_environment_dispatch'), false)

  const resultPolicy = resultGraph.nodes.find((node: any) => node.data?.label === 'Action Result Interpretation Task')
  assert.match(resultPolicy?.data?.properties?.message, /use response for one concise, natural sentence/i)
  assert.equal(resultGraph.edges.some((edge: any) => (
    edge.source === 'parser'
    && edge.sourceHandle === 'response'
    && edge.target === 'conversation'
    && edge.targetHandle === 'response'
  )), true)

  const reviewTypes = reviewGraph.nodes.map((node: any) => node.data?.nodeType)
  assert.equal(reviewTypes.filter((type: string) => type === 'model_router').length, 1)
  assert.equal(reviewTypes.filter((type: string) => type === 'robot_status_out').length, 1)
  assert.equal(reviewTypes.filter((type: string) => type === 'robot_operator_environment_dispatch').length, 1)
  assert.equal(reviewTypes.filter((type: string) => type === 'environment_image_input').length, 1)
  assert.equal(reviewTypes.includes('environment_send_action'), false)
  assert.equal(reviewTypes.includes('conditional_branch'), false)
  assert.deepEqual(
    reviewGraph.nodes
      .filter((node: any) => node.data?.nodeType === 'conversation_history')
      .map((node: any) => node.data?.properties?.mode)
      .sort(),
    ['conversation', 'inner', 'robot'],
  )
  assert.equal(
    reviewGraph.nodes.find((node: any) => node.data?.nodeType === 'model_router')?.data?.properties?.role,
    'persona',
  )
  assert.equal(reviewGraph.edges.some((edge: any) => (
    edge.source === 'parser'
    && edge.sourceHandle === 'executorDecision'
    && edge.target === 'prompt-out'
    && edge.targetHandle === 'decision'
  )), true)

  const interpreted = await robotActionResultParserNode.execute({
    response: JSON.stringify({
      response: '',
      taskDecision: {
        overallObjectiveState: 'not_achieved',
        reason: 'The requested turn completed, but the target is not visible.',
        objective: 'Find the cat.',
        requiredCompletionBasis: 'visual_observation',
        observationSummary: 'The new view contains no visible cat.',
        completionEvidence: '',
      },
    }),
  }, {})
  assert.equal(interpreted.taskDecision.objectiveComplete, false)
  assert.equal('decision' in interpreted, false)

  const reviewed = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'continue',
      reason: 'Another viewpoint may reveal the target.',
      objective: 'Find the cat.',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The last view did not contain the cat.',
      completionEvidence: '',
      nextInstruction: 'Inspect a different open area for the cat.',
    }),
  }, {}, {})
  assert.deepEqual(reviewed.executorDecision, {
    observed: 'The last view did not contain the cat.',
    instruction: 'Inspect a different open area for the cat.',
    reason: 'Another viewpoint may reveal the target.',
  })
})
