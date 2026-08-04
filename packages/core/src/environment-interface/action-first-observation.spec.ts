import assert from 'node:assert/strict'
import test from 'node:test'

import { getQueueManager } from '../queue/index.js'
import { readRobotObserverCycle } from '../robot-operator.js'
import {
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

test('action-first autonomy queues exactly one correlated image after action completion', () => {
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
          cycleId: 'boredom-cycle',
          step: 2,
          maxSteps: 8,
          triggerSource: 'autonomy',
          graph: 'environment',
          requestedBy: 'environment-perception',
          observationTiming: 'after_intention',
        },
      },
    }, {
      username: 'owner',
      source: 'autonomy',
      correlationId: 'boredom-cycle',
      originatingInstruction: 'A model-authored intention.',
    })
    manager.claim(action.id, 'environment-adapter:robot-1')

    const completed = recordEnvironmentActionResult({
      id: 'action-complete',
      timestamp: new Date().toISOString(),
      type: 'completed',
      message: 'done',
      actionId: action.id,
    })
    assert.equal(completed?.postActionObservation?.type, 'captureImage')
    assert.equal(completed?.postActionObservation?.correlationId, 'boredom-cycle')
    const captureCycle = readRobotObserverCycle({
      metadata: completed?.postActionObservation?.metadata,
    })
    assert.equal(captureCycle?.step, 3)
    assert.equal(captureCycle?.observationTiming, 'after_intention')

    const repeated = recordEnvironmentActionResult({
      id: 'action-complete-repeat',
      timestamp: new Date().toISOString(),
      type: 'completed',
      message: 'done',
      actionId: action.id,
    })
    assert.equal(repeated?.postActionObservation, undefined)
    assert.equal(
      manager.getAllTasks().filter(task => task.input.type === 'captureImage').length,
      1,
    )
  } finally {
    manager.importState(originalState)
  }
})

test('image-first observer actions do not acquire an automatic post-action image', () => {
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
    assert.equal(completed?.postActionObservation, undefined)
    assert.equal(manager.getAllTasks().some(task => task.input.type === 'captureImage'), false)
  } finally {
    manager.importState(originalState)
  }
})
