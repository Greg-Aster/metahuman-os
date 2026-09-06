import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAgentFollowOnTaskInput,
  buildDesireAgentTaskInput,
  buildMemoryIndexRefreshTaskInput,
} from './work-submission.js'
import { UnifiedQueueManager } from './unified-queue-manager.js'

test('Agent follow-on submission builds one coordinator-owned finite task contract', () => {
  assert.deepEqual(buildAgentFollowOnTaskInput({
    agentId: 'train-of-thought',
    username: 'test-user',
    seed: 'A persisted result.',
    sourceAgent: 'reflector',
    executionId: 'reflector:test-user:execution-1',
    idempotencyKey: 'agent-follow-on:reflector:train-of-thought:execution-1',
  }), {
    type: 'generic',
    handler: 'agent.train-of-thought',
    resource: 'local-llm',
    source: 'autonomy',
    username: 'test-user',
    priority: 'low',
    input: {
      agentId: 'train-of-thought',
      seed: 'A persisted result.',
      sourceAgent: 'reflector',
      executionId: 'reflector:test-user:execution-1',
      triggeredBy: 'agent-follow-on',
      args: [],
    },
    parentTaskId: undefined,
    correlationId: undefined,
    idempotencyKey: 'agent-follow-on:reflector:train-of-thought:execution-1',
    maxAttempts: 2,
    metadata: {
      producer: 'reflector',
      followOnAgent: 'train-of-thought',
      sourceExecutionId: 'reflector:test-user:execution-1',
    },
  })
})

test('Agent follow-on submission rejects unsupported targets and unbounded seeds', () => {
  const base = {
    agentId: 'train-of-thought',
    username: 'test-user',
    seed: 'Seed.',
    sourceAgent: 'reflector',
    executionId: 'execution-1',
    idempotencyKey: 'follow-on-1',
  }
  assert.throws(
    () => buildAgentFollowOnTaskInput({ ...base, agentId: 'missing-agent' }),
    /No maintained executable/,
  )
  assert.throws(
    () => buildAgentFollowOnTaskInput({ ...base, seed: 'x'.repeat(12_001) }),
    /must not exceed 12000 characters/,
  )
  assert.throws(
    () => buildAgentFollowOnTaskInput({ ...base, sourceAgent: 'Not Valid' }),
    /sourceAgent must be kebab-case/,
  )
})

test('Memory index reconciliation builds one profile-scoped coordinator task', () => {
  assert.deepEqual(buildMemoryIndexRefreshTaskInput({
    username: 'profile-one',
    source: 'system',
    maxAgeHours: 24,
    metadata: { producer: 'memory-router', reason: 'MEMORY_INDEX_UNAVAILABLE' },
  }), {
    type: 'index_build',
    handler: 'vector.index-build',
    resource: 'vector-index',
    source: 'system',
    username: 'profile-one',
    priority: 'normal',
    input: {
      force: false,
      maxAgeHours: 24,
      triggeredBy: 'memory-router',
    },
    idempotencyKey: 'vector-index-refresh:normal',
    maxAttempts: 2,
    metadata: {
      producer: 'memory-router',
      reason: 'MEMORY_INDEX_UNAVAILABLE',
    },
  })
})

test('Memory index reconciliation rejects invalid profile identity and limits', () => {
  assert.throws(
    () => buildMemoryIndexRefreshTaskInput({ username: '../profile', source: 'system' }),
    /valid profile username/,
  )
  assert.throws(
    () => buildMemoryIndexRefreshTaskInput({ username: 'profile', source: 'system', maxAgeHours: -1 }),
    /non-negative number/,
  )
})

test('Desire Agent planning builds one targeted coordinator-owned task', () => {
  assert.deepEqual(buildDesireAgentTaskInput({
    operation: 'plan',
    username: 'profile-one',
    desireId: 'desire-123-abc',
    source: 'user',
    metadata: { producer: 'agency-api' },
  }), {
    type: 'generic',
    handler: 'agent.desire-planner',
    resource: 'remote-llm',
    source: 'user',
    username: 'profile-one',
    priority: 'high',
    input: {
      agentId: 'desire-planner',
      args: ['--desire-id', 'desire-123-abc'],
      triggeredBy: 'desire-agent',
    },
    parentTaskId: undefined,
    correlationId: undefined,
    idempotencyKey: 'desire-agent:plan:desire-123-abc',
    maxAttempts: 2,
    metadata: {
      producer: 'desire-agent',
      monitorAgentId: 'desire-agent',
      desireAgentOperation: 'plan',
      requestedBy: 'agency-api',
    },
  })
})

test('Desire Agent rejects invalid profile, desire identity, and untargeted check-ins', () => {
  assert.throws(
    () => buildDesireAgentTaskInput({ operation: 'plan', username: '../profile', desireId: 'desire-1', source: 'user' }),
    /valid profile username/,
  )
  assert.throws(
    () => buildDesireAgentTaskInput({ operation: 'execute', username: 'profile', desireId: '../desire-1', source: 'user' }),
    /valid desire ID/,
  )
  assert.throws(
    () => buildDesireAgentTaskInput({ operation: 'checkin', username: 'profile', source: 'user' }),
    /check-in requires a desire ID/,
  )
})

test('Desire Agent owns execution, review, and check-in attribution', () => {
  for (const [operation, handler, type] of [
    ['execute', 'agency.desire-execute', 'desire_execute'],
    ['review', 'agency.desire-outcome-review', 'desire_review'],
    ['checkin', 'agency.desire-checkin', 'desire_checkin'],
  ] as const) {
    const task = buildDesireAgentTaskInput({
      operation,
      username: 'profile-one',
      desireId: 'desire-123-abc',
      source: 'user',
      metadata: { producer: 'agency-api' },
    })
    assert.equal(task.handler, handler)
    assert.equal(task.type, type)
    assert.equal(task.input.triggeredBy, 'desire-agent')
    assert.equal(task.metadata?.producer, 'desire-agent')
    assert.equal(task.metadata?.monitorAgentId, 'desire-agent')
    assert.equal(task.metadata?.requestedBy, 'agency-api')
  }
})

test('Work Coordinator rejects Desire lifecycle bypasses', () => {
  const queue = new UnifiedQueueManager()
  assert.throws(() => queue.enqueue({
    type: 'desire_execute',
    handler: 'agency.desire-execute',
    source: 'system',
    username: 'profile-one',
    input: { desireId: 'desire-123-abc' },
  }), /must be admitted by the Desire Agent/)
  assert.throws(() => queue.enqueue({
    type: 'desire_generate',
    handler: 'agent.desire-generator',
    source: 'system',
    username: 'profile-one',
    input: { agentId: 'desire-generator' },
  }), /public Desire Agent/)
  assert.throws(() => queue.enqueue({
    type: 'desire_generate',
    handler: 'custom.desire-generator',
    source: 'system',
    username: 'profile-one',
    input: { agentId: 'desire-agent' },
  }), /must be admitted by the Desire Agent/)
  assert.throws(() => queue.enqueue({
    type: 'generic',
    handler: 'agent.desire-agent',
    source: 'system',
    username: 'profile-one',
    input: { agentId: 'desire-agent' },
  }), /must be admitted by the Desire Agent/)
})
