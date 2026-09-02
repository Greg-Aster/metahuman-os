import assert from 'node:assert/strict'
import test from 'node:test'

import { executeAgentTrigger } from './agent-trigger.node.js'

const context = {
  username: 'test-user',
  idempotencyKey: 'reflector:test-user:execution-1',
}

test('Agent Trigger admits the exact seed through the canonical follow-on contract', async () => {
  const submissions: Record<string, any>[] = []
  const result = await executeAgentTrigger(
    { seed: 'A persisted reflection worth extending.' },
    context,
    { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 1 },
    {
      random: () => 0.99,
      submit: async input => {
        submissions.push(input)
        return { id: 'task-follow-on' } as any
      },
    },
  )

  assert.equal(result.admitted, true)
  assert.equal(result.taskId, 'task-follow-on')
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].agentId, 'train-of-thought')
  assert.equal(submissions[0].username, 'test-user')
  assert.equal(submissions[0].seed, 'A persisted reflection worth extending.')
  assert.equal(submissions[0].sourceAgent, 'reflector')
  assert.match(submissions[0].executionId, /^reflector:[a-f0-9]{32}$/)
  assert.equal(
    submissions[0].idempotencyKey,
    `agent-follow-on:reflector:train-of-thought:${submissions[0].executionId}`,
  )
})

test('Agent Trigger makes a stable probability decision for one parent execution', async () => {
  const first = await executeAgentTrigger(
    { seed: 'Stable seed.' },
    context,
    { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 0 },
    { random: () => 0, submit: async () => ({ id: 'unexpected' } as any) },
  )
  const second = await executeAgentTrigger(
    { seed: 'Stable seed.' },
    context,
    { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 0 },
    { random: () => 0.999, submit: async () => ({ id: 'unexpected' } as any) },
  )
  assert.equal(first.reason, 'probability')
  assert.equal(first.roll, second.roll)
})

test('Agent Trigger rejects invalid policy and identity instead of fabricating defaults', async () => {
  const neverSubmit = async () => ({ id: 'unexpected' } as any)
  await assert.rejects(
    executeAgentTrigger(
      { seed: 'Seed.' },
      context,
      { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 2 },
      { random: () => 0, submit: neverSubmit },
    ),
    /probability must be between 0 and 1/,
  )
  await assert.rejects(
    executeAgentTrigger(
      { seed: 'Seed.' },
      { idempotencyKey: 'missing-user' },
      { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 1 },
      { random: () => 0, submit: neverSubmit },
    ),
    /authenticated username/,
  )
  assert.deepEqual(
    await executeAgentTrigger(
      { seed: '   ' },
      context,
      { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 1 },
      { random: () => 0, submit: neverSubmit },
    ),
    { admitted: false, skipped: true, reason: 'empty-seed' },
  )
})

test('Agent Trigger propagates Work Coordinator admission failures', async () => {
  await assert.rejects(
    executeAgentTrigger(
      { seed: 'Seed.' },
      context,
      { agentName: 'train-of-thought', sourceAgent: 'reflector', probability: 1 },
      {
        random: () => 0,
        submit: async () => { throw new Error('coordinator unavailable') },
      },
    ),
    /coordinator unavailable/,
  )
})
