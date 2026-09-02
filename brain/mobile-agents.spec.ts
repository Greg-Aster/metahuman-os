import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentContext, AgentInput, AgentModule, AgentResult } from '@metahuman/agent-runtime'
import type { MobileAgentContext } from '@metahuman/core/mobile-handlers'
import {
  createMobileAgentRegistration,
  registerMobileAgents,
  type MobileAgentBinding,
} from './mobile-agents.js'

const user = {
  id: 'profile-uuid',
  username: 'alice',
  passwordHash: 'not-used',
  role: 'owner' as const,
  createdAt: '2026-08-31T00:00:00.000Z',
}

function context(overrides: Partial<MobileAgentContext> = {}): MobileAgentContext {
  return {
    username: 'alice',
    dataDir: '/mobile-data',
    taskId: 'task-123',
    createdAt: '2026-08-31T01:02:03.000Z',
    args: ['--limit', '5'],
    options: { limit: 5, executionId: 'untrusted-id' },
    ...overrides,
  }
}

function binding(
  run: (ctx: AgentContext, input: AgentInput) => Promise<AgentResult>,
  systemOptions?: MobileAgentBinding['systemOptions'],
): MobileAgentBinding {
  const agent: AgentModule = {
    meta: {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'Test fixture',
      usesLLM: false,
      priority: 'low',
    },
    run,
  }
  return { agent, systemOptions }
}

test('mobile adapter delegates to the canonical AgentModule with authenticated identity', async () => {
  let receivedContext: AgentContext | undefined
  let receivedInput: AgentInput | undefined
  const signal = new AbortController().signal
  const registration = createMobileAgentRegistration(
    binding(async (agentContext, input) => {
      receivedContext = agentContext
      receivedInput = input
      return { success: true }
    }, taskContext => ({
      executionId: taskContext.taskId,
      executionTimestamp: taskContext.createdAt,
    })),
    { resolveUser: username => username === user.username ? user : null },
  )

  await registration.run(context({ signal }))

  assert.equal(receivedContext?.username, 'alice')
  assert.equal(receivedContext?.userId, 'profile-uuid')
  assert.equal(receivedContext?.dataDir, '/mobile-data')
  assert.equal(receivedContext?.signal, signal)
  assert.deepEqual(receivedInput?.args, ['--limit', '5'])
  assert.deepEqual(receivedInput?.options, {
    limit: 5,
    executionId: 'task-123',
    executionTimestamp: '2026-08-31T01:02:03.000Z',
  })
})

test('mobile adapter rejects missing, unknown, and caller-overridden profiles', async () => {
  const registration = createMobileAgentRegistration(
    binding(async () => ({ success: true })),
    { resolveUser: username => username === user.username ? user : null },
  )

  await assert.rejects(registration.run(context({ username: '' })), /authenticated profile/)
  await assert.rejects(registration.run(context({ username: 'missing' })), /profile does not exist/)
  await assert.rejects(
    registration.run(context({ args: ['--username', 'another'] })),
    /cannot override the authenticated profile/,
  )
  await assert.rejects(
    registration.run(context({ options: { username: 'another' } })),
    /cannot override the authenticated profile/,
  )
})

test('mobile adapter reports canonical agent failures to the coordinator', async () => {
  const registration = createMobileAgentRegistration(
    binding(async () => ({ success: false, error: 'capture failed', errors: ['archive failed'] })),
    { resolveUser: () => user },
  )

  await assert.rejects(registration.run(context()), /capture failed; archive failed/)
})

test('mobile registry contains one default handler for each supported canonical module', () => {
  const registrations = registerMobileAgents()
  const ids = registrations.map(registration => registration.id)

  assert.deepEqual(ids, [
    'profile-sync',
    'organizer',
    'ingestor',
    'reflector',
    'dreamer',
    'curiosity-service',
    'inner-curiosity',
    'psychoanalyzer',
    'desire-generator',
    'desire-planner',
  ])
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(registrations.every(registration => registration.handler === undefined))
})
