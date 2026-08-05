import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { ROOT } from '../path-builder.js'
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

test('active environment work blocks a competing Boredom Movement cycle', () => {
  const observation = task({
    id: 'user-observation',
    type: 'environment_observation',
    handler: 'environment.observation',
    state: 'leased',
    source: 'environment',
    resource: 'local-llm',
  })
  const command = task({
    id: 'robot-command',
    type: 'environment_command',
    handler: 'environment.command',
    state: 'queued',
    source: 'user',
    resource: 'environment:ainekio-01',
  })

  assert.equal(workBlocksBoredomMovement(observation, 'boredom-workflow'), true)
  assert.equal(workBlocksBoredomMovement(command, 'boredom-workflow'), true)
})

test('an unfinished Boredom Movement stage blocks a new competing cycle', () => {
  const ownChild = task({
    id: 'boredom-child',
    type: 'environment_observation',
    handler: 'environment.observation',
    state: 'queued',
    source: 'autonomy',
    parentTaskId: 'boredom-workflow',
    metadata: { producer: 'boredom-movement' },
    input: { triggeredBy: 'boredom-movement' },
  })
  const competing = task({
    id: 'other-boredom-workflow',
    handler: 'workflow.boredom-movement',
    state: 'leased',
    source: 'autonomy',
  })

  assert.equal(workBlocksBoredomMovement(ownChild, 'boredom-workflow'), true)
  assert.equal(workBlocksBoredomMovement(competing, 'boredom-workflow'), true)
})

test('Boredom Movement chooses one allowlisted command without invoking a decision graph', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts'),
    'utf8',
  )
  assert.match(source, /eligibleBoredomMovementCommands/)
  assert.match(source, /chooseBoredomMovementCommand/)
  assert.match(source, /type: 'robotCommand'/)
  assert.match(source, /enqueueEnvironmentAction/)
  assert.match(source, /graph: config\.boredomGraph/)
  assert.doesNotMatch(source, /context\.enqueue|handler: 'environment\.observation'|observationTiming/)
})
