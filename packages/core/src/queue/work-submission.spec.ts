import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentFollowOnTaskInput, buildMemoryIndexRefreshTaskInput } from './work-submission.js'

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
