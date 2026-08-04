import assert from 'node:assert/strict'
import test from 'node:test'

import type { QueuedTask } from './types.js'
import { workBlocksBoredomMovement } from './boredom-movement-handler.js'

function task(overrides: Partial<QueuedTask>): QueuedTask {
  return {
    id: 'task-1',
    type: 'generic',
    handler: 'generic',
    state: 'queued',
    priority: 'normal',
    source: 'system',
    username: 'Ainekio',
    resource: 'system',
    createdAt: '2026-08-03T00:00:00.000Z',
    attempt: 0,
    maxAttempts: 1,
    input: {},
    ...overrides,
  }
}

test('active user observation blocks boredom even before cycle metadata is attached', () => {
  const observation = task({
    id: 'user-observation',
    type: 'environment_observation',
    handler: 'environment.observation',
    state: 'leased',
    source: 'environment',
    resource: 'local-llm',
    input: {
      observation: {
        metadata: { perceptionEvent: 'audio_utterance' },
      },
    },
  })

  assert.equal(workBlocksBoredomMovement(observation, 'boredom-workflow'), true)
})

test('active robot command blocks boredom until the body resource is free', () => {
  const command = task({
    id: 'robot-command',
    type: 'environment_command',
    handler: 'environment.command',
    state: 'queued',
    source: 'user',
    resource: 'environment:ainekio-01',
  })

  assert.equal(workBlocksBoredomMovement(command, 'boredom-workflow'), true)
})

test('the boredom workflow and its own child observation do not block themselves', () => {
  const workflow = task({
    id: 'boredom-workflow',
    handler: 'workflow.boredom-movement',
    state: 'leased',
  })
  const child = task({
    id: 'boredom-child',
    type: 'environment_observation',
    handler: 'environment.observation',
    state: 'queued',
    source: 'autonomy',
    priority: 'background',
    parentTaskId: 'boredom-workflow',
    metadata: { producer: 'boredom-movement' },
    input: { triggeredBy: 'boredom-movement' },
  })

  assert.equal(workBlocksBoredomMovement(workflow, 'boredom-workflow'), false)
  assert.equal(workBlocksBoredomMovement(child, 'boredom-workflow'), false)
})

test('a separate active boredom workflow blocks a duplicate stimulus', () => {
  const competing = task({
    id: 'other-boredom-workflow',
    handler: 'workflow.boredom-movement',
    state: 'leased',
    source: 'autonomy',
    priority: 'background',
  })

  assert.equal(workBlocksBoredomMovement(competing, 'boredom-workflow'), true)
})

test('completed robot work no longer blocks a later boredom stimulus', () => {
  const completed = task({
    id: 'completed-observation',
    type: 'environment_observation',
    handler: 'environment.observation',
    state: 'completed',
  })

  assert.equal(workBlocksBoredomMovement(completed, 'boredom-workflow'), false)
})
