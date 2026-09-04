import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { getQueueManager } from '../queue/index.js'
import { environmentObservationNeedsCognition } from '../api/handlers/environment-bridge.js'
import type { EnvironmentObservation } from './types.js'
import {
  enqueueEnvironmentAction,
  getEnvironmentBridgeStatePath,
  publishEnvironmentObservation,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  recordEnvironmentObservation,
  sanitizeEnvironmentBridgeObservation,
  writeEnvironmentBridgeState,
} from './store.js'

const poseTargets = [
  ['R1', 120], ['R2', 60], ['L1', 55], ['L2', 125],
  ['R4', 20], ['R3', 160], ['L3', 15], ['L4', 165],
] as const

function connectedObservation(epoch: number): EnvironmentObservation {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan'],
      robotCommands: ['stand', 'neutral', 'sit'],
    },
    state: {
      body: { authenticated: true, robotId: 'ainekio-01' },
      gateway: {
        robots: {
          'ainekio-01': { epoch },
        },
      },
    },
  }
}

test('image acquisition has a longer dispatch window without weakening control expiry', () => {
  const manager = getQueueManager()
  const originalState = manager.exportState()
  try {
    manager.clear()
    const queuedAt = new Date().toISOString()
    const imageRequest = enqueueEnvironmentAction({
      type: 'captureImage',
      sessionId: 'robot-1',
      createdAt: queuedAt,
    })
    const imageDeadline = Date.parse(manager.getTask(imageRequest.id)?.deadline ?? '')
    assert.equal(imageDeadline - Date.parse(queuedAt), 10_000)

    manager.clear()
    const controlQueuedAt = new Date().toISOString()
    const controlRequest = enqueueEnvironmentAction({
      type: 'robotCommand',
      command: 'model-authored-command',
      sessionId: 'robot-1',
      createdAt: controlQueuedAt,
    })
    const controlDeadline = Date.parse(manager.getTask(controlRequest.id)?.deadline ?? '')
    assert.equal(controlDeadline - Date.parse(controlQueuedAt), 2_000)
  } finally {
    manager.importState(originalState)
  }
})

test('completed robot actions do not synthesize a workflow-specific recapture', () => {
  const manager = getQueueManager()
  const originalState = manager.exportState()
  try {
    manager.clear()
    const action = enqueueEnvironmentAction({
      type: 'robotCommand',
      command: 'model-authored-command',
      sessionId: 'robot-1',
      metadata: {
        robotObserver: {
          cycleId: 'observer-cycle',
          step: 2,
          triggerSource: 'autonomy',
          graph: 'environment',
          requestedBy: 'environment-perception',
        },
      },
    }, { username: 'owner', source: 'autonomy' })
    manager.claim(action.id, 'environment-adapter:robot-1')

    const completed = recordEnvironmentActionResult({
      id: 'observer-action-complete',
      timestamp: new Date().toISOString(),
      type: 'completed',
      message: 'done',
      actionId: action.id,
    })
    assert.equal('postActionObservation' in (completed ?? {}), false)
    assert.equal(manager.getAllTasks().some(task => task.input.type === 'captureImage'), false)
  } finally {
    manager.importState(originalState)
  }
})

test('completed motion plans carry their exact commanded pose until body identity changes', () => {
  const manager = getQueueManager()
  const originalQueue = manager.exportState()
  const statePath = getEnvironmentBridgeStatePath()
  const stateExisted = fs.existsSync(statePath)
  const originalState = stateExisted ? fs.readFileSync(statePath) : undefined
  try {
    manager.clear()
    const timestamp = new Date().toISOString()
    writeEnvironmentBridgeState({
      enabled: true,
      updatedAt: timestamp,
      sessions: {},
      feedback: [],
    })
    recordEnvironmentObservation(connectedObservation(7))
    const action = enqueueEnvironmentAction({
      type: 'robotMotionPlan',
      sessionId: 'robot-1',
      frames: [{
        durationMs: 500,
        targets: poseTargets.map(([joint, degrees]) => ({ joint, degrees })),
      }],
      endPose: 'hold',
    }, { username: 'owner' })
    manager.claim(action.id, 'environment-adapter:robot-1')
    recordEnvironmentActionResult({
      id: 'motion-completed',
      timestamp: '2026-09-01T18:00:01.000Z',
      type: 'completed',
      message: 'done',
      actionId: action.id,
    })

    let pose = readEnvironmentBridgeState()
      .sessions['robot-1']?.latestObservation?.state?.commandedPose as Record<string, any>
    assert.equal(pose.kind, 'joints')
    assert.equal(pose.joints.R1, 120)
    assert.equal(pose.joints.L4, 165)
    assert.equal(pose.bodyEpoch, 'ainekio-01:7')

    recordEnvironmentObservation(connectedObservation(7))
    pose = readEnvironmentBridgeState()
      .sessions['robot-1']?.latestObservation?.state?.commandedPose as Record<string, any>
    assert.equal(pose.sourceActionId, action.id)

    recordEnvironmentObservation(connectedObservation(8))
    assert.equal(
      readEnvironmentBridgeState().sessions['robot-1']?.latestObservation?.state?.commandedPose,
      undefined,
    )
  } finally {
    manager.importState(originalQueue)
    if (originalState) fs.writeFileSync(statePath, originalState)
    else fs.rmSync(statePath, { force: true })
  }
})

test('published cognition work receives the same carried commanded pose as persisted state', () => {
  const manager = getQueueManager()
  const originalQueue = manager.exportState()
  const statePath = getEnvironmentBridgeStatePath()
  const stateExisted = fs.existsSync(statePath)
  const originalState = stateExisted ? fs.readFileSync(statePath) : undefined
  try {
    manager.clear()
    writeEnvironmentBridgeState({
      enabled: true,
      updatedAt: '2026-09-01T18:10:00.000Z',
      sessions: {},
      feedback: [],
    })
    recordEnvironmentObservation({
      ...connectedObservation(7),
      timestamp: '2026-09-01T18:10:00.000Z',
    })
    const stand = enqueueEnvironmentAction({
      type: 'robotCommand',
      command: 'stand',
      sessionId: 'robot-1',
    }, { username: 'owner' })
    manager.claim(stand.id, 'environment-adapter:robot-1')
    recordEnvironmentActionResult({
      id: 'stand-completed-before-observation',
      timestamp: '2026-09-01T18:10:01.000Z',
      type: 'completed',
      message: 'stand completed',
      actionId: stand.id,
      data: { command: 'stand' },
    })

    const published = publishEnvironmentObservation({
      ...connectedObservation(7),
      timestamp: '2026-09-01T18:10:02.000Z',
    }, { username: 'owner' })
    const queued = manager.getTask(published.workId)?.input as {
      observation?: EnvironmentObservation
    }
    const queuedPose = queued.observation?.state?.commandedPose as Record<string, unknown>

    assert.equal(queuedPose.reference, 'stand')
    assert.deepEqual(
      queued.observation?.state?.commandedPose,
      readEnvironmentBridgeState().sessions['robot-1']?.latestObservation?.state?.commandedPose,
    )
  } finally {
    manager.importState(originalQueue)
    if (originalState) fs.writeFileSync(statePath, originalState)
    else fs.rmSync(statePath, { force: true })
  }
})

test('a failed Boredom Movement stimulus capture returns to its autonomy graph for revision', () => {
  const manager = getQueueManager()
  const originalState = manager.exportState()
  try {
    manager.clear()
    const capture = enqueueEnvironmentAction({
      type: 'captureImage',
      sessionId: 'robot-1',
      metadata: {
        robotObserver: {
          cycleId: 'boredom-failed-capture',
          step: 1,
          triggerSource: 'autonomy',
          requestedBy: 'boredom-movement',
          graph: 'boredom-autonomy',
          instruction: 'Choose a contextually relevant boredom response.',
        },
      },
    }, {
      username: 'owner',
      source: 'autonomy',
      correlationId: 'boredom-failed-capture',
    })
    const observation = sanitizeEnvironmentBridgeObservation({
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['captureImage'], visual: true },
      feedback: [{
        id: 'capture-expired',
        timestamp: new Date().toISOString(),
        type: 'expired',
        message: 'capture expired',
        actionId: capture.id,
      }],
    })
    assert.equal(environmentObservationNeedsCognition(observation), true)
  } finally {
    manager.importState(originalState)
  }
})
