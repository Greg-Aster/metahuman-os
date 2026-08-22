import assert from 'node:assert/strict'
import test from 'node:test'

import { getQueueManager } from '../queue/index.js'
import { environmentObservationNeedsCognition } from '../api/handlers/environment-bridge.js'
import {
  attachEnvironmentActionContext,
  enqueueEnvironmentAction,
  recordEnvironmentActionResult,
} from './store.js'

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
          maxSteps: 8,
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

test('completed motion carries cycle-owned control state into the correlated observation', () => {
  const manager = getQueueManager()
  const originalState = manager.exportState()
  try {
    manager.clear()
    const motionControl = {
      version: 1 as const,
      cycleId: 'observer-cycle',
      planIds: ['plan-1'],
      lastPlanId: 'plan-1',
      lastVisualFrameId: 'frame-before-motion',
      lastVisualFrameTimestamp: '2026-08-04T12:00:00.000Z',
      consecutiveIdentical: 1,
    }
    const action = enqueueEnvironmentAction({
      type: 'robotCommand',
      command: 'model-authored-command',
      sessionId: 'robot-1',
      metadata: { motionControl },
    }, {
      username: 'owner',
      source: 'autonomy',
      correlationId: 'observer-cycle',
    })
    const observation = attachEnvironmentActionContext({
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'robot-1',
      timestamp: '2026-08-04T12:00:05.000Z',
      capabilities: { actions: ['robotCommand'] },
      feedback: [{
        id: 'motion-completed',
        timestamp: '2026-08-04T12:00:05.000Z',
        type: 'completed',
        message: 'done',
        actionId: action.id,
      }],
    })

    assert.deepEqual(observation.metadata?.motionControl, motionControl)
    assert.equal(observation.metadata?.correlationId, 'observer-cycle')
    assert.equal(observation.metadata?.actionId, action.id)
  } finally {
    manager.importState(originalState)
  }
})

test('a failed Boredom Movement stimulus capture remains lifecycle telemetry instead of invoking its graph', () => {
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
          maxSteps: 8,
          triggerSource: 'autonomy',
          requestedBy: 'boredom-movement',
          graph: 'robot-operator',
          instruction: 'Choose a contextually relevant boredom response.',
        },
      },
    }, {
      username: 'owner',
      source: 'autonomy',
      correlationId: 'boredom-failed-capture',
    })
    const observation = attachEnvironmentActionContext({
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
    assert.equal(environmentObservationNeedsCognition(observation), false)
  } finally {
    manager.importState(originalState)
  }
})
