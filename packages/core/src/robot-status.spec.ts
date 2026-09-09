import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { SvelteFlowGraph } from './cognitive-graph-schema.js'

const originalRoot = process.env.METAHUMAN_ROOT
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-robot-status-'))
process.env.METAHUMAN_ROOT = testRoot
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the Robot Status fixture') }
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('./audit.js')
setAuditEnabled(false)

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
const { runDurableGraph } = await import('./durable-execution/runtime.js')
const { openExecutionStore } = await import('./durable-execution/storage.js')
const { ExecutionCheckpointer } = await import('./durable-execution/checkpointer.js')
const { validateSvelteFlowGraph, DEFAULT_GRAPH_SCHEDULER } = await import('./cognitive-graph-schema.js')

// Literal fixture inputs use the existing Text Input/JSON Parser contracts. The
// real output nodes commit through the canonical graph saver and projection relay.
async function statusGraph(username: string, steps: Array<{ type?: 'robot_status_out' | 'robot_status_writer'; inputs: Record<string, unknown> }>) {
  const graph: SvelteFlowGraph = { name: 'Robot Status owner fixture', version: '1.0', format: 'svelte-flow',
    scheduler: DEFAULT_GRAPH_SCHEDULER, nodes: [], edges: [] }
  const addNode = (id: string, nodeType: string, properties: Record<string, unknown> = {}) => {
    graph.nodes.push({ id, type: 'genericNode', position: { x: graph.nodes.length * 100, y: 0 },
      data: { label: id, nodeType, properties } })
  }
  for (const [index, step] of steps.entries()) {
    const id = `status-${index}`
    addNode(id, step.type ?? 'robot_status_out')
    for (const [field, value] of Object.entries(step.inputs)) {
      const input = `${id}-${field}`
      const parsed = `${input}-json`
      const isText = typeof value === 'string'
      addNode(input, 'text_input', { message: isText ? value : JSON.stringify(value) })
      if (!isText) {
        addNode(parsed, 'json_parser')
        graph.edges.push({ id: `${input}-parse`, source: input, sourceHandle: 'text', target: parsed, targetHandle: 'text' })
      }
      graph.edges.push({ id: `${input}-out`, source: isText ? input : parsed,
        sourceHandle: isText ? 'text' : 'data', target: id, targetHandle: field })
    }
    if (index) graph.edges.push({ id: `${id}-ordered`, source: `status-${index - 1}`, sourceHandle: 'status',
      target: id, targetHandle: '', data: { kind: 'control' } })
  }
  const result = await runDurableGraph({ graph: validateSvelteFlowGraph(graph),
    context: { username, userId: username, requestId: randomUUID(), environment: 'server' } })
  assert.equal(result.status, 'completed', result.error?.stack)
  const outputs = steps.map((_, index) => {
    const node = result.nodes.get(`status-${index}`)
    assert.equal(node?.status, 'completed')
    return node!.outputs!
  })
  const store = openExecutionStore(username)
  try {
    assert.equal(store.pendingDispatches().filter(dispatch => dispatch.executionId === result.executionId).length, 0,
      'Every status projection must have a committed delivery receipt')
  } finally { store.close() }
  return { executionId: result.executionId!, outputs }
}

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
    status: 'planning' as const,
    nextAction: 'desire-agent' as const,
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

test('Robot Status output nodes require the checkpoint owner rather than writing tasks independently', async () => {
  await assert.rejects(robotStatusOutNode.execute!({ taskDecision: { objective: 'An unowned task.' } },
    { username: 'unowned-status-output' }), /requires checkpointed execution/)
  await assert.rejects(robotStatusWriterNode.execute!({ response: JSON.stringify(situation), sourceFacts: sources },
    { username: 'unowned-status-output' }), /requires checkpointed execution/)
  assert.equal(loadRobotStatus('unowned-status-output'), null)
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

test('Robot Status projects execution lifecycle without rewriting or reviving its objective', async () => {
  for (const state of ['running', 'waiting', 'completed', 'failed', 'cancelled'] as const) {
    const username = `status-execution-${state}`
    const store = openExecutionStore(username)
    try {
      const definition = { graphId: 'status-owner-fixture', graphHash: 'fixture-v1', runtimeVersion: 'fixture-v1',
        checkpointSchemaVersion: 1, nodeVersions: {} }
      const execution = store.create(username, definition)
      const lease = store.claim(execution.executionId, definition)
      const task = { objectiveId: randomUUID(), executionId: execution.executionId,
        objective: 'Inspect the work area.', completionCriteria: 'Report the observed target location.',
        instruction: 'Inspect the work area and report the target location.', source: 'user',
        decision: { outcome: 'act', objectiveComplete: false, reason: 'Inspect another area.' },
        selectedAction: null, actionId: '', actionStatus: '', feedback: null, baselineFrame: null,
        updatedAt: new Date().toISOString() }
      await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: execution.executionId } }, {
        v: 4, id: randomUUID(), ts: task.updatedAt,
        channel_values: { executionTransition: { transitionId: 'objective', task } },
        channel_versions: {}, versions_seen: {},
      }, { source: 'loop', step: 0, parents: {} })
      saveRobotStatus(username, situation, sources)
      if (state === 'cancelled') store.cancel(execution.executionId, { eventId: 'cancel', kind: 'user_cancelled', payload: {} })
      else if (state !== 'running') store.settle(lease, state)

      const read = await robotStatusNode.execute!({}, { username }, { historyLimit: 3 })
      assert.equal(read.task.executionStatus, state)
      assert.equal(read.task.objective, task.objective, 'Historical objectives remain inspectable')
      assert.equal(read.context.situation.currentGoal, ['running', 'waiting'].includes(state) ? task.objective : '')
      assert.deepEqual(store.task(execution.executionId), task, 'A status read cannot rewrite the execution decision')
      const saved = saveRobotStatus(username, situation, sources)
      assert.equal(saved.situation.currentGoal, read.context.situation.currentGoal)
      assert.equal(saved.task?.executionStatus, state)
    } finally { store.close() }
  }
})

test('out-of-order projections retain facts together with their independent source timestamps', () => {
  const username = 'robot-status-out-of-order'
  const time = (second: number) => `2026-08-27T18:00:${String(second).padStart(2, '0')}.000Z`
  const latest = structuredClone(sources)
  latest.sourceUpdatedAt = { environment: time(10), telemetry: time(20), conversation: time(10), robotHistory: time(10), agency: time(10) }
  latest.lastAction = { ...latest.lastAction, actionId: 'newest-action', completedAt: time(10) }
  latest.body = { ...latest.body, observationAt: time(10), telemetryAt: time(20),
    battery: { voltage: 7.4, observedAt: time(20) }, motion: { available: true, activity: 'idle', observedAt: time(10) } }
  saveRobotStatus(username, situation, latest)

  for (const second of [8, 9, 10]) {
    const older = structuredClone(latest)
    older.sourceUpdatedAt.environment = time(second)
    older.sourceUpdatedAt.telemetry = time(15)
    older.sourceUpdatedAt.robotHistory = time(Math.min(second, 9))
    older.lastAction = { ...older.lastAction, actionId: `older-action-${second}`, completedAt: time(Math.min(second, 9)) }
    older.body = { ...older.body, observationAt: time(second), telemetryAt: time(15), telemetry: { vbat: 6.2 },
      battery: { voltage: 6.2, observedAt: time(15) }, motion: { available: false, activity: 'old-state', observedAt: time(8) } }
    const snapshot = saveRobotStatus(username, situation, older)
    assert.equal(snapshot.lastAction?.actionId, 'newest-action')
    assert.equal(snapshot.sourceUpdatedAt.robotHistory, time(10))
    assert.equal(snapshot.body?.observationAt, time(10))
    assert.equal(snapshot.sourceUpdatedAt.environment, time(10))
    assert.equal(snapshot.body?.telemetryAt, time(20))
    assert.equal(snapshot.sourceUpdatedAt.telemetry, time(20))
    assert.deepEqual(snapshot.body?.telemetry, latest.body.telemetry)
    assert.deepEqual(snapshot.body?.battery, latest.body.battery)
    assert.deepEqual(snapshot.body?.motion, latest.body.motion)
  }

  const freshTelemetry = structuredClone(latest)
  freshTelemetry.body = { ...freshTelemetry.body, observationAt: time(9), telemetryAt: time(25), telemetry: { vbat: 7.1 },
    battery: { voltage: 7.1, observedAt: time(25) } }
  freshTelemetry.sourceUpdatedAt.environment = time(9)
  freshTelemetry.sourceUpdatedAt.telemetry = time(25)
  const updated = saveRobotStatus(username, situation, freshTelemetry)
  assert.equal(updated.body?.observationAt, time(10))
  assert.equal(updated.body?.telemetryAt, time(25))
  assert.deepEqual(updated.body?.battery, freshTelemetry.body.battery)
  assert.deepEqual(updated.body?.telemetry, freshTelemetry.body.telemetry)
  assert.equal(updated.sourceUpdatedAt.environment, time(10))
  assert.equal(updated.sourceUpdatedAt.telemetry, time(25))
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
  const { executionId, outputs: [, written] } = await statusGraph(username, [
    { inputs: { taskDecision: { objective: situation.currentGoal, outcome: 'act', objectiveComplete: false,
      reason: 'Inspect the work area.', requiredCompletionBasis: 'visual_observation' } } },
    { type: 'robot_status_writer', inputs: {
      response: JSON.stringify({ ...situation, currentGoal: 'A different objective suggested by status prose.' }),
      sourceFacts: sources,
    } },
  ])
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
  assert.equal(read.context.situation.currentGoal, '', 'The fixture graph ended; its saved objective is historical')
  assert.equal(read.task.executionStatus, 'completed')
  assert.equal(read.context.body.battery.voltage, 7.4)
  assert.equal(read.context.body.motion.available, true)
  assert.equal(read.context.lastAction.command, 'wave')
  assert.equal(read.context.agency.activeDesires[0].title, 'Find the cat')
  assert.equal(read.context.agency.activeDesires[0].nextAction, 'desire-agent')
  assert.equal('reason' in read.context.agency.activeDesires[0], false)
  assert.equal('telemetry' in read.context.body, false)
  assert.equal('capabilities' in read.context.body, false)
  assert.equal(JSON.stringify(read.context).length < 6_000, true)
  assert.equal(read.task.executionId, executionId)
  assert.equal(read.historyContext.task.objective, situation.currentGoal)
  assert.deepEqual(Object.keys(read.historyContext).sort(), ['history', 'situation', 'task', 'updatedAt'])
})

test('Robot Status Out persists the Environment LLM task and correlated action result without another model call', async () => {
  const username = 'robot-status-out-owner'
  const selectedAction = { type: 'robotCommand', command: 'walk_forward' }
  const initialInput = {
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
  }
  const completedInput = {
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
  }
  const { executionId, outputs: [initial, completed] } = await statusGraph(username,
    [{ inputs: initialInput }, { inputs: completedInput }])

  assert.equal(initial.persisted, true)
  assert.equal(initial.task.objective, 'Inspect the object from closer range.')
  assert.equal(initial.task.selectedAction.command, 'walk_forward')
  assert.equal(initial.task.actionId, 'action-2')
  assert.equal(initial.task.baselineFrame.id, 'before-action-2')
  assert.equal(initial.lastAction.command, 'walk_forward')

  assert.equal(completed.task.decision.objectiveComplete, true)
  assert.equal(completed.task.actionStatus, 'completed')
  assert.equal(completed.task.feedback.actionId, 'action-2')
  assert.equal(completed.lastAction.command, 'walk_forward')
  assert.equal(completed.lastAction.status, 'completed')
  assert.equal(completed.status.situation.currentGoal, '')
  assert.equal(loadRobotStatus(username)?.task?.decision.outcome, 'complete')
  const store = openExecutionStore(username)
  try {
    assert.equal(store.task(executionId)?.decision.objectiveComplete, true)
    assert.equal(store.task(executionId)?.objectiveId, initial.task.objectiveId)
    assert.equal(completed.task.executionId, executionId)
  } finally { store.close() }
})

test('Robot Status Out preserves the originating task instruction while recording an autonomous next step', async () => {
  const username = 'robot-status-goal-continuation-owner'
  const initialInput = {
    taskDecision: {
      objective: 'Find the cat.',
      outcome: 'continue',
      reason: 'A better-lit viewpoint may provide useful evidence.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The latest view is too dark to establish the cat location.',
      nextInstruction: 'Move to a better-lit area and continue looking for the cat.',
    },
  }
  const continuationInput = {
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
  }
  const { outputs: [, delegatedStep] } = await statusGraph(username,
    [{ inputs: initialInput }, { inputs: continuationInput }])

  assert.equal(delegatedStep.task.objective, 'Find the cat.')
  assert.equal(delegatedStep.task.instruction, 'Find the cat.')
  assert.equal(delegatedStep.task.decision.reason, 'Changing viewpoint may improve the available visual evidence.')
  assert.equal(delegatedStep.task.source, 'user')
  assert.equal(delegatedStep.task.selectedAction.command, 'walk_forward')
})

test('Robot Status Out preserves the execution origin rather than inferring steering from input prose', async () => {
  const username = 'robot-status-user-restatement-owner'
  const initialInput = {
    instruction: 'Inspect the keys when useful.',
    inputSource: 'autonomy',
    taskDecision: {
      objective: 'Find the missing keys.',
      outcome: 'wait',
      reason: 'No current image is available.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
    },
  }
  const restatedInput = {
    instruction: 'Please continue helping me find my missing keys.',
    userInstruction: 'Please continue helping me find my missing keys.',
    inputSource: 'user',
    taskDecision: {
      objective: 'Find the missing keys.',
      outcome: 'act',
      reason: 'The user renewed the existing search request.',
      objectiveComplete: false,
      requiredCompletionBasis: 'visual_observation',
    },
  }
  const { outputs: [initial, restated] } = await statusGraph(username,
    [{ inputs: initialInput }, { inputs: restatedInput }])

  assert.equal(restated.task.objective, 'Find the missing keys.')
  assert.equal(restated.task.instruction, 'Inspect the keys when useful.')
  assert.equal(restated.task.source, 'autonomy')
  assert.equal(restated.task.objectiveId, initial.task.objectiveId)
})

test('Robot Status Out records a new action within the execution without replacing its objective', async () => {
  const username = 'robot-status-standalone-action-owner'
  const initialInput = {
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
  }
  const standaloneInput = {
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
  }
  const returnedInput = {
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
  }
  const { outputs: [initial, standalone, returned] } = await statusGraph(username,
    [{ inputs: initialInput }, { inputs: standaloneInput }, { inputs: returnedInput }])

  assert.equal(standalone.task.objective, 'Locate the missing object.')
  assert.equal(standalone.task.actionId, 'standalone-turn')
  assert.equal(standalone.task.actionStatus, 'coordinated_for_adapter')
  assert.equal(standalone.task.feedback, null)
  assert.deepEqual(standalone.task.decision, initial.task.decision)
  assert.equal(standalone.task.objectiveId, initial.task.objectiveId)
  assert.equal(standalone.lastAction.command, 'turn_right_45')
  assert.equal(standalone.lastAction.actionId, 'standalone-turn')

  assert.equal(returned.task.objective, 'Locate the missing object.')
  assert.equal(returned.task.actionId, 'standalone-turn')
  assert.equal(returned.task.actionStatus, 'completed')
  assert.equal(returned.task.feedback.actionId, 'standalone-turn')
  assert.deepEqual(returned.task.decision, initial.task.decision)
  assert.equal(returned.lastAction.command, 'turn_right_45')
  assert.equal(returned.lastAction.status, 'completed')

  // A different execution may share the status file, but must not adopt its goal.
  const { executionId, outputs: [unrelated] } = await statusGraph(username, [{ inputs: standaloneInput }])
  assert.notEqual(executionId, initial.task.executionId)
  assert.equal(unrelated.task, null)
})

test('correlated terminal facts advance without a semantic objective change', async () => {
  for (const type of ['completed', 'failed', 'cancelled']) {
    const { outputs: [sent, returned] } = await statusGraph(`result-facts-${type}`, [
      { inputs: { taskDecision: { objective: 'Inspect the area.', completionCriteria: 'The target is identified.',
        outcome: 'act', objectiveComplete: false, reason: 'Obtain evidence.' },
        actions: [{ type: 'captureImage' }],
        bridgeRecord: { status: 'coordinated_for_adapter', commands: [{ id: 'current-action' }] } } },
      { inputs: { taskDecision: null,
        terminalFeedback: { actionId: 'current-action', type, message: 'Returned physical evidence.' },
        actionContext: { actionId: 'current-action', requested: { type: 'captureImage' } } } },
    ])
    assert.equal(returned.task.actionStatus, type)
    assert.equal(returned.task.feedback.actionId, 'current-action')
    assert.deepEqual(returned.task.decision, sent.task.decision)
    assert.equal(returned.task.objectiveId, sent.task.objectiveId)
    assert.equal(returned.task.completionCriteria, sent.task.completionCriteria)
  }
})

test('Robot Status Out projects the correlated LLM completion decision from the same execution', async () => {
  const username = 'robot-status-overlapping-result-owner'
  const initialInput = {
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
  }
  const completedInput = {
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
      actionId: 'current-capture',
      message: 'done',
    },
    actionContext: {
      actionId: 'current-capture',
      requested: { type: 'captureImage', target: 'current_surroundings' },
    },
  }
  const { outputs: [initial, result] } = await statusGraph(username,
    [{ inputs: initialInput }, { inputs: completedInput }])

  assert.equal(result.task.objective, 'Inspect the work area.')
  assert.equal(result.task.decision.objectiveComplete, true)
  assert.equal(result.task.source, 'user')
  assert.equal(result.status.situation.currentGoal, '')
  assert.equal(result.lastAction.actionId, 'current-capture')
  assert.equal(result.task.objectiveId, initial.task.objectiveId)
})

test('Environment selector receives the decision-bearing Robot Status fields', async () => {
  const username = 'robot-status-environment-owner'
  await statusGraph(username, [
    { inputs: { taskDecision: { objective: situation.currentGoal, outcome: 'act', objectiveComplete: false,
      reason: 'Inspect the work area.', requiredCompletionBasis: 'visual_observation' } } },
    { type: 'robot_status_writer', inputs: { response: JSON.stringify(situation), sourceFacts: sources } },
  ])
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
    robotStatus: { ...read.context, agency: { activeDesires: Array.from({ length: 5 }, (_, index) => ({
      ...read.context.agency.activeDesires[0], id: `desire-${index}`,
    })) } },
  } as any))

  assert.equal(envelope.robotStatus.body.battery.voltage, 7.4)
  assert.equal(envelope.robotStatus.body.motion.available, true)
  assert.equal(envelope.robotStatus.lastAction.command, 'wave')
  assert.equal(envelope.robotStatus.situation.currentGoal, '')
  assert.equal(envelope.robotStatus.task.objective, situation.currentGoal)
  assert.equal(envelope.robotStatus.task.executionStatus, 'completed')
  assert.equal(envelope.robotStatus.agency.activeDesires[0].title, 'Find the cat')
  assert.equal(envelope.robotStatus.agency.activeDesires[0].nextAction, 'desire-agent')
  assert.equal('reason' in envelope.robotStatus.agency.activeDesires[0], false)
  assert.equal(envelope.robotStatus.agency.activeDesires.length, 5)
  assert.ok(envelope.robotStatus.agency.activeDesires.every((desire: any) => desire.nextAction === 'desire-agent'))
  assert.match(envelope.robotStatus.agency.purpose, /Pending work for Desire Agent/)
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

test('Robot task lifecycle waits and reviews as explicit children instead of starting a feedback graph', async () => {
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
    assert.equal('feedbackGraph' in bridge.data.properties, false)
    const wait = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_result_wait')
    const review = graph.nodes.find((node: any) => node.data?.nodeType === 'workflow_call'
      && node.data.properties.graph === 'robot-action-result')
    assert.ok(wait)
    assert.ok(review)
    assert.ok(graph.edges.some((edge: any) => edge.source === bridge.id && edge.sourceHandle === 'commands'
      && edge.target === wait.id && edge.targetHandle === 'commands'))
    assert.ok(graph.edges.some((edge: any) => edge.source === wait.id && edge.sourceHandle === 'context'
      && edge.target === review.id && edge.targetHandle === 'context'))
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
  assert.equal(reviewTypes.filter((type: string) => type === 'active_desires').length, 1)
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
    edge.source === 'active-desires'
    && edge.sourceHandle === 'desires'
    && edge.target === 'context'
    && edge.targetHandle === 'activeDesires'
  )), true)
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
        requiredCompletionBasis: 'visual_observation',
        observationSummary: 'The new view contains no visible cat.',
        completionEvidence: '',
      },
    }),
    execution: { task: { objective: 'Find the cat.' } },
  }, {})
  assert.equal(interpreted.taskDecision.objectiveComplete, false)
  assert.equal('decision' in interpreted, false)

  const reviewed = await robotGoalReviewParserNode.execute({
    response: JSON.stringify({
      response: '',
      outcome: 'continue',
      reason: 'Another viewpoint may reveal the target.',
      requiredCompletionBasis: 'visual_observation',
      observationSummary: 'The last view did not contain the cat.',
      completionEvidence: '',
      taskId: 'robot-autonomy-executor',
      instruction: 'Inspect a different open area for the cat.',
    }),
    availableTasks: [{ id: 'robot-autonomy-executor', name: 'Robot Autonomy Executor', kind: 'environment-executor',
      description: 'Execute one high-level embodied intention.', handler: 'workflow.boredom-autonomy',
      taskType: 'generic', priority: 'normal', tags: [] }],
    execution: { task: { objective: 'Find the cat.' } },
  }, {}, {})
  assert.deepEqual(reviewed.executorDecision, {
    observed: 'The last view did not contain the cat.',
    instruction: 'Inspect a different open area for the cat.',
    reason: 'Another viewpoint may reveal the target.',
  })
})
